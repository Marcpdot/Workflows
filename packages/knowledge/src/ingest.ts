/**
 * Milestone 14 — continuous / batch ingest → proposals only (never auto-accept).
 */

import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { extractPdfText } from "./pdfText.js";
import {
  completeStructured,
  parseStructured,
} from "@workflows/structured";
import { resolveSafePath } from "@workflows/tools";
import { EXTRACTION_SCHEMA, extractionToProposalItems } from "./extract.js";
import { hashInput } from "./knowledge.js";
import type {
  ExtractionResult,
  KnowledgeEvent,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";

export interface IngestTextInput {
  text: string;
  sourceType?: KnowledgeEvent["sourceType"];
  sourceRef?: string;
  workspaceId?: string | null;
  projectLabel?: string;
  minChars?: number;
  dedupeNodes?: boolean;
  model?: string;
  complete?: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ) => Promise<string>;
}

export interface IngestFileInput extends Omit<IngestTextInput, "text"> {
  path: string;
  workspaceRoot?: string;
  maxBytes?: number;
}

export interface IngestResult {
  eventId: string;
  proposals: KnowledgeProposal[];
  skippedDuplicateNodes: number;
  mode: "heuristic" | "model" | "skipped";
  reason?: string;
  sourceRef: string;
}

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

export function heuristicExtract(text: string): ExtractionResult {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const words = text
    .split(/[^a-zA-ZæøåÆØÅ0-9-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3);
  const unique = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 16);
  const concepts = unique.slice(0, 10).map((label) => ({
    label,
    description: "Term observed in source text (heuristic).",
  }));
  const claims = sentences.slice(0, 12).map((s) => ({
    label: s.length > 120 ? s.slice(0, 117) + "…" : s,
    description: s,
    epistemicStatus: "observed" as const,
  }));
  const relations =
    unique.length >= 2
      ? [{ from: unique[0]!, relation: "about", to: unique[1]! }]
      : [];
  const evidence = claims.slice(0, 6).map((c) => ({
    claimLabel: c.label,
    excerpt: c.description.slice(0, 280),
    stance: "supports" as const,
  }));
  return { concepts, claims, relations, evidence };
}

function buildSourceRef(input: {
  sourceRef?: string;
  projectLabel?: string;
}): string {
  const base = input.sourceRef?.trim() || "ingest";
  const proj = input.projectLabel?.trim();
  if (!proj) return base;
  return `${base}#project=${proj}`;
}

export async function filterDuplicateNodeProposals(
  store: KnowledgeStore,
  items: Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }>
): Promise<{
  items: Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }>;
  skipped: number;
}> {
  const out: typeof items = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind !== "node") {
      out.push(item);
      continue;
    }
    const label = String(item.payload.label ?? "").trim();
    if (!label) {
      skipped++;
      continue;
    }
    const canonicalId = String(item.payload.canonicalId ?? "").trim();
    if (canonicalId && (await store.getNode(canonicalId))) {
      skipped++;
      continue;
    }
    out.push(item);
  }
  return { items: out, skipped };
}

function applyWorkspaceToItems(
  items: Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }>,
  workspaceId?: string | null
): typeof items {
  if (workspaceId === undefined) return items;
  return items.map((item) => {
    if (item.kind !== "node") return item;
    if (item.payload.workspaceId !== undefined) return item;
    return { ...item, payload: { ...item.payload, workspaceId } };
  });
}

async function extractForIngest(
  text: string,
  complete?: IngestTextInput["complete"]
): Promise<{ result: ExtractionResult; mode: "heuristic" | "model" }> {
  if (!complete) {
    return { result: heuristicExtract(text), mode: "heuristic" };
  }
  try {
    const structured = await completeStructured<ExtractionResult>({
      complete,
      messages: [
        {
          role: "system",
          content:
            "Extract a rich semantic knowledge graph fragment as JSON only. " +
            'Shape: {"concepts":[{"label","description"}],"claims":[{"label","description","confidence?","epistemicStatus?"}],' +
            '"relations":[{"from","relation","to","confidence?"}],' +
            '"evidence":[{"claimLabel","excerpt","stance"}],"openQuestions":["..."]}. ' +
            "Rules: (1) Every concept and claim MUST have a non-empty description (1-3 sentences from the source, not just the label). " +
            "(2) Prefer concrete physics/engineering claims over generic words. " +
            "(3) Relations: requires, part_of, about, causes, measures, used_in, supports. " +
            "(4) Evidence excerpts must be short quotes from the source. " +
            "(5) Cap: <=12 concepts, <=15 claims, <=20 relations, <=15 evidence.",
        },
        {
          role: "user",
          content: `Extract concepts, claims, and relations from:\n\n${text}`,
        },
      ],
      parse: (raw) => parseStructured<ExtractionResult>(raw, EXTRACTION_SCHEMA),
      maxAttempts: 2,
    });
    if (structured.ok && structured.value) {
      return { result: structured.value, mode: "model" };
    }
  } catch {
    /* fall back */
  }
  return { result: heuristicExtract(text), mode: "heuristic" };
}

export async function ingestText(
  store: KnowledgeStore,
  input: IngestTextInput
): Promise<IngestResult> {
  const text = input.text?.trim() ?? "";
  const minChars =
    input.minChars != null && Number.isFinite(input.minChars)
      ? Math.max(0, Math.floor(input.minChars))
      : 0;
  const sourceRef = buildSourceRef(input);

  if (!text || text.length < minChars) {
    return {
      eventId: "",
      proposals: [],
      skippedDuplicateNodes: 0,
      mode: "skipped",
      reason: !text
        ? "empty text"
        : `text length ${text.length} < minChars ${minChars}`,
      sourceRef,
    };
  }

  const sourceType = input.sourceType ?? "manual";
  const dedupe = input.dedupeNodes !== false;
  const { result, mode } = await extractForIngest(text, input.complete);

  let items = extractionToProposalItems(result);
  items = applyWorkspaceToItems(items, input.workspaceId);

  let skipped = 0;
  if (dedupe) {
    const filtered = await filterDuplicateNodeProposals(store, items);
    items = filtered.items;
    skipped = filtered.skipped;
  }

  if (items.length === 0) {
    return {
      eventId: "",
      proposals: [],
      skippedDuplicateNodes: skipped,
      mode,
      reason: "no proposals after extract/dedupe",
      sourceRef,
    };
  }

  const event = await store.createEvent({
    sourceType,
    sourceRef,
    sourceContent: text,
    model: input.model ?? (mode === "model" ? "ingest-model" : "heuristic-m14"),
    inputHash: hashInput(text),
    transformation: {
      method:
        mode === "model"
          ? "document_structured_extraction"
          : "document_heuristic_extraction",
      model: input.model ?? (mode === "model" ? "ingest-model" : "heuristic-m14"),
      representationScope: "semantic graph fragment",
      informationLoss: {
        occurred: true,
        description:
          "Only selected graph items are retained as derived representations; the event keeps the original source content.",
      },
    },
  });
  const proposals = await store.addProposals(event.id, items);

  return {
    eventId: event.id,
    proposals,
    skippedDuplicateNodes: skipped,
    mode,
    sourceRef,
  };
}

export async function ingestFile(
  store: KnowledgeStore,
  input: IngestFileInput
): Promise<IngestResult> {
  const rawPath = input.path?.trim();
  if (!rawPath) {
    return {
      eventId: "",
      proposals: [],
      skippedDuplicateNodes: 0,
      mode: "skipped",
      reason: "path is required",
      sourceRef: input.sourceRef ?? "ingest-file",
    };
  }

  let abs: string;
  if (input.workspaceRoot?.trim()) {
    abs = resolveSafePath(input.workspaceRoot.trim(), rawPath);
  } else {
    abs = resolve(rawPath);
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  let text: string;
  try {
    const buf = readFileSync(abs);
    if (buf.byteLength > maxBytes) {
      return {
        eventId: "",
        proposals: [],
        skippedDuplicateNodes: 0,
        mode: "skipped",
        reason: `file exceeds maxBytes (${buf.byteLength} > ${maxBytes})`,
        sourceRef: input.sourceRef ?? `file:${rawPath}`,
      };
    }
    const ext = extname(abs).toLowerCase();
    if (ext === ".pdf") {
      const extracted = await extractPdfText(buf, { maxChars: 180_000 });
      if (extracted.empty) {
        return {
          eventId: "",
          proposals: [],
          skippedDuplicateNodes: 0,
          mode: "skipped",
          reason: `PDF has little/no extractable text (pages=${extracted.pageCount}) — likely scanned; OCR not enabled`,
          sourceRef: input.sourceRef ?? `file:${rawPath}`,
        };
      }
      text = extracted.text;
    } else {
      text = buf.toString("utf8");
    }
  } catch (err) {
    return {
      eventId: "",
      proposals: [],
      skippedDuplicateNodes: 0,
      mode: "skipped",
      reason: err instanceof Error ? err.message : String(err),
      sourceRef: input.sourceRef ?? `file:${rawPath}`,
    };
  }

  return ingestText(store, {
    ...input,
    text,
    sourceType: input.sourceType ?? "file",
    sourceRef: input.sourceRef ?? `file:${rawPath}`,
  });
}

export async function ingestDirectory(
  store: KnowledgeStore,
  input: {
    path: string;
    workspaceRoot?: string;
    recursive?: boolean;
    maxFiles?: number;
    extensions?: string[];
    maxBytes?: number;
    workspaceId?: string | null;
    projectLabel?: string;
    minChars?: number;
    dedupeNodes?: boolean;
    complete?: IngestTextInput["complete"];
    model?: string;
  }
): Promise<{
  results: IngestResult[];
  scanned: number;
  ingested: number;
  skipped: number;
}> {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const rawPath = input.path?.trim() || ".";
  let abs: string;
  if (input.workspaceRoot?.trim()) {
    abs = resolveSafePath(input.workspaceRoot.trim(), rawPath);
  } else {
    abs = resolve(rawPath);
  }

  const exts = new Set(
    (input.extensions ?? [".md", ".txt", ".pdf"]).map((e) => e.toLowerCase())
  );
  const maxFiles = input.maxFiles ?? 40;
  const recursive = input.recursive === true;

  const files: string[] = [];
  const walk = (dir: string, relBase: string) => {
    if (files.length >= maxFiles) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (files.length >= maxFiles) break;
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (recursive) walk(full, relBase ? `${relBase}/${name}` : name);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(name).toLowerCase();
      if (!exts.has(ext)) continue;
      files.push(relBase ? `${relBase}/${name}` : name);
    }
  };

  walk(abs, "");
  const results: IngestResult[] = [];
  let ingested = 0;
  let skipped = 0;
  for (const rel of files) {
    const normalized = (rawPath.replace(/\/+$/, "") + "/" + rel).replace(/\\/g, "/");
    const r = await ingestFile(store, {
      path: normalized,
      workspaceRoot: input.workspaceRoot,
      maxBytes: input.maxBytes,
      workspaceId: input.workspaceId,
      projectLabel: input.projectLabel,
      minChars: input.minChars,
      dedupeNodes: input.dedupeNodes,
      complete: input.complete,
      model: input.model,
      sourceType: "file",
      sourceRef: `file:${normalized}`,
    });
    results.push(r);
    if (r.mode === "skipped" || r.proposals.length === 0) skipped++;
    else ingested++;
  }

  return { results, scanned: files.length, ingested, skipped };
}

export function formatChatSegment(
  messages: Array<{ role: string; content: string }>,
  maxMessages = 12
): string {
  const slice = messages.slice(-Math.max(1, maxMessages));
  return slice
    .map((m) => `${m.role}: ${m.content.trim()}`)
    .filter((line) => line.length > 3)
    .join("\n\n");
}

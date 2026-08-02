/**
 * Milestone 14 — continuous / batch ingest → proposals only (never auto-accept).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  completeStructured,
  parseStructured,
} from "@workflows/structured";
import { resolveSafePath } from "@workflows/tools";
import { EXTRACTION_SCHEMA, extractionToProposalItems } from "./extract.js";
import { labelsMatch } from "./identity.js";
import { hashInput } from "./knowledge.js";
import type {
  ExtractionResult,
  KnowledgeEvent,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";

export interface IngestTextInput {
  text: string;
  sourceType?: KnowledgeEvent["sourceType"];
  sourceRef?: string;
  workspaceId?: string | null;
  /** Hint only — never auto-links (M13); encoded into sourceRef */
  projectLabel?: string;
  /** Skip when text shorter (default 0) */
  minChars?: number;
  /** Skip node proposals already accepted as type+label (default true) */
  dedupeNodes?: boolean;
  model?: string;
  /**
   * Optional live model complete for structured extract.
   * Offline / smoke omit this and use heuristic.
   */
  complete?: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ) => Promise<string>;
}

export interface IngestFileInput extends Omit<IngestTextInput, "text"> {
  path: string;
  /** When set, path must resolve under this root (tool path safety) */
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

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** Offline shell extract: words → concepts, sentences → claims. */
export function heuristicExtract(text: string): ExtractionResult {
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  const words = text
    .split(/[^a-zA-ZæøåÆØÅ0-9-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3);
  const unique = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 12);
  const concepts = unique.map((label) => ({ label }));
  const claims = sentences.slice(0, 8).map((label) => ({ label }));
  const relations =
    unique.length >= 2
      ? [
          {
            from: unique[0]!,
            relation: "about",
            to: unique[1]!,
          },
        ]
      : [];
  return { concepts, claims, relations };
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

/**
 * Drop node proposals whose type+label already exists as accepted.
 * Edges and evidence always kept (attach on accept via M11 materialize).
 */
export async function filterDuplicateNodeProposals(
  store: KnowledgeStore,
  items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }>
): Promise<{
  items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }>;
  skipped: number;
}> {
  const out: typeof items = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind !== "node") {
      out.push(item);
      continue;
    }
    const type = String(item.payload.type ?? "concept") as KnowledgeNodeType;
    const label = String(item.payload.label ?? "").trim();
    if (!label) {
      skipped++;
      continue;
    }
    // Alias or normalized identity → skip node proposal
    const canon = await store.resolveCanonical({ label, type });
    if (canon && (canon.type === type || !type)) {
      skipped++;
      continue;
    }
    const hits = await store.findNodes({
      type,
      label,
      status: "accepted",
      limit: 8,
    });
    const exact = hits.some(
      (n) => n.type === type && labelsMatch(n.label, label)
    );
    if (exact) {
      skipped++;
      continue;
    }
    out.push(item);
  }
  return { items: out, skipped };
}

function applyWorkspaceToItems(
  items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }>,
  workspaceId?: string | null
): typeof items {
  if (workspaceId === undefined) return items;
  return items.map((item) => {
    if (item.kind !== "node") return item;
    if (item.payload.workspaceId !== undefined) return item;
    return {
      ...item,
      payload: { ...item.payload, workspaceId },
    };
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
            "Extract a semantic knowledge graph fragment as JSON only. " +
            'Shape: {"concepts":[{"label","description?"}],"claims":[{"label","description?","confidence?"}],' +
            '"relations":[{"from","relation","to","confidence?"}],' +
            '"evidence":[{"claimLabel","excerpt","stance"}]}. ' +
            "Use short labels. Prefer typed relations: requires, limits, causes, increases, reduces, about.",
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

/**
 * Ingest free text → event + **pending** proposals only. Never accepts.
 */
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
    model: input.model ?? (mode === "model" ? "ingest-model" : "heuristic-m14"),
    inputHash: hashInput(text),
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

/**
 * Read a text/markdown file and ingest as proposals.
 */
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
    text = buf.toString("utf8");
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

/** Format recent chat messages into one ingest segment. */
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

/**
 * Deterministic ingest: fetch → normalize → chunk → transform job.
 * Operator accept is the canonical gate. This path does not call a model.
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { resolveSafePath } from "@workflows/tools";
import {
  chunkText,
  contentHash,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  normalizeIngestText,
} from "./chunk.js";
import { extractPdfText } from "./pdfText.js";
import type {
  ExtractionResult,
  KnowledgeEvent,
  KnowledgeProposal,
  KnowledgeStore,
  TransformJob,
  TransformJobStatus,
} from "./types.js";

export interface IngestTextInput {
  text: string;
  sourceType?: KnowledgeEvent["sourceType"];
  sourceRef?: string;
  sourcePath?: string;
  workspaceId?: string | null;
  projectLabel?: string;
  minChars?: number;
  /** Dev-only: accept the job immediately after persist. */
  autoAccept?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface IngestFileInput extends Omit<IngestTextInput, "text"> {
  path: string;
  workspaceRoot?: string;
  maxBytes?: number;
}

export type IngestResultStatus = TransformJobStatus | "skipped";

export interface IngestResult {
  jobId: string;
  status: IngestResultStatus;
  sourceKind: string;
  sourceRef: string;
  sourcePath?: string;
  asIsId?: string;
  chunkCount: number;
  reason?: string;
}

export interface IngestDirectoryInput {
  path: string;
  workspaceRoot?: string;
  recursive?: boolean;
  maxFiles?: number;
  extensions?: string[];
  maxBytes?: number;
  workspaceId?: string | null;
  projectLabel?: string;
  minChars?: number;
  autoAccept?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface IngestDirectoryResult {
  results: IngestResult[];
  scanned: number;
  ingested: number;
  failed: number;
  skipped: number;
}

const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;

function buildSourceRef(input: {
  sourceRef?: string;
  projectLabel?: string;
  fallback: string;
}): string {
  const base = input.sourceRef?.trim() || input.fallback;
  const proj = input.projectLabel?.trim();
  if (!proj) return base;
  return `${base}#project=${proj}`;
}

function sourceKindFromPath(path: string, fallback = "text"): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".txt") return "text";
  if (ext === ".pdf") return "pdf";
  if (ext === ".html" || ext === ".htm") return "html";
  return fallback;
}

function mediaTypeFor(kind: string): string {
  if (kind === "markdown") return "text/markdown";
  if (kind === "pdf") return "application/pdf";
  if (kind === "html") return "text/html";
  return "text/plain";
}

function toResult(job: TransformJob, extra?: { asIsId?: string; reason?: string }): IngestResult {
  return {
    jobId: job.id,
    status: job.status,
    sourceKind: job.sourceKind,
    sourceRef: job.sourceRef,
    sourcePath: job.sourcePath,
    asIsId: extra?.asIsId,
    chunkCount: job.chunkCount,
    reason: extra?.reason ?? job.error,
  };
}

function skipped(sourceRef: string, reason: string, sourceKind = "text"): IngestResult {
  return {
    jobId: "",
    status: "skipped",
    sourceKind,
    sourceRef,
    chunkCount: 0,
    reason,
  };
}

async function persistJob(
  store: KnowledgeStore,
  input: {
    sourceKind: string;
    sourcePath?: string;
    sourceRef: string;
    workspaceId?: string | null;
    text: string;
    bytes?: Uint8Array;
    mediaType: string;
    autoAccept?: boolean;
    chunkSize?: number;
    chunkOverlap?: number;
  }
): Promise<IngestResult> {
  const job = await store.putTransformJob({
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    sourceRef: input.sourceRef,
    workspaceId: input.workspaceId,
  });
  try {
    const asIs = await store.putAsIs({
      jobId: job.id,
      path: input.sourcePath || input.sourceRef,
      contentHash: contentHash(input.bytes ?? input.text),
      mediaType: input.mediaType,
      text: input.text,
      bytes: input.bytes,
      byteLength: input.bytes?.byteLength ?? Buffer.byteLength(input.text, "utf8"),
      workspaceId: input.workspaceId,
    });
    const windows = chunkText(input.text, {
      size: input.chunkSize ?? DEFAULT_CHUNK_SIZE,
      overlap: input.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    });
    if (windows.length > 0) {
      await store.putChunks(
        windows.map((window) => ({
          jobId: job.id,
          asIsId: asIs.id,
          path: asIs.path,
          contentHash: window.contentHash,
          ordinal: window.ordinal,
          charStart: window.charStart,
          charEnd: window.charEnd,
          byteStart: window.byteStart,
          byteEnd: window.byteEnd,
          text: window.text,
          workspaceId: input.workspaceId,
        }))
      );
    }
    if (input.autoAccept) {
      const accepted = await store.acceptTransformJob(job.id);
      return toResult(accepted, { asIsId: asIs.id });
    }
    const current = (await store.getTransformJob(job.id)) ?? job;
    return toResult(current, { asIsId: asIs.id });
  } catch (error) {
    const failed = await store.putTransformJob({
      id: job.id,
      sourceKind: input.sourceKind,
      sourcePath: input.sourcePath,
      sourceRef: input.sourceRef,
      workspaceId: input.workspaceId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return toResult(failed);
  }
}

async function failJob(
  store: KnowledgeStore,
  input: {
    sourceKind: string;
    sourcePath?: string;
    sourceRef: string;
    workspaceId?: string | null;
    error: string;
    text?: string;
    bytes?: Uint8Array;
    mediaType?: string;
  }
): Promise<IngestResult> {
  const job = await store.putTransformJob({
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    sourceRef: input.sourceRef,
    workspaceId: input.workspaceId,
  });
  let asIsId: string | undefined;
  if (input.text != null || input.bytes) {
    const text = input.text ?? "";
    try {
      const asIs = await store.putAsIs({
        jobId: job.id,
        path: input.sourcePath || input.sourceRef,
        contentHash: contentHash(input.bytes ?? text),
        mediaType: input.mediaType ?? mediaTypeFor(input.sourceKind),
        text: text || undefined,
        bytes: input.bytes,
        byteLength: input.bytes?.byteLength ?? Buffer.byteLength(text, "utf8"),
        workspaceId: input.workspaceId,
      });
      asIsId = asIs.id;
    } catch {
      // Preserve the original failure reason even if as-is write also fails.
    }
  }
  const failed = await store.putTransformJob({
    id: job.id,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    sourceRef: input.sourceRef,
    workspaceId: input.workspaceId,
    status: "failed",
    error: input.error,
  });
  return toResult(failed, { asIsId, reason: input.error });
}

export async function ingestText(
  store: KnowledgeStore,
  input: IngestTextInput
): Promise<IngestResult> {
  const text = normalizeIngestText(input.text ?? "");
  const minChars =
    input.minChars != null && Number.isFinite(input.minChars)
      ? Math.max(0, Math.floor(input.minChars))
      : 0;
  const sourceKind = sourceKindFromPath(input.sourcePath ?? input.sourceRef ?? "", "text");
  const sourceRef = buildSourceRef({
    sourceRef: input.sourceRef,
    projectLabel: input.projectLabel,
    fallback: "ingest",
  });

  if (!text || text.length < minChars) {
    return skipped(
      sourceRef,
      !text ? "empty text" : `text length ${text.length} < minChars ${minChars}`,
      sourceKind
    );
  }

  return persistJob(store, {
    sourceKind,
    sourcePath: input.sourcePath,
    sourceRef,
    workspaceId: input.workspaceId,
    text,
    mediaType: mediaTypeFor(sourceKind),
    autoAccept: input.autoAccept === true,
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
  });
}

export async function ingestFile(
  store: KnowledgeStore,
  input: IngestFileInput
): Promise<IngestResult> {
  const rawPath = input.path?.trim();
  const sourceRef = buildSourceRef({
    sourceRef: input.sourceRef,
    projectLabel: input.projectLabel,
    fallback: rawPath ? `file:${rawPath.replace(/\\/g, "/")}` : "ingest-file",
  });
  if (!rawPath) {
    return skipped(sourceRef, "path is required", "file");
  }

  const sourcePath = rawPath.replace(/\\/g, "/");
  const sourceKind = sourceKindFromPath(sourcePath);
  const common = {
    sourceKind,
    sourcePath,
    sourceRef,
    workspaceId: input.workspaceId,
  };

  let abs: string;
  try {
    abs = input.workspaceRoot?.trim()
      ? resolveSafePath(input.workspaceRoot.trim(), rawPath)
      : resolve(rawPath);
  } catch (err) {
    return failJob(store, {
      ...common,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  let buf: Buffer;
  try {
    buf = readFileSync(abs);
  } catch (err) {
    return failJob(store, {
      ...common,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (buf.byteLength > maxBytes) {
    return failJob(store, {
      ...common,
      error: `file exceeds maxBytes (${buf.byteLength} > ${maxBytes})`,
    });
  }

  const ext = extname(abs).toLowerCase();
  if (ext === ".pdf") {
    const extracted = await extractPdfText(buf, { maxChars: 180_000 });
    const reason =
      extracted.error?.trim() ||
      `PDF has no extractable text (pages=${extracted.pageCount}) — OCR is not enabled`;
    if (extracted.empty) {
      return failJob(store, {
        ...common,
        error: reason,
        text: extracted.text,
        bytes: buf,
        mediaType: "application/pdf",
      });
    }
    return persistJob(store, {
      ...common,
      text: normalizeIngestText(extracted.text),
      bytes: buf,
      mediaType: "application/pdf",
      autoAccept: input.autoAccept === true,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
    });
  }

  const text = normalizeIngestText(buf.toString("utf8"));
  const minChars =
    input.minChars != null && Number.isFinite(input.minChars)
      ? Math.max(0, Math.floor(input.minChars))
      : 0;
  if (!text || text.length < minChars) {
    return failJob(store, {
      ...common,
      error: !text
        ? "empty text"
        : `text length ${text.length} < minChars ${minChars}`,
      text,
      bytes: buf,
      mediaType: mediaTypeFor(sourceKind),
    });
  }

  return persistJob(store, {
    ...common,
    text,
    bytes: buf,
    mediaType: mediaTypeFor(sourceKind),
    autoAccept: input.autoAccept === true,
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
  });
}

export async function ingestDirectory(
  store: KnowledgeStore,
  input: IngestDirectoryInput
): Promise<IngestDirectoryResult> {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  const rawPath = input.path?.trim() || ".";
  let abs: string;
  try {
    abs = input.workspaceRoot?.trim()
      ? resolveSafePath(input.workspaceRoot.trim(), rawPath)
      : resolve(rawPath);
  } catch {
    return { results: [], scanned: 0, ingested: 0, failed: 0, skipped: 0 };
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
  let failed = 0;
  let skippedCount = 0;
  for (const rel of files) {
    const normalized = (rawPath.replace(/\/+$/, "") + "/" + rel).replace(/\\/g, "/");
    const result = await ingestFile(store, {
      path: normalized,
      workspaceRoot: input.workspaceRoot,
      maxBytes: input.maxBytes,
      workspaceId: input.workspaceId,
      projectLabel: input.projectLabel,
      minChars: input.minChars,
      autoAccept: input.autoAccept,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
      sourceRef: `file:${normalized}`,
    });
    results.push(result);
    if (result.status === "skipped") skippedCount++;
    else if (result.status === "failed") failed++;
    else ingested++;
  }

  return { results, scanned: files.length, ingested, failed, skipped: skippedCount };
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

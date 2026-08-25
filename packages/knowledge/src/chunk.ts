import { createHash } from "node:crypto";

export const DEFAULT_CHUNK_SIZE = 1200;
export const DEFAULT_CHUNK_OVERLAP = 200;

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

export interface ChunkWindow {
  ordinal: number;
  charStart: number;
  charEnd: number;
  byteStart: number;
  byteEnd: number;
  text: string;
  contentHash: string;
}

/** SHA-256 hex of UTF-8 text or raw bytes. */
export function contentHash(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Normalize newlines and strip NUL bytes so the same document is stable
 * across platforms and safe for PostgreSQL `text` columns.
 * Does not rewrite wording.
 */
export function normalizeIngestText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

/**
 * Deterministic overlapping windows. Same text + size + overlap always
 * yields the same ordinals, hashes, and character/byte ranges.
 */
export function chunkText(text: string, options?: ChunkOptions): ChunkWindow[] {
  const size = Math.max(1, Math.floor(options?.size ?? DEFAULT_CHUNK_SIZE));
  const overlap = Math.min(
    Math.max(size - 1, 0),
    Math.max(0, Math.floor(options?.overlap ?? DEFAULT_CHUNK_OVERLAP))
  );
  if (!text) return [];

  const chunks: ChunkWindow[] = [];
  let start = 0;
  while (start < text.length) {
    const rawEnd = Math.min(start + size, text.length);
    const end = rawEnd >= text.length ? rawEnd : chooseBreak(text, start, rawEnd);
    const slice = text.slice(start, end);
    const byteStart = Buffer.byteLength(text.slice(0, start), "utf8");
    const byteEnd = byteStart + Buffer.byteLength(slice, "utf8");
    chunks.push({
      ordinal: chunks.length,
      charStart: start,
      charEnd: end,
      byteStart,
      byteEnd,
      text: slice,
      contentHash: contentHash(slice),
    });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function chooseBreak(text: string, start: number, rawEnd: number): number {
  const span = rawEnd - start;
  const minEnd = start + Math.max(1, Math.floor(span * 0.5));
  const window = text.slice(minEnd, rawEnd);
  const para = window.lastIndexOf("\n\n");
  if (para >= 0) return minEnd + para + 2;
  const line = window.lastIndexOf("\n");
  if (line >= 0) return minEnd + line + 1;
  for (const mark of [". ", "? ", "! ", "; "]) {
    const at = window.lastIndexOf(mark);
    if (at >= 0) return minEnd + at + mark.length;
  }
  return rawEnd;
}

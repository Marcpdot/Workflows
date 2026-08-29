/**
 * Encode: raw source → numeric factors on the axis contract.
 * Not einsum. Not canonical identity. Not pgvector projection.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { AXES_VERSION, type AxisName } from "./axes.js";
import { extractPdfText } from "./pdfText.js";

export type EvidenceType = "file" | "pdf" | "note" | "query" | "conversation";

export interface EncodeEmbedder {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  /** Living channel after embed. TF-IDF = d, LSA = r. */
  readonly channel?: AxisName;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface EncodeRow {
  k: number;
  text: string;
  contentHash: string;
}

export interface Factor {
  name: string;
  axes: AxisName[];
  shape: number[];
  values: number[];
}

export interface CatalogEntry {
  sourceId: string;
  sourcePath?: string;
  encodeId: string;
  axesVersion: typeof AXES_VERSION;
  evidence: EvidenceType;
  rowCount: number;
  dimension: number;
  channel: AxisName;
  rows: EncodeRow[];
}

export interface EncodedSource {
  catalog: CatalogEntry;
  X: Factor;
  eIndex: number;
}

export const EVIDENCE_TYPES: EvidenceType[] = [
  "file",
  "pdf",
  "note",
  "query",
  "conversation",
];

export class EmptyQueryError extends Error {
  constructor(message = "query has no mass on the fitted basis") {
    super(message);
    this.name = "EmptyQueryError";
  }
}

export function channelOf(embedder: EncodeEmbedder): AxisName {
  return embedder.channel ?? "d";
}

export function encodeId(
  model: string,
  modelVersion: string,
  dimension: number,
  channel: AxisName = "d"
): string {
  return `${AXES_VERSION}:${model}:${modelVersion}:${channel}${dimension}`;
}

export function sourceIdFromPath(path: string, body: string): string {
  const hex = createHash("sha256").update(path).update("\0").update(body).digest("hex");
  return hex.slice(0, 32);
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function titleFromPath(path?: string): string {
  if (!path) return "";
  return basename(path).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

export function withSourceTitle(text: string, path?: string): string {
  const title = titleFromPath(path);
  return title ? `${title}\n${text}` : text;
}

export function l2norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

function l2normalize(vector: readonly number[]): number[] {
  const n = l2norm(vector);
  if (!(n > 0)) return vector.map(() => 0);
  return vector.map((value) => value / n);
}

/** Split into rows. Keep short blocks; empty text still yields no rows. */
export function rowsFromText(text: string, options?: { minChars?: number }): EncodeRow[] {
  const minChars = options?.minChars ?? 1;
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!cleaned) return [];

  const blocks = cleaned
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length >= minChars);

  const parts = blocks.length > 0 ? blocks : [cleaned];
  return parts.map((part, k) => ({
    k,
    text: part,
    contentHash: hashText(part),
  }));
}

export function evidenceFromPath(path: string): EvidenceType {
  return extname(path).toLowerCase() === ".pdf" ? "pdf" : "file";
}

export async function loadSourceText(path: string): Promise<{ text: string; evidence: EvidenceType }> {
  const evidence = evidenceFromPath(path);
  const raw = await readFile(path);
  if (evidence === "pdf") {
    const extracted = await extractPdfText(raw);
    if (extracted.error) throw new Error(`encode pdf failed: ${extracted.error}`);
    return { text: extracted.text, evidence };
  }
  return { text: raw.toString("utf8"), evidence };
}

export async function encodeText(input: {
  text: string;
  embedder: EncodeEmbedder;
  evidence: EvidenceType;
  sourceId?: string;
  sourcePath?: string;
  minChars?: number;
}): Promise<EncodedSource> {
  const rows = rowsFromText(input.text, { minChars: input.minChars }).map((row) => ({
    ...row,
    text: withSourceTitle(row.text, input.sourcePath),
  }));
  if (rows.length === 0) throw new Error("encode produced no rows");

  const vectors = await input.embedder.embed(rows.map((row) => row.text));
  if (vectors.length !== rows.length) {
    throw new Error(`embedder returned ${vectors.length} vectors for ${rows.length} rows`);
  }

  const dim = input.embedder.dimension;
  const channel = channelOf(input.embedder);
  const values: number[] = [];
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(`embedder dimension ${vector.length} != ${dim}`);
    }
    values.push(...l2normalize(vector));
  }

  const sourceId =
    input.sourceId ??
    sourceIdFromPath(input.sourcePath ?? "text", input.text);
  const eIndex = EVIDENCE_TYPES.indexOf(input.evidence);
  if (eIndex < 0) throw new Error(`unknown evidence type ${input.evidence}`);

  return {
    catalog: {
      sourceId,
      sourcePath: input.sourcePath,
      encodeId: encodeId(input.embedder.model, input.embedder.modelVersion, dim, channel),
      axesVersion: AXES_VERSION,
      evidence: input.evidence,
      rowCount: rows.length,
      dimension: dim,
      channel,
      rows,
    },
    X: {
      name: "X",
      axes: ["k", channel],
      shape: [rows.length, dim],
      values,
    },
    eIndex,
  };
}

export async function encodeFile(
  path: string,
  embedder: EncodeEmbedder,
  options?: { minChars?: number }
): Promise<EncodedSource> {
  const loaded = await loadSourceText(path);
  return encodeText({
    text: loaded.text,
    embedder,
    evidence: loaded.evidence,
    sourcePath: path,
    minChars: options?.minChars,
  });
}

export async function encodeQuery(
  text: string,
  embedder: EncodeEmbedder
): Promise<{ vector: number[]; axes: AxisName[]; encodeId: string }> {
  const encoded = await encodeText({
    text,
    embedder,
    evidence: "query",
    sourceId: hashText(text).slice(0, 32),
    minChars: 1,
  });
  const vector = encoded.X.values.slice(0, embedder.dimension);
  if (!(l2norm(vector) > 0)) throw new EmptyQueryError();
  return {
    vector,
    axes: [channelOf(embedder)],
    encodeId: encoded.catalog.encodeId,
  };
}

export function createHashEmbedder(dimension = 32): EncodeEmbedder {
  return {
    model: "hash",
    modelVersion: "1",
    dimension,
    channel: "d",
    async embed(texts) {
      return texts.map((text) => {
        const digest = createHash("sha256").update(text).digest();
        const vector = Array.from({ length: dimension }, (_, i) => {
          const byte = digest[i % digest.length]!;
          return (byte - 127.5) / 127.5;
        });
        return l2normalize(vector);
      });
    },
  };
}

/** Row-major X[k, channel] times q[channel] -> scores[k]. */
export function readChunks(X: Factor, query: readonly number[]): number[] {
  const axis = X.axes.join("");
  if ((axis !== "kd" && axis !== "kr") || X.shape.length !== 2) {
    throw new Error("readChunks expects factor axes [k,d] or [k,r], got [" + X.axes.join(",") + "]");
  }
  const [rowCount, dim] = X.shape;
  if (query.length !== dim) {
    throw new Error("query length " + query.length + " != channel " + dim);
  }
  const scores = Array.from({ length: rowCount }, () => 0);
  for (let k = 0; k < rowCount; k++) {
    let sum = 0;
    const offset = k * dim;
    for (let i = 0; i < dim; i++) sum += X.values[offset + i]! * query[i]!;
    scores[k] = sum;
  }
  return scores;
}

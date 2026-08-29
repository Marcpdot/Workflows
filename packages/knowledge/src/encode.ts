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
  rows: EncodeRow[];
}

export interface EncodedSource {
  catalog: CatalogEntry;
  /** X[k, d] row-major. */
  X: Factor;
  /** one-hot-ish mark along e, length = EVIDENCE_TYPES. */
  eIndex: number;
}

export const EVIDENCE_TYPES: EvidenceType[] = [
  "file",
  "pdf",
  "note",
  "query",
  "conversation",
];

export function encodeId(model: string, modelVersion: string, dimension: number): string {
  return `${AXES_VERSION}:${model}:${modelVersion}:d${dimension}`;
}

export function sourceIdFromPath(path: string, body: string): string {
  const hex = createHash("sha256").update(path).update("\0").update(body).digest("hex");
  return hex.slice(0, 32);
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function l2normalize(vector: readonly number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const n = Math.sqrt(sum);
  if (!(n > 0)) return vector.map(() => 0);
  return vector.map((value) => value / n);
}

/** Split into rows. Whole document is one row when it does not break. */
export function rowsFromText(text: string, options?: { minChars?: number }): EncodeRow[] {
  const minChars = options?.minChars ?? 40;
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
    if (extracted.empty) throw new Error(`encode pdf produced no text: ${basename(path)}`);
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
  const rows = rowsFromText(input.text, { minChars: input.minChars });
  if (rows.length === 0) throw new Error("encode produced no rows");

  const vectors = await input.embedder.embed(rows.map((row) => row.text));
  if (vectors.length !== rows.length) {
    throw new Error(`embedder returned ${vectors.length} vectors for ${rows.length} rows`);
  }

  const dim = input.embedder.dimension;
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
      encodeId: encodeId(input.embedder.model, input.embedder.modelVersion, dim),
      axesVersion: AXES_VERSION,
      evidence: input.evidence,
      rowCount: rows.length,
      dimension: dim,
      rows,
    },
    X: {
      name: "X",
      axes: ["k", "d"],
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
  return {
    vector: encoded.X.values.slice(0, embedder.dimension),
    axes: ["d"],
    encodeId: encoded.catalog.encodeId,
  };
}

/**
 * Deterministic stand-in so encode can run without Ollama.
 * Replace with a real EncodeEmbedder when you want semantic d.
 */
export function createHashEmbedder(dimension = 32): EncodeEmbedder {
  return {
    model: "hash",
    modelVersion: "1",
    dimension,
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

/** Row-major X[k,d] · q[d] → scores[k]. Same as read_chunks. */
export function readChunks(X: Factor, query: readonly number[]): number[] {
  if (X.axes.join("") !== "kd" || X.shape.length !== 2) {
    throw new Error("readChunks expects factor axes [k,d]");
  }
  const [rowCount, dim] = X.shape;
  if (query.length !== dim) {
    throw new Error(`query d=${query.length} != X d=${dim}`);
  }
  const scores = Array.from({ length: rowCount }, () => 0);
  for (let k = 0; k < rowCount; k++) {
    let sum = 0;
    const offset = k * dim;
    for (let d = 0; d < dim; d++) sum += X.values[offset + d]! * query[d]!;
    scores[k] = sum;
  }
  return scores;
}

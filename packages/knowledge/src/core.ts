/**
 * Tensor core on the axis contract.
 * S is stacked encoded rows. X is a query. Y is ranked catalog rows.
 * O is identity until an update_O signal exists.
 */

import { assertRegistered } from "./axes.js";
import {
  encodeId,
  encodeQuery,
  encodeText,
  readChunks,
  rowsFromText,
  type CatalogEntry,
  type EncodeEmbedder,
  type EncodedSource,
  type EncodeRow,
  type Factor,
} from "./encode.js";
import { createTfidfEmbedder } from "./tfidf.js";

export interface CatalogRowRef {
  sourceId: string;
  sourcePath?: string;
  evidence: CatalogEntry["evidence"];
  encodeId: string;
  row: EncodeRow;
}

export interface ReadHit {
  score: number;
  ref: CatalogRowRef;
}

export interface TensorCore {
  encodeId: string;
  /** S[k, d] — stacked source rows. */
  S: Factor;
  rows: CatalogRowRef[];
}

function emptyFactor(): Factor {
  return { name: "S", axes: ["k", "d"], shape: [0, 0], values: [] };
}

export function createCore(encodeIdValue: string): TensorCore {
  return { encodeId: encodeIdValue, S: emptyFactor(), rows: [] };
}

export function ingest(core: TensorCore, encoded: EncodedSource): TensorCore {
  if (encoded.catalog.encodeId !== core.encodeId) {
    throw new Error(
      `encodeId mismatch: core ${core.encodeId} vs source ${encoded.catalog.encodeId}`
    );
  }
  const dim = encoded.X.shape[1] ?? 0;
  if (core.S.shape[1] !== 0 && core.S.shape[1] !== dim) {
    throw new Error(`d mismatch: core ${core.S.shape[1]} vs source ${dim}`);
  }

  const nextValues = core.S.values.concat(encoded.X.values);
  const nextRows = core.rows.concat(
    encoded.catalog.rows.map((row) => ({
      sourceId: encoded.catalog.sourceId,
      sourcePath: encoded.catalog.sourcePath,
      evidence: encoded.catalog.evidence,
      encodeId: encoded.catalog.encodeId,
      row,
    }))
  );

  return {
    encodeId: core.encodeId,
    S: {
      name: "S",
      axes: ["k", "d"],
      shape: [nextRows.length, dim],
      values: nextValues,
    },
    rows: nextRows,
  };
}

export function read(
  core: TensorCore,
  query: readonly number[],
  options?: { limit?: number }
): ReadHit[] {
  assertRegistered("d,kd->k");
  if (core.rows.length === 0) return [];
  const scores = readChunks(core.S, query);
  const ranked = scores
    .map((score, k) => ({ score, ref: core.rows[k]! }))
    .sort((a, b) => b.score - a.score);
  const limit = options?.limit ?? ranked.length;
  return ranked.slice(0, Math.max(0, limit));
}

export async function ingestTextSource(
  core: TensorCore,
  input: {
    text: string;
    embedder: EncodeEmbedder;
    evidence?: EncodedSource["catalog"]["evidence"];
    sourcePath?: string;
  }
): Promise<TensorCore> {
  const encoded = await encodeText({
    text: input.text,
    embedder: input.embedder,
    evidence: input.evidence ?? "note",
    sourcePath: input.sourcePath,
  });
  const started =
    core.S.shape[0] === 0 ? createCore(encoded.catalog.encodeId) : core;
  return ingest(started, encoded);
}

export async function ask(
  core: TensorCore,
  question: string,
  embedder: EncodeEmbedder,
  options?: { limit?: number }
): Promise<ReadHit[]> {
  const q = await encodeQuery(question, embedder);
  if (q.encodeId !== core.encodeId) {
    throw new Error(`query encodeId ${q.encodeId} != core ${core.encodeId}`);
  }
  return read(core, q.vector, options);
}

const DEMO_NOTES = [
  {
    sourcePath: "note-tensor.md",
    text:
      "Tensorer er multi-lineære maps.\n\n" +
      "Einsum er syntaksen for kontraksjon på navngitte akser.\n\n" +
      "Faktorer eier den store logiske tensoren.",
  },
  {
    sourcePath: "note-encode.md",
    text:
      "Encode gjør rå tekst om til tall på k og d.\n\n" +
      "Catalog husker sourceId og radtekst.\n\n" +
      "Uten catalog kan du ikke hente kunnskap tilbake til filen.",
  },
];

/** Smoke: two notes in, one question out. TF-IDF basis, no generative model. */
export async function demoTensorRead(): Promise<ReadHit[]> {
  const embedder = createTfidfEmbedder();
  embedder.fit(
    DEMO_NOTES.flatMap((note) => rowsFromText(note.text).map((row) => row.text))
  );
  let core = createCore(encodeId(embedder.model, embedder.modelVersion, embedder.dimension));
  for (const note of DEMO_NOTES) {
    core = await ingestTextSource(core, { embedder, ...note });
  }
  return ask(core, "hvordan henter jeg kunnskap fra en fil", embedder, {
    limit: 3,
  });
}

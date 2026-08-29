/**
 * LSA = truncated SVD of the TF-IDF matrix.
 * Living channel after fit is r, not raw vocab d.
 */

import type { EncodeEmbedder } from "./encode.js";
import { createTfidfEmbedder, TfidfEmbedder } from "./tfidf.js";
import { projectVector, truncatedSvd, type ThinSvd } from "./svd.js";

function l2(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const n = Math.sqrt(sum);
  if (!(n > 0)) return vector.map(() => 0);
  return vector.map((value) => value / n);
}

export class LsaEmbedder implements EncodeEmbedder {
  readonly model = "lsa";
  modelVersion = "unfitted";
  dimension = 0;
  singularValues: number[] = [];

  private tfidf = createTfidfEmbedder();
  private svd: ThinSvd | null = null;

  get terms(): readonly string[] {
    return this.tfidf.terms();
  }

  get vocabDimension(): number {
    return this.tfidf.dimension;
  }

  /** Right factors V[d, r] — the map from vocab onto latent axes. */
  get V(): number[][] | null {
    return this.svd?.V ?? null;
  }

  fit(texts: readonly string[], rank = 8): this {
    this.tfidf.fit(texts);
    const rows = texts.map((text) => {
      // embed is async only to satisfy EncodeEmbedder; tfidf is sync.
      return (this.tfidf as TfidfEmbedder & { vectorize?: (t: string) => number[] });
    });
    void rows;
    const matrix: number[][] = [];
    for (const text of texts) {
      const [vector] = mustEmbed(this.tfidf, [text]);
      matrix.push([...vector]);
    }
    const r = Math.max(1, Math.min(rank, matrix.length - 1, this.tfidf.dimension));
    this.svd = truncatedSvd(matrix, r);
    this.dimension = this.svd.V[0]?.length ?? 0;
    this.singularValues = this.svd.singularValues;
    this.modelVersion = `${this.tfidf.modelVersion}:r${this.dimension}`;
    return this;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (!this.svd) throw new Error("lsa embedder must be fit before embed");
    const raw = mustEmbed(this.tfidf, texts);
    return raw.map((vector) => l2(projectVector(vector, this.svd!.V)));
  }
}

function mustEmbed(embedder: TfidfEmbedder, texts: readonly string[]): number[][] {
  const out: number[][] = [];
  // TfidfEmbedder.embed is async but pure; call the private path via embed.
  // We keep a tight loop by reusing the public API synchronously through a cached thenable.
  let snapshot: number[][] | null = null;
  embedder.embed(texts).then((vectors) => {
    snapshot = vectors.map((v) => [...v]);
  });
  if (!snapshot) {
    // embed resolves immediately; pull by running the same algorithm the class uses.
    // Fallback: block on a deoptimized sync clone via (embedder as any) internals is avoided.
  }
  return syncTfidf(embedder, texts);
}

function syncTfidf(embedder: TfidfEmbedder, texts: readonly string[]): number[][] {
  const anyEmbedder = embedder as unknown as { vectorize?: (text: string) => number[] };
  if (typeof anyEmbedder.vectorize === "function") {
    return texts.map((text) => anyEmbedder.vectorize!(text));
  }
  throw new Error("tfidf vectorize is not available");
}

export function createLsaEmbedder(): LsaEmbedder {
  return new LsaEmbedder();
}

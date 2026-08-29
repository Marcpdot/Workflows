/**
 * LSA = truncated SVD of the TF-IDF matrix.
 * After fit, the living channel is r.
 */

import type { EncodeEmbedder } from "./encode.js";
import { createTfidfEmbedder } from "./tfidf.js";
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

  terms(): readonly string[] {
    return this.tfidf.terms();
  }

  get vocabDimension(): number {
    return this.tfidf.dimension;
  }

  /** V[d, r] maps vocab onto latent axes. */
  get V(): number[][] | null {
    return this.svd?.V ?? null;
  }

  fit(texts: readonly string[], rank = 8): this {
    this.tfidf.fit(texts);
    const matrix = texts.map((text) => this.tfidf.vectorize(text));
    const r = Math.max(1, Math.min(rank, matrix.length, this.tfidf.dimension));
    this.svd = truncatedSvd(matrix, r);
    this.dimension = this.svd.V[0]?.length ?? 0;
    this.singularValues = this.svd.singularValues;
    this.modelVersion = `${this.tfidf.modelVersion}:r${this.dimension}`;
    return this;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (!this.svd) throw new Error("lsa embedder must be fit before embed");
    return texts.map((text) => l2(projectVector(this.tfidf.vectorize(text), this.svd!.V)));
  }
}

export function createLsaEmbedder(): LsaEmbedder {
  return new LsaEmbedder();
}

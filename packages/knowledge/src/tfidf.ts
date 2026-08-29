/**
 * Distributional semantics for axis d.
 * Vocabulary is the basis. Documents are coordinates. No generative model.
 */

import { createHash } from "node:crypto";
import type { EncodeEmbedder } from "./encode.js";

const STOP = new Set([
  "og", "i", "på", "er", "en", "et", "det", "som", "til", "av", "for",
  "med", "ikke", "den", "de", "du", "jeg", "vi", "kan", "har", "fra",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "is", "be",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && !STOP.has(token)) ?? [];
}

export class TfidfEmbedder implements EncodeEmbedder {
  readonly model = "tfidf";
  modelVersion = "unfitted";
  dimension = 0;

  private vocab: string[] = [];
  private index = new Map<string, number>();
  private idf: number[] = [];

  fit(texts: readonly string[]): this {
    const df = new Map<string, number>();
    let docs = 0;
    for (const text of texts) {
      const seen = new Set(tokenize(text));
      if (seen.size === 0) continue;
      docs += 1;
      for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
    }
    if (docs === 0) throw new Error("tfidf fit received no tokens");

    this.vocab = [...df.keys()].sort();
    this.index = new Map(this.vocab.map((token, i) => [token, i]));
    this.idf = this.vocab.map((token) => Math.log((docs + 1) / ((df.get(token) ?? 0) + 1)) + 1);
    this.dimension = this.vocab.length;
    this.modelVersion = `1:${createHash("sha256").update(this.vocab.join("\0")).digest("hex").slice(0, 12)}`;
    return this;
  }

  terms(): readonly string[] {
    return this.vocab;
  }

  vectorize(text: string): number[] {
    if (this.dimension === 0) throw new Error("tfidf embedder must be fit before embed");
    const counts = new Map<number, number>();
    for (const token of tokenize(text)) {
      const at = this.index.get(token);
      if (at === undefined) continue;
      counts.set(at, (counts.get(at) ?? 0) + 1);
    }
    const vector = Array.from({ length: this.dimension }, () => 0);
    let sum = 0;
    for (const [at, tf] of counts) {
      const value = Math.log(1 + tf) * this.idf[at]!;
      vector[at] = value;
      sum += value * value;
    }
    const n = Math.sqrt(sum);
    if (n > 0) {
      for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / n;
    }
    return vector;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }
}

export function createTfidfEmbedder(): TfidfEmbedder {
  return new TfidfEmbedder();
}

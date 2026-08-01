/**
 * Deterministic embedder for offline smoke tests.
 * Same text → same vector; similar bag-of-words → higher cosine.
 */

import type { Embedder } from "./types.js";

const DIM = 32;

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedOne(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) {
    v[0] = 1;
    return v;
  }

  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % DIM;
    const sign = h & 1 ? 1 : -1;
    v[idx]! += sign;
    // slight spill to neighbors for smoother similarity
    v[(idx + 1) % DIM]! += sign * 0.25;
  }

  // L2 normalize
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i]! /= n;
  return v;
}

export class MockEmbedder implements Embedder {
  readonly model = "mock-embed-v1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedOne);
  }
}

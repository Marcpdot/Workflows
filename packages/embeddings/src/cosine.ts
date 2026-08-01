/**
 * Cosine similarity in [−1, 1]. Higher = more similar.
 * Returns 0 for zero-length or mismatched dimensions.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pack float32 little-endian for SQLite BLOB storage. */
export function vectorToBlob(vector: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buf.writeFloatLE(vector[i]!, i * 4);
  }
  return buf;
}

/** Unpack float32 little-endian BLOB. */
export function blobToVector(buf: Buffer, dim: number): number[] {
  if (buf.length < dim * 4) {
    throw new Error(
      `vector blob too short: need ${dim * 4} bytes, got ${buf.length}`
    );
  }
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = buf.readFloatLE(i * 4);
  }
  return out;
}

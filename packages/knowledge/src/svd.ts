/** Thin SVD for small dense matrices. No external numeric library. */

export interface ThinSvd {
  /** Left vectors, k × r, column-major blocks in row-major storage of U. */
  U: number[][];
  singularValues: number[];
  /** Right vectors, d × r. Columns are V_r. */
  V: number[][];
}

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

function identity(n: number): number[][] {
  const A = zeros(n, n);
  for (let i = 0; i < n; i++) A[i]![i] = 1;
  return A;
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const T = zeros(cols, rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) T[j]![i] = A[i]![j]!;
  }
  return T;
}

function multiply(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0]?.length ?? 0;
  const p = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const aik = A[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) C[i]![j] += aik * B[k]![j]!;
    }
  }
  return C;
}

function gram(X: number[][]): number[][] {
  return multiply(transpose(X), X);
}

/** Jacobi eigen-decomposition of a symmetric matrix. Returns eigenvalues descending + V. */
export function jacobiEigen(Ainput: number[][], maxSweeps = 64): { values: number[]; vectors: number[][] } {
  const n = Ainput.length;
  const A = Ainput.map((row) => row.slice());
  const V = identity(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += A[p]![q]! * A[p]![q]!;
    }
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        A[p]![p] = app - t * apq;
        A[q]![q] = aqq + t * apq;
        A[p]![q] = 0;
        A[q]![p] = 0;
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue;
          const aip = A[i]![p]!;
          const aiq = A[i]![q]!;
          A[i]![p] = c * aip - s * aiq;
          A[p]![i] = A[i]![p]!;
          A[i]![q] = s * aip + c * aiq;
          A[q]![i] = A[i]![q]!;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i]![p]!;
          const viq = V[i]![q]!;
          V[i]![p] = c * vip - s * viq;
          V[i]![q] = s * vip + c * viq;
        }
      }
    }
  }
  const indexed = A.map((row, i) => ({ value: row[i]!, i })).sort((a, b) => b.value - a.value);
  const values = indexed.map((item) => item.value);
  const vectors = zeros(n, n);
  for (let j = 0; j < n; j++) {
    const src = indexed[j]!.i;
    for (let i = 0; i < n; i++) vectors[i]![j] = V[i]![src]!;
  }
  return { values, vectors };
}

export function truncatedSvd(X: number[][], rank: number): ThinSvd {
  if (X.length === 0 || !X[0]?.length) throw new Error("svd of empty matrix");
  const k = X.length;
  const d = X[0].length;
  const r = Math.max(1, Math.min(rank, k, d));
  const { values, vectors } = jacobiEigen(gram(X));
  const singularValues = values.slice(0, r).map((value) => Math.sqrt(Math.max(value, 0)));
  const V = zeros(d, r);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < r; j++) V[i]![j] = vectors[i]![j]!;
  }
  const U = zeros(k, r);
  for (let row = 0; row < k; row++) {
    for (let j = 0; j < r; j++) {
      let sum = 0;
      for (let col = 0; col < d; col++) sum += X[row]![col]! * V[col]![j]!;
      U[row]![j] = singularValues[j]! > 1e-12 ? sum / singularValues[j]! : 0;
    }
  }
  return { U, singularValues, V };
}

export function projectRows(X: number[][], V: number[][]): number[][] {
  return multiply(X, V);
}

export function projectVector(x: readonly number[], V: number[][]): number[] {
  const r = V[0]?.length ?? 0;
  const out = Array.from({ length: r }, () => 0);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    if (xi === 0) continue;
    const row = V[i];
    if (!row) continue;
    for (let j = 0; j < r; j++) out[j] += xi * row[j]!;
  }
  return out;
}

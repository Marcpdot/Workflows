/** Filesystem snapshot of S, O, catalog rows, and the embedder. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TensorCore } from "./core.js";
import type { Factor } from "./encode.js";
import type { LsaSnapshot } from "./lsa.js";

export interface TensorSnapshot {
  encodeId: string;
  S: Factor;
  O?: Factor;
  V?: number[][];
  lsa?: LsaSnapshot;
  rows: TensorCore["rows"];
}

export async function writeSnapshot(dir: string, snapshot: TensorSnapshot): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "snapshot.json");
  await writeFile(path, JSON.stringify(snapshot), "utf8");
  return path;
}

export async function readSnapshot(dir: string): Promise<TensorSnapshot> {
  const raw = await readFile(join(dir, "snapshot.json"), "utf8");
  return JSON.parse(raw) as TensorSnapshot;
}

export function coreFromSnapshot(snapshot: TensorSnapshot): TensorCore {
  return {
    encodeId: snapshot.encodeId,
    S: snapshot.S,
    rows: snapshot.rows,
  };
}

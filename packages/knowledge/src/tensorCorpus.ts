/** Build S from a directory of sources and reopen it from snapshot. */

import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ask, createCore, ingest, type TensorCore } from "./core.js";
import {
  channelOf,
  encodeFile,
  encodeId,
  loadSourceText,
  rowsFromText,
  type EncodeEmbedder,
} from "./encode.js";
import { createLsaEmbedder, LsaEmbedder, type LsaSnapshot } from "./lsa.js";
import { identityOperator } from "./operator.js";
import { coreFromSnapshot, readSnapshot, writeSnapshot } from "./tensorStore.js";

const SOURCE_EXT = new Set([".md", ".txt", ".pdf"]);

export async function listSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...(await listSourceFiles(path)));
      continue;
    }
    if (SOURCE_EXT.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort();
}

export interface BuiltTensorStore {
  storeDir: string;
  core: TensorCore;
  embedder: LsaEmbedder;
  files: string[];
  skipped: string[];
  rows: number;
}

export async function buildTensorFromDir(input: {
  sourceDir: string;
  storeDir: string;
  rank?: number;
}): Promise<BuiltTensorStore> {
  const files = await listSourceFiles(input.sourceDir);
  if (files.length === 0) throw new Error("no .md/.txt/.pdf under " + input.sourceDir);

  const loaded: { path: string }[] = [];
  const skipped: string[] = [];
  const rowTexts: string[] = [];
  for (const path of files) {
    try {
      const source = await loadSourceText(path);
      const rows = rowsFromText(source.text);
      if (rows.length === 0) {
        skipped.push(path);
        continue;
      }
      loaded.push({ path });
      for (const row of rows) rowTexts.push(row.text);
    } catch (error) {
      skipped.push(path);
      console.warn("skip", basename(path), error instanceof Error ? error.message : error);
    }
  }
  if (rowTexts.length === 0) throw new Error("sources produced no rows");

  const embedder = createLsaEmbedder();
  embedder.fit(rowTexts, input.rank ?? Math.min(8, rowTexts.length));

  let core = createCore(
    encodeId(embedder.model, embedder.modelVersion, embedder.dimension, channelOf(embedder))
  );
  for (const file of loaded) {
    core = ingest(core, await encodeFile(file.path, embedder));
  }

  await writeSnapshot(input.storeDir, {
    encodeId: core.encodeId,
    S: core.S,
    O: identityOperator(core.S.shape[1] ?? 0, channelOf(embedder)),
    V: embedder.V ?? undefined,
    rows: core.rows,
    lsa: embedder.toJSON(),
  });

  return {
    storeDir: input.storeDir,
    core,
    embedder,
    files: loaded.map((file) => file.path),
    skipped,
    rows: core.rows.length,
  };
}

export async function openTensorStore(storeDir: string): Promise<{
  core: TensorCore;
  embedder: LsaEmbedder;
}> {
  const snap = await readSnapshot(storeDir);
  if (!snap.lsa) throw new Error("snapshot has no lsa embedder; rebuild the store");
  return {
    core: coreFromSnapshot(snap),
    embedder: LsaEmbedder.fromJSON(snap.lsa),
  };
}

export async function askStore(
  storeDir: string,
  question: string,
  options?: { limit?: number }
) {
  const opened = await openTensorStore(storeDir);
  return ask(opened.core, question, opened.embedder as EncodeEmbedder, options);
}

export type { LsaSnapshot };

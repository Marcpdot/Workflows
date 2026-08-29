/**
 * npx tsx scripts/tensor.ts build ..\\..\\work .tensor-store 8
 * npx tsx scripts/tensor.ts ask .tensor-store "spørsmål"
 */

import { mkdir } from "node:fs/promises";
import { askStore, buildTensorFromDir } from "../src/tensorCorpus.ts";

async function main(): Promise<void> {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "build") {
    const sourceDir = a ?? "src";
    const storeDir = b ?? ".tensor-store";
    const rank = c ? Number(c) : 8;
    await mkdir(storeDir, { recursive: true });
    const built = await buildTensorFromDir({ sourceDir, storeDir, rank });
    console.log(`built ${built.rows} rows from ${built.files.length} files`);
    if (built.skipped.length) console.log(`skipped ${built.skipped.length} empty/unreadable files`);
    console.log(built.core.encodeId);
    return;
  }
  if (cmd === "ask") {
    const storeDir = a ?? ".tensor-store";
    const query = b ?? "";
    if (!query) throw new Error('usage: npx tsx scripts/tensor.ts ask .tensor-store "spørsmål"');
    const hits = await askStore(storeDir, query, { limit: 5 });
    for (const hit of hits) {
      const name = (hit.ref.sourcePath ?? "").split(/[\\/]/).pop();
      console.log(hit.score.toFixed(3), name);
      console.log(hit.ref.row.text.slice(0, 300).replace(/\n/g, " "));
      console.log();
    }
    return;
  }
  throw new Error("usage: npx tsx scripts/tensor.ts build|ask ...");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

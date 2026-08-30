/**
 * npx tsx scripts/tensor.ts build ..\\..\\work .tensor-store 8
 * npx tsx scripts/tensor.ts ask .tensor-store "spørsmål"
 * npx tsx scripts/tensor.ts ocr path\to\file.pdf
 */

import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { extractPdfOcr, extractPdfJsText } from "../src/pdfOcr.ts";
import { extractPdfText } from "../src/pdfText.ts";
import { looksGarbled } from "../src/pdfQuality.ts";
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
  if (cmd === "ocr") {
    const path = a;
    if (!path) throw new Error("usage: npx tsx scripts/tensor.ts ocr file.pdf");
    process.env.TENSOR_OCR = process.env.TENSOR_OCR || "1";
    const data = await readFile(path);
    const first = await extractPdfText(data);
    const jsText = await extractPdfJsText(data).catch(() => "");
    const ocr = await extractPdfOcr(data);
    console.log("ocr env", process.env.TENSOR_OCR, "pages", process.env.TENSOR_OCR_PAGES ?? "default");
    console.log("pdf-parse chars", first.chars, "garbled", looksGarbled(first.text), first.text.slice(0, 120));
    console.log("pdfjs chars", jsText.length, "garbled", looksGarbled(jsText), jsText.slice(0, 120));
    console.log("ocr used", ocr.used, "pages", ocr.pages, ocr.error ?? "");
    console.log(ocr.text.slice(0, 500) || "(no ocr text)");
    return;
  }
  throw new Error("usage: npx tsx scripts/tensor.ts build|ask|ocr ...");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

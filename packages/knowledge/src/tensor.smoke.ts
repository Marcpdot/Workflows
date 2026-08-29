/** Exit 1 if the tensor loop regresses. Run: npx tsx src/tensor.smoke.ts */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRegistered } from "./axes.js";
import {
  EmptyQueryError,
  encodeFile,
  encodeId,
  encodeQuery,
  rowsFromText,
} from "./encode.js";
import { createTfidfEmbedder } from "./tfidf.js";
import { createLsaEmbedder } from "./lsa.js";
import { truncatedSvd } from "./svd.js";
import { ask, createCore, ingest, ingestTextSource, read } from "./core.js";
import { applyOperator, identityOperator } from "./operator.js";
import { coreFromSnapshot, readSnapshot, writeSnapshot } from "./tensorStore.js";
import { minimalPdf } from "./minimalPdf.js";

function expect(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

export async function runTensorSmoke(): Promise<void> {
  assertRegistered("d,kd->k");
  assertRegistered("r,kr->k");

  const short = rowsFromText("Catalog husker sourceId og radtekst.");
  expect(short.length === 1, "short paragraph must remain a row");

  const notes = [
    { sourcePath: "a.md", text: "Catalog husker sourceId slik at kunnskap kan hentes tilbake." },
    { sourcePath: "b.md", text: "Ultron bygget en kropp av vibranium i Sokovia." },
  ];
  const texts = notes.map((note) => note.text);

  const tfidf = createTfidfEmbedder();
  tfidf.fit(texts);
  let core = createCore(encodeId(tfidf.model, tfidf.modelVersion, tfidf.dimension, "d"));
  for (const note of notes) core = await ingestTextSource(core, { embedder: tfidf, ...note });
  const tfidfHits = await ask(core, "hente kunnskap fra catalog", tfidf);
  expect(tfidfHits[0]?.ref.sourcePath === "a.md", "tfidf top was " + tfidfHits[0]?.ref.sourcePath);

  const lsa = createLsaEmbedder();
  lsa.fit(texts, 2);
  expect(lsa.channel === "r", "lsa channel must be r");
  core = createCore(encodeId(lsa.model, lsa.modelVersion, lsa.dimension, "r"));
  for (const note of notes) core = await ingestTextSource(core, { embedder: lsa, ...note });
  expect(core.S.axes.join("") === "kr", "S axes were " + core.S.axes.join(","));
  const lsaHits = await ask(core, "hente kunnskap fra catalog", lsa);
  expect(lsaHits[0]?.ref.sourcePath === "a.md", "lsa top was " + lsaHits[0]?.ref.sourcePath);
  expect((lsaHits.find((hit) => hit.ref.sourcePath === "b.md")?.score ?? 1) < 0.2, "ultron should stay low");

  const X = texts.map((text) => tfidf.vectorize(text));
  const svd = truncatedSvd(X, 2);
  expect(svd.singularValues.length === 2, "expected rank-2 SVD");
  expect(svd.singularValues[0]! >= svd.singularValues[1]!, "singular values must descend");

  let empty = false;
  try {
    await encodeQuery("xyzzy plugh qwerty", lsa);
  } catch (error) {
    empty = error instanceof EmptyQueryError;
  }
  expect(empty, "OOV query must throw EmptyQueryError");

  const O = identityOperator(core.S.shape[1] ?? 0, "r");
  const mapped = applyOperator(core.S, O);
  const delta = mapped.values.reduce((sum, value, i) => sum + Math.abs(value - core.S.values[i]!), 0);
  expect(delta < 1e-9, "identity O must leave S unchanged");

  const dir = await mkdtemp(join(tmpdir(), "tensor-core-"));
  await writeSnapshot(dir, {
    encodeId: core.encodeId,
    S: core.S,
    O,
    V: lsa.V ?? undefined,
    rows: core.rows,
  });
  const loaded = coreFromSnapshot(await readSnapshot(dir));
  expect(loaded.encodeId === core.encodeId, "snapshot encodeId drifted");
  expect(loaded.rows.length === core.rows.length, "snapshot dropped rows");
  const q = await encodeQuery("hente kunnskap fra catalog", lsa);
  expect(read(loaded, q.vector)[0]?.ref.sourcePath === "a.md", "snapshot read lost ranking");

  const pdfDir = await mkdtemp(join(tmpdir(), "tensor-pdf-"));
  const pdfPath = join(pdfDir, "note.pdf");
  await writeFile(pdfPath, minimalPdf("Catalog knowledge can be fetched from the file."));
  const encodedPdf = await encodeFile(pdfPath, tfidf);
  expect(encodedPdf.catalog.evidence === "pdf", "pdf evidence type missing");
  expect(encodedPdf.X.shape[0]! >= 1, "pdf encode produced no rows");
  const withPdf = ingest(core, encodedPdf);
  expect(withPdf.rows.some((row) => row.evidence === "pdf"), "pdf row never reached S");

  console.log("tensor.smoke ok");
}

const isMain = process.argv[1]?.includes("tensor.smoke");
if (isMain) {
  runTensorSmoke().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

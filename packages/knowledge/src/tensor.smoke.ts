/** Exit 1 if the tensor loop regresses. Run: npx tsx src/tensor.smoke.ts */

import { assertRegistered } from "./axes.js";
import {
  EmptyQueryError,
  encodeId,
  encodeQuery,
  rowsFromText,
} from "./encode.js";
import { createTfidfEmbedder } from "./tfidf.js";
import { createLsaEmbedder } from "./lsa.js";
import { truncatedSvd } from "./svd.js";
import { ask, createCore, ingestTextSource } from "./core.js";

function expect(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

async function main(): Promise<void> {
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
  expect(tfidfHits[0]?.ref.sourcePath === "a.md", `tfidf top was ${tfidfHits[0]?.ref.sourcePath}`);

  const lsa = createLsaEmbedder();
  lsa.fit(texts, 2);
  expect(lsa.channel === "r", "lsa channel must be r");
  core = createCore(encodeId(lsa.model, lsa.modelVersion, lsa.dimension, "r"));
  for (const note of notes) core = await ingestTextSource(core, { embedder: lsa, ...note });
  expect(core.S.axes.join("") === "kr", `S axes were ${core.S.axes.join(",")}`);
  const lsaHits = await ask(core, "hente kunnskap fra catalog", lsa);
  expect(lsaHits[0]?.ref.sourcePath === "a.md", `lsa top was ${lsaHits[0]?.ref.sourcePath}`);
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

  console.log("tensor.smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

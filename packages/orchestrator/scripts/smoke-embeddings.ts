/**
 * Offline smoke for Milestone 4 embeddings (mock embedder — no Ollama).
 *
 * 1. like texts → higher cosine than unrelated
 * 2. upsert + search returns expected ref
 * 3. deleteByRef removes hits
 * 4. keyword/LTM path works without embeddings (unit-level)
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  MockEmbedder,
  SqliteVectorStore,
  cosineSimilarity,
  semanticSearch,
} from "@workflows/embeddings";
import { createLongTermMemory } from "@workflows/memory/longterm";
import { retrieve } from "@workflows/retrieval";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const embedder = new MockEmbedder();

  // 1. Cosine: similar > dissimilar
  const [a, b, c] = await embedder.embed([
    "user prefers dark mode settings",
    "dark mode preference for the UI",
    "completely unrelated quantum physics",
  ]);
  const simClose = cosineSimilarity(a!, b!);
  const simFar = cosineSimilarity(a!, c!);
  assert(simClose > simFar, `expected closer > far (${simClose} vs ${simFar})`);
  assert(simClose > 0.2, "similar texts should share score mass");
  console.log(`OK: cosine similar=${simClose.toFixed(3)} far=${simFar.toFixed(3)}`);

  // 2–3. Store upsert/search/delete
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_vectors_${Date.now()}.db`
  );
  const store = new SqliteVectorStore(dbPath);

  try {
    const [v1] = await embedder.embed(["Ada likes TypeScript tooling"]);
    await store.upsert({
      id: "t1",
      source: "ltm",
      refId: "fact-ada",
      text: "Ada likes TypeScript tooling",
      vector: v1!,
    });

    const hits = await semanticSearch(
      "TypeScript tools Ada",
      { embedder, store },
      { limit: 5, source: "ltm", minScore: 0.1 }
    );
    assert(hits.length >= 1, "expected at least one hit");
    assert(hits[0]!.record.refId === "fact-ada", "expected fact-ada ref");
    console.log(`OK: upsert+search score=${hits[0]!.score.toFixed(3)}`);

    await store.deleteByRef("ltm", "fact-ada");
    const after = await semanticSearch(
      "TypeScript tools Ada",
      { embedder, store },
      { limit: 5, source: "ltm", minScore: 0.1 }
    );
    assert(after.length === 0, "deleteByRef should remove hit");
    console.log("OK: deleteByRef");

    // 4. LTM with embeddings + without
    const ltmPath = resolve(
      process.cwd(),
      "data",
      `_smoke_ltm_emb_${Date.now()}.db`
    );
    const ltm = createLongTermMemory({
      dbPath: ltmPath,
      embeddings: { embedder, store, minScore: 0.05 },
    });
    try {
      await ltm.remember({
        content: "Preferred editor is VS Code",
        key: "user.editor",
      });
      const rec = await ltm.recall({ text: "editor preference VS", limit: 5 });
      assert(
        rec.some((f) => f.content.includes("VS Code")),
        "LTM semantic/keyword recall should find editor fact"
      );
      await ltm.forget("user.editor");
      console.log("OK: LTM remember/recall/forget with embeddings");
    } finally {
      ltm.close();
      cleanupDb(ltmPath);
    }

    // Retrieval without embeddings still works
    const kwOnly = await retrieve("Ada", {
      sessionMessages: [
        { role: "user", content: "My name is Ada" },
        { role: "assistant", content: "Hi Ada" },
      ],
      projectContext: false,
    });
    assert(kwOnly.length > 0, "keyword retrieval without embeddings");
    console.log("OK: keyword retrieval when embeddings absent");

    // Retrieval with embeddings (empty store → keyword still works)
    const hybrid = await retrieve("Ada", {
      sessionMessages: [
        { role: "user", content: "My name is Ada" },
        { role: "assistant", content: "Hi Ada" },
      ],
      projectContext: false,
      embeddings: { embedder, store, minScore: 0.1 },
    });
    assert(hybrid.length > 0, "hybrid path still returns session keyword hits");
    console.log("OK: hybrid retrieval falls back / merges safely");

    console.log("All embeddings smoke checks passed.");
  } finally {
    store.close();
    cleanupDb(dbPath);
  }
}

function cleanupDb(path: string): void {
  for (const s of ["", "-wal", "-shm"]) {
    const p = path + s;
    if (existsSync(p)) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

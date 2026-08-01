/**
 * Offline smoke test for retrieval (no network, no models).
 *
 * 1. Session keyword hits expected message
 * 2. Project context hits a known phrase from context/memory.md when present
 * 3. limit / maxChars are respected
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  rankAndTruncate,
  resolveDefaultContextDir,
  retrieve,
  type RetrievedChunk,
} from "@workflows/retrieval";
import type { ChatMessage } from "../src/types.js";

async function main(): Promise<void> {
  const sessionMessages: ChatMessage[] = [
    { role: "user", content: "Hei, jeg heter Ada Lovelace." },
    { role: "assistant", content: "Hyggelig, Ada!" },
    { role: "user", content: "Jeg liker kaffe og te." },
    { role: "assistant", content: "Notert om kaffe." },
  ];

  // --- Session keyword ---
  const sessionHits = await retrieve("Ada Lovelace", {
    sessionMessages,
    projectContext: false,
    limit: 4,
    maxChars: 2000,
  });

  if (sessionHits.length === 0) {
    throw new Error("Expected session hits for 'Ada Lovelace'");
  }
  if (!sessionHits.some((c) => c.text.toLowerCase().includes("ada"))) {
    throw new Error("Expected session chunk to contain Ada");
  }
  if (sessionHits.some((c) => c.source !== "session")) {
    throw new Error("Expected only session sources when projectContext=false");
  }
  console.log(`OK: session keyword → ${sessionHits.length} chunk(s)`);

  // --- Project context (if context/ is available) ---
  const contextDir = resolveDefaultContextDir(process.cwd());
  console.log(`contextDir: ${contextDir} (exists=${existsSync(contextDir)})`);

  const projectHits = await retrieve("embeddings Milestone 0", {
    sessionMessages: [],
    projectContext: true,
    contextDir,
    limit: 4,
    maxChars: 2000,
  });

  if (existsSync(resolve(contextDir, "memory.md"))) {
    if (projectHits.length === 0) {
      throw new Error(
        "Expected project_context hits for 'embeddings Milestone 0' against context/memory.md"
      );
    }
    if (!projectHits.some((c) => c.source === "project_context")) {
      throw new Error("Expected project_context source");
    }
    if (
      !projectHits.some(
        (c) =>
          c.text.toLowerCase().includes("embedding") ||
          c.id.includes("memory")
      )
    ) {
      throw new Error(
        "Expected hit related to memory/embeddings from project context"
      );
    }
    console.log(`OK: project context → ${projectHits.length} chunk(s)`);
    console.log(`  top: ${projectHits[0]?.id} score=${projectHits[0]?.score}`);
  } else {
    console.log(
      "SKIP: project context (context/memory.md not found — graceful empty OK)"
    );
    if (projectHits.length !== 0 && !existsSync(contextDir)) {
      throw new Error("Missing context dir should yield empty or file-based only");
    }
  }

  // --- Combined ---
  const combined = await retrieve("Ada SQLite embeddings", {
    sessionMessages,
    contextDir,
    limit: 4,
    maxChars: 2000,
  });
  console.log(`OK: combined retrieve → ${combined.length} chunk(s)`);

  // --- limit / maxChars ---
  const many: RetrievedChunk[] = Array.from({ length: 10 }, (_, i) => ({
    source: "session" as const,
    id: `s:${i}`,
    text: "x".repeat(100),
    score: 10 - i,
  }));

  const limited = rankAndTruncate(many, 3, 2000);
  if (limited.length !== 3) {
    throw new Error(`Expected limit=3, got ${limited.length}`);
  }
  console.log("OK: limit respected");

  const charCapped = rankAndTruncate(many, 10, 150);
  const totalChars = charCapped.reduce((n, c) => n + c.text.length, 0);
  if (totalChars > 150) {
    throw new Error(`Expected maxChars=150, got ${totalChars}`);
  }
  if (charCapped.length === 0) {
    throw new Error("Expected at least one chunk under maxChars budget");
  }
  console.log(`OK: maxChars respected (used=${totalChars})`);

  // --- Empty query ---
  const empty = await retrieve("   ", { sessionMessages, contextDir });
  if (empty.length !== 0) {
    throw new Error("Empty query should return []");
  }
  console.log("OK: empty query → []");

  // --- Missing context dir ---
  const missing = await retrieve("embeddings memory", {
    sessionMessages: [],
    contextDir: resolve(process.cwd(), "definitely-missing-context-dir"),
    projectContext: true,
  });
  if (missing.length !== 0) {
    throw new Error("Missing context dir should return []");
  }
  console.log("OK: missing context dir → []");

  console.log("All retrieval smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

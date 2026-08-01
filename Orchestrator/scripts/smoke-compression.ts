/**
 * Smoke test for compressHistory (no real model call).
 *
 * 1. Build fake history with > threshold messages
 * 2. Run compressHistory with a fake summarizer
 * 3. Verify recentMessages.length === keepRecent and summary is non-empty
 */

import {
  compressHistory,
  type Summarizer,
} from "../src/compression/index.js";
import type { ChatMessage } from "../src/types.js";

function buildFakeHistory(n: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    const content =
      role === "user"
        ? `User turn ${i}: my name is Ada and project is Workflows.`
        : `Assistant turn ${i}: noted, Ada.`;
    messages.push({ role, content });
  }
  return messages;
}

const fakeSummarizer: Summarizer = {
  async summarize(messages) {
    const names = messages.some((m) => m.content.includes("Ada"))
      ? "User is named Ada. "
      : "";
    return `${names}Compressed ${messages.length} older turns about Workflows.`;
  },
};

async function main(): Promise<void> {
  const threshold = 20;
  const keepRecent = 8;

  // Under threshold → no compression
  const short = buildFakeHistory(10);
  const noOp = await compressHistory(
    short,
    { threshold, keepRecent },
    fakeSummarizer
  );
  if (noOp.compressed || noOp.summary !== null) {
    throw new Error("Expected no compression under threshold");
  }
  if (noOp.recentMessages.length !== 10) {
    throw new Error("Expected full history when not compressed");
  }
  console.log("OK: under threshold → compressed=false");

  // Empty → empty
  const empty = await compressHistory(
    [],
    { threshold, keepRecent },
    fakeSummarizer
  );
  if (empty.compressed || empty.recentMessages.length !== 0) {
    throw new Error("Expected empty result for empty history");
  }
  console.log("OK: empty history → empty result");

  // Over threshold → compress
  const long = buildFakeHistory(30);
  const result = await compressHistory(
    long,
    { threshold, keepRecent },
    fakeSummarizer
  );

  if (!result.compressed) {
    throw new Error("Expected compressed=true for 30 messages");
  }
  if (!result.summary || !result.summary.trim()) {
    throw new Error("Expected non-empty summary");
  }
  if (result.recentMessages.length !== keepRecent) {
    throw new Error(
      `Expected recentMessages.length === ${keepRecent}, got ${result.recentMessages.length}`
    );
  }
  if (!result.summary.includes("Ada")) {
    throw new Error("Expected name 'Ada' to survive in summary");
  }

  // Recent messages are the last keepRecent from original
  const expectedRecent = long.slice(-keepRecent);
  for (let i = 0; i < keepRecent; i++) {
    if (result.recentMessages[i]?.content !== expectedRecent[i]?.content) {
      throw new Error(`recentMessages[${i}] mismatch`);
    }
  }

  console.log("OK: over threshold → summary + keepRecent");
  console.log(
    `  summary (${result.summary.length} chars): ${result.summary}`
  );
  console.log(`  recent: ${result.recentMessages.length}`);
  console.log("All compression smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

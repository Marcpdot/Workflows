/**
 * Offline smoke for eval token/cost helpers (no model calls).
 */
import {
  buildCostBreakdown,
  estimateCostUsd,
  estimateTokensFromText,
} from "../src/eval/cost.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// chars/4 heuristic
assert(estimateTokensFromText("") === 0, "empty text → 0");
assert(estimateTokensFromText("abcd") === 1, "4 chars → 1 token");
assert(estimateTokensFromText("a".repeat(9)) === 3, "9 chars → 3 tokens");
console.log("OK: estimateTokensFromText");

// local always $0
const localCost = estimateCostUsd("local", 1000, 500);
assert(localCost.usd === 0, "local cost must be 0");
assert(localCost.note.includes("local"), "local note");
console.log("OK: local cost = 0");

// frontier uses rates
const frontier = estimateCostUsd("frontier", 1_000_000, 1_000_000);
assert(frontier.usd > 0, "frontier cost > 0");
console.log(`OK: frontier 1M+1M ≈ $${frontier.usd}`);

// API usage preferred over estimate
const fromApi = buildCostBreakdown({
  provider: "frontier",
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  promptText: "ignored because usage present",
  replyText: "ignored",
});
assert(fromApi.totalTokens === 150, "use API totalTokens");
assert(fromApi.tokensEstimated === false, "not estimated when usage present");
assert(fromApi.estimatedCostUsd > 0, "frontier cost from usage");
console.log("OK: API usage path");

// Local without usage → estimate from text
const fromText = buildCostBreakdown({
  provider: "local",
  promptText: "x".repeat(40), // 10 tokens
  replyText: "y".repeat(20), // 5 tokens
});
assert(fromText.tokensEstimated === true, "estimated when no usage");
assert(fromText.totalTokens === 15, `expected 15, got ${fromText.totalTokens}`);
assert(fromText.estimatedCostUsd === 0, "local still 0 usd");
assert(fromText.costNote.includes("chars/4"), "note mentions heuristic");
console.log("OK: local estimate path");

// Partial usage still not full-estimate
const partial = buildCostBreakdown({
  provider: "frontier",
  usage: { totalTokens: 80 },
  promptText: "hello",
  replyText: "world",
});
assert(partial.totalTokens === 80, "prefer provided totalTokens");
assert(partial.tokensEstimated === false, "partial usage is not estimate mode");
console.log("OK: partial usage");

console.log("All eval cost smoke checks passed.");

/**
 * Offline smoke for Milestone 3B proactive suggestions.
 */

import { suggestNextSteps } from "@workflows/proactive";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. Bug-like prompt → at least one followup/tool
const bugTips = suggestNextSteps({
  userPrompt: "I get a TypeError crash when running the orchestrator",
  assistantReply:
    "That often comes from a missing null check in orchestrator.ts",
});
assert(bugTips.length >= 1, "bug prompt should yield suggestions");
assert(
  bugTips.some((s) => s.kind === "tool" || s.kind === "followup"),
  "expected tool or followup for bug"
);
console.log(`OK: bug-like → ${bugTips.length} suggestion(s)`);

// 2. Smalltalk → 0
const hi = suggestNextSteps({
  userPrompt: "Hei",
  assistantReply: "Hei! Hva kan jeg hjelpe med?",
});
assert(hi.length === 0, `smalltalk should be empty, got ${hi.length}`);
console.log("OK: smalltalk → 0");

// 3. max respected
const many = suggestNextSteps(
  {
    userPrompt: "bug error crash in src/foo/bar.ts please fix",
    assistantReply: "See Orchestrator/src/orchestrator.ts and package.json",
    retrievedContext: "architecture milestone routing Keep the Why",
  },
  { max: 2 }
);
assert(many.length <= 2, `max=2, got ${many.length}`);
console.log(`OK: max respected (${many.length})`);

// 4. path → tool suggestion
const pathTips = suggestNextSteps({
  userPrompt: "What does the router do?",
  assistantReply: "See Orchestrator/src/router.ts for the rules.",
});
assert(
  pathTips.some((s) => s.kind === "tool" && s.text.includes("router.ts")),
  "expected read_file suggestion for path"
);
console.log("OK: path → tool suggestion");

// 5. architecture context → milestone
const arch = suggestNextSteps({
  userPrompt: "We chose rule-based routing for M0",
  assistantReply: "That matches the architecture doc.",
  retrievedContext: "architecture.md — Milestone 0 foundation routing",
});
assert(
  arch.some((s) => s.kind === "milestone"),
  "expected milestone suggestion"
);
console.log("OK: architecture context → milestone");

// 6. memory intent
const mem = suggestNextSteps({
  userPrompt: "Husk at preferred name er Ada",
  assistantReply: "Notert.",
});
assert(
  mem.some((s) => s.kind === "memory"),
  "expected memory suggestion"
);
console.log("OK: memory intent");

// 7. confidence bounds
for (const s of [...bugTips, ...many, ...pathTips]) {
  assert(s.confidence >= 0 && s.confidence <= 1, "confidence in 0..1");
  assert(!!s.id && !!s.text, "id and text required");
}
console.log("OK: shape checks");

console.log("All proactive smoke checks passed.");

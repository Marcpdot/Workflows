/**
 * Offline smoke for eval assertions + cases.json loading (no model calls).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAssertions } from "../../packages/eval/src/assertions.js";
import type { EvalCase } from "../../packages/eval/src/types.js";
import type { OrchestratorResult } from "../src/types.js";

function mockResult(
  partial: Partial<OrchestratorResult> & { reply: string; route: "local" | "frontier" }
): OrchestratorResult {
  return {
    reply: partial.reply,
    model: partial.model ?? "mock",
    provider: partial.route,
    routing: {
      model: partial.route,
      reason: "mock",
      taskType: "general",
      complexity: "low",
    },
    usage: partial.usage,
    compression: partial.compression,
  };
}

// Cases live in packages/eval after package refactor Step A
const casesPath = resolve(process.cwd(), "../packages/eval/cases.json");
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as EvalCase[];
if (cases.length < 8) {
  throw new Error(`Expected at least 8 cases, got ${cases.length}`);
}
const ids = new Set(cases.map((c) => c.id));
for (const required of [
  "route-summarize-local",
  "route-research-frontier",
  "memory-name-recall",
  "memory-fact-recall",
  "norwegian-brief",
  "code-small-local",
  "reasoning-frontier",
  "compression-smoke",
]) {
  if (!ids.has(required)) throw new Error(`Missing required case: ${required}`);
}
console.log(`OK: loaded ${cases.length} cases`);

const passRoute = runAssertions(
  { id: "t", prompt: "x", expectRoute: "local" },
  mockResult({ reply: "hello", route: "local" })
);
if (passRoute.length) throw new Error(`expected pass, got ${passRoute}`);

const failRoute = runAssertions(
  { id: "t", prompt: "x", expectRoute: "frontier" },
  mockResult({ reply: "hello", route: "local" })
);
if (!failRoute.some((f) => f.includes("expectRoute"))) {
  throw new Error("expected expectRoute failure");
}

const passContains = runAssertions(
  { id: "t", prompt: "x", expectContains: ["Ada"] },
  mockResult({ reply: "Du heter Ada Lovelace", route: "local" })
);
if (passContains.length) throw new Error(`expected pass contains, got ${passContains}`);

const failEmpty = runAssertions(
  { id: "t", prompt: "x", expectRoute: "local" },
  mockResult({ reply: "   ", route: "local" })
);
if (!failEmpty.includes("empty reply")) {
  throw new Error("expected empty reply failure");
}

console.log("OK: assertions behave as expected");
console.log("All eval offline smoke checks passed.");

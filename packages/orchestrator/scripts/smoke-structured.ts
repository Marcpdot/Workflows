/**
 * Offline smoke for Milestone 10 structured output (mock complete — no models).
 *
 * 1. Valid JSON → ok on first attempt
 * 2. Rotten JSON then repair → ok on second attempt
 * 3. Always-bad → ok:false, does not throw
 * 4. Schema validation rejects wrong shape
 * 5. parseToolCalls still works via shared extract (trailing comma)
 */

import {
  completeStructured,
  parseStructured,
  PLAN_SCHEMA,
  tryParseJson,
  tryParseStructured,
  type PlanValue,
} from "@workflows/structured";
import { parseToolCalls } from "@workflows/tools";
import type { ChatMessage } from "../src/types.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const baseMessages: ChatMessage[] = [
    { role: "system", content: "Return plan JSON." },
    { role: "user", content: "Add a smoke test" },
  ];

  // 1. Happy path
  const good = await completeStructured<PlanValue>({
    complete: async () =>
      JSON.stringify({
        steps: ["write smoke", "run smoke"],
        summary: "test plan",
      }),
    messages: baseMessages,
    parse: (raw) => parseStructured<PlanValue>(raw, PLAN_SCHEMA),
    maxAttempts: 2,
  });
  assert(good.ok === true, "good ok");
  assert(good.attempts === 1, "good one attempt");
  assert(good.value?.steps.length === 2, "two steps");
  console.log("OK: valid JSON first attempt");

  // 2. Rotten then repair
  let calls = 0;
  const repaired = await completeStructured<PlanValue>({
    complete: async () => {
      calls++;
      if (calls === 1) {
        return "Sure! Here is a plan:\n{steps: ['a', 'b',]}\nnot valid";
      }
      return JSON.stringify({ steps: ["a", "b"] });
    },
    messages: baseMessages,
    parse: (raw) => {
      const plan = parseStructured<PlanValue>(raw, PLAN_SCHEMA);
      if (!plan.steps?.length) throw new Error("empty steps");
      return plan;
    },
    maxAttempts: 2,
  });
  assert(repaired.ok === true, `repair should ok: ${repaired.error}`);
  assert(repaired.attempts === 2, `expected 2 attempts, got ${repaired.attempts}`);
  assert(repaired.value?.steps[0] === "a", "repaired steps");
  console.log("OK: rotten JSON → repair on second attempt");

  // 3. Always bad → ok:false, no throw
  const bad = await completeStructured<PlanValue>({
    complete: async () => "this is not json at all {{{",
    messages: baseMessages,
    parse: (raw) => parseStructured<PlanValue>(raw, PLAN_SCHEMA),
    maxAttempts: 2,
  });
  assert(bad.ok === false, "always-bad ok:false");
  assert(typeof bad.error === "string" && bad.error.length > 0, "has error");
  assert(bad.raw.includes("not json"), "raw preserved");
  assert(bad.attempts === 2, "used max attempts");
  console.log("OK: always-bad → ok:false without throw");

  // 4. Schema rejects wrong shape
  const wrong = tryParseStructured("{ \"steps\": 1 }", PLAN_SCHEMA);
  assert(wrong.ok === false, "steps must be array");
  const missing = tryParseStructured("{}", PLAN_SCHEMA);
  assert(missing.ok === false, "required steps");
  console.log("OK: schema validation");

  // 5. tryParseJson + tool_calls with trailing comma (lenient)
  const withComma = tryParseJson(
    '```json\n{"tool_calls":[{"name":"read_file","args":{"path":"x"}}],}\n```'
  );
  assert(withComma.ok === true, "lenient trailing comma");
  const callsFromText = parseToolCalls(
    'Here:\n```json\n{"tool_calls":[{"name":"list_dir","args":{"path":"."}}]}\n```\n'
  );
  assert(callsFromText.length === 1, "parseToolCalls shared extract");
  assert(callsFromText[0]!.name === "list_dir", "list_dir");
  console.log("OK: extract + parseToolCalls integration");

  // 6. Fenced plan parse
  const fenced = parseStructured<PlanValue>(
    '```json\n{"steps":["one"]}\n```',
    PLAN_SCHEMA
  );
  assert(fenced.steps[0] === "one", "fenced plan");
  console.log("OK: fenced JSON plan");

  console.log("All M10 structured smokes passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

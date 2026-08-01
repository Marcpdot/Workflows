/**
 * Offline smoke for phase B tool loop (mock complete — no models/network).
 *
 * 1. Mock complete asks for read_file, then returns final text
 * 2. registry.execute called once
 * 3. maxSteps=1 + always-tool → hitMaxSteps
 * 4. unknown tool → ok:false in steps, loop can continue
 * 5. parseToolCalls handles prose + fenced JSON
 */

import { resolve } from "node:path";
import {
  createBuiltinRegistry,
  parseToolCalls,
  runToolLoop,
  type ToolCall,
} from "@workflows/tools";
import type { ChatMessage } from "../src/types.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const registry = createBuiltinRegistry();

  // --- parseToolCalls ---
  const parsed = parseToolCalls(
    `Sure, I'll read that.\n\`\`\`json\n{"tool_calls":[{"name":"read_file","args":{"path":"package.json"}}]}\n\`\`\`\n`
  );
  assert(parsed.length === 1, "expected 1 parsed call");
  assert(parsed[0]!.name === "read_file", "name read_file");
  assert(parsed[0]!.args.path === "package.json", "path arg");
  assert(parseToolCalls("just a normal answer").length === 0, "no calls");
  assert(parseToolCalls("{not json").length === 0, "messy → []");
  console.log("OK: parseToolCalls");

  // --- happy path: tool then final ---
  let completeCalls = 0;
  let executed = 0;
  const countingRegistry = createBuiltinRegistry();
  const origExecute = countingRegistry.execute.bind(countingRegistry);
  countingRegistry.execute = async (name, args, ctx) => {
    executed++;
    return origExecute(name, args, ctx);
  };

  const messages: ChatMessage[] = [
    { role: "system", content: "test" },
    { role: "user", content: "What is in package.json name?" },
  ];

  const result = await runToolLoop(messages, {
    maxSteps: 5,
    workspaceRoot,
    registry: countingRegistry,
    complete: async (msgs) => {
      completeCalls++;
      if (completeCalls === 1) {
        return {
          text: JSON.stringify({
            tool_calls: [
              { name: "read_file", args: { path: "package.json" } },
            ],
          }),
        };
      }
      // After tool result is in history, answer.
      const joined = msgs.map((m) => m.content).join("\n");
      assert(joined.includes("Tool result"), "tool result should be in messages");
      return { text: 'The package name is "orchestrator".' };
    },
  });

  assert(result.hitMaxSteps === false, "should not hit max steps");
  assert(executed === 1, `expected 1 execute, got ${executed}`);
  assert(result.steps.length === 1, "one step");
  assert(result.steps[0]!.call.name === "read_file", "read_file step");
  assert(result.steps[0]!.result.ok === true, "read_file ok");
  assert(result.finalText.includes("orchestrator"), "final text");
  console.log("OK: mock read_file loop");

  // --- structured toolCalls path (no JSON in text) ---
  let turn = 0;
  const structured = await runToolLoop(messages, {
    maxSteps: 3,
    workspaceRoot,
    registry,
    complete: async () => {
      turn++;
      if (turn === 1) {
        const calls: ToolCall[] = [
          {
            id: "c1",
            name: "list_dir",
            args: { path: "." },
          },
        ];
        return { text: "", toolCalls: calls };
      }
      return { text: "listed ok" };
    },
  });
  assert(structured.steps[0]?.call.name === "list_dir", "structured list_dir");
  assert(structured.steps[0]?.result.ok === true, "list_dir ok");
  assert(structured.finalText === "listed ok", "structured final");
  console.log("OK: structured toolCalls path");

  // --- maxSteps ---
  const maxed = await runToolLoop(messages, {
    maxSteps: 1,
    workspaceRoot,
    registry,
    complete: async () => ({
      text: JSON.stringify({
        tool_calls: [{ name: "list_dir", args: { path: "." } }],
      }),
    }),
  });
  assert(maxed.hitMaxSteps === true, "hitMaxSteps");
  assert(maxed.steps.length === 1, "one step at max");
  console.log("OK: maxSteps → hitMaxSteps");

  // --- unknown tool then continue ---
  let u = 0;
  const unknown = await runToolLoop(messages, {
    maxSteps: 3,
    workspaceRoot,
    registry,
    complete: async () => {
      u++;
      if (u === 1) {
        return {
          text: JSON.stringify({
            tool_calls: [{ name: "not_a_real_tool", args: {} }],
          }),
        };
      }
      return { text: "recovered after unknown tool" };
    },
  });
  assert(unknown.steps[0]?.result.ok === false, "unknown tool fails");
  assert(
    unknown.finalText.includes("recovered"),
    "loop continues after unknown"
  );
  console.log("OK: unknown tool ok:false, loop continues");

  console.log("All tool-loop smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Controlled tool loop: model → tool_calls → execute → append → model …
 * Seeds workspace tool intent from the user prompt so self-access does not
 * depend on the model emitting perfect tool_call JSON.
 */

import { parseToolCalls } from "./parseToolCalls.js";
import { inferWorkspaceToolCallsFromUserPrompt } from "./recoverToolCalls.js";
import type {
  ChatMessage,
  ToolCall,
  ToolLoopOptions,
  ToolLoopResult,
  ToolLoopStep,
} from "./types.js";

const DEFAULT_MAX_STEPS = 5;

function formatToolResultMessage(
  name: string,
  id: string,
  ok: boolean,
  output: string,
  error?: string
): string {
  const status = ok ? "ok" : "error";
  const body = ok
    ? output
    : `${error ?? "tool failed"}${output ? `\n${output}` : ""}`;
  const capped =
    body.length > 12_000 ? body.slice(0, 12_000) + "\n…[truncated]" : body;
  return `Tool result for ${name} (id=${id}, ${status}):\n${capped}`;
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "user" && msg.content?.trim()) return msg.content;
  }
  return "";
}

async function executeCalls(
  calls: ToolCall[],
  options: ToolLoopOptions,
  messages: ChatMessage[],
  steps: ToolLoopStep[],
  modelOutputExperienceId?: string
): Promise<void> {
  const ctx = { workspaceRoot: options.workspaceRoot };
  for (const call of calls) {
    const toolCallExperienceId = await options.onToolCall?.(
      call,
      modelOutputExperienceId
    );
    const started = performance.now();
    const result = await options.registry.execute(call.name, call.args, ctx);
    const durationMs = Math.round(performance.now() - started);

    const loopStep: ToolLoopStep = { call, result, durationMs };
    steps.push(loopStep);
    await options.onToolResult?.(loopStep, toolCallExperienceId || undefined);

    messages.push({
      role: "user",
      content: formatToolResultMessage(
        call.name,
        call.id,
        result.ok,
        result.output,
        result.error
      ),
    });
  }
}

/**
 * Run the model/tool loop until the model stops requesting tools or maxSteps.
 */
export async function runToolLoop(
  initialMessages: ChatMessage[],
  options: ToolLoopOptions
): Promise<ToolLoopResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: ChatMessage[] = [...initialMessages];
  const steps: ToolLoopStep[] = [];
  let lastText = "";

  const tools = options.registry.list();

  // Deterministic self-access: clear workspace intent → execute tools first.
  const seeded = inferWorkspaceToolCallsFromUserPrompt(lastUserText(messages));
  if (seeded.length > 0) {
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        tool_calls: seeded.map((c) => ({ name: c.name, args: c.args })),
        note: "seeded from user prompt (system self-access)",
      }),
    });
    await executeCalls(seeded, options, messages, steps);
  }

  for (let step = 1; step <= maxSteps; step++) {
    const response = await options.complete(messages, tools);
    lastText = response.text ?? "";

    const structured =
      response.toolCalls && response.toolCalls.length > 0
        ? response.toolCalls
        : undefined;
    const calls = structured ?? parseToolCalls(lastText);
    const modelOutputExperienceId = await options.onModelOutput?.({
      ...response,
      toolCalls: calls.length > 0 ? calls : undefined,
    });

    if (calls.length === 0) {
      return {
        finalText: lastText,
        steps,
        hitMaxSteps: false,
      };
    }

    messages.push({
      role: "assistant",
      content:
        lastText.trim() ||
        JSON.stringify({
          tool_calls: calls.map((c) => ({ name: c.name, args: c.args })),
        }),
    });

    await executeCalls(
      calls,
      options,
      messages,
      steps,
      modelOutputExperienceId || undefined
    );
  }

  return {
    finalText: lastText.trim() || "(max tool steps reached)",
    steps,
    hitMaxSteps: true,
  };
}

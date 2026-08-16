/**
 * Controlled tool loop: model → tool_calls → execute → append → model …
 */

import { parseToolCalls } from "./parseToolCalls.js";
import type {
  ChatMessage,
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
  // Cap very large tool outputs so the next model turn stays usable.
  const capped =
    body.length > 12_000 ? body.slice(0, 12_000) + "\n…[truncated]" : body;
  return `Tool result for ${name} (id=${id}, ${status}):\n${capped}`;
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
  const ctx = { workspaceRoot: options.workspaceRoot };

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

    // Record assistant turn (include text so the model sees its own call intent).
    messages.push({
      role: "assistant",
      content:
        lastText.trim() ||
        JSON.stringify({
          tool_calls: calls.map((c) => ({ name: c.name, args: c.args })),
        }),
    });

    for (const call of calls) {
      const toolCallExperienceId = await options.onToolCall?.(
        call,
        modelOutputExperienceId || undefined
      );
      const started = performance.now();
      const result = await options.registry.execute(call.name, call.args, ctx);
      const durationMs = Math.round(performance.now() - started);

      const loopStep: ToolLoopStep = { call, result, durationMs };
      steps.push(loopStep);
      await options.onToolResult?.(
        loopStep,
        toolCallExperienceId || undefined
      );

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

  return {
    finalText: lastText.trim() || "(max tool steps reached)",
    steps,
    hitMaxSteps: true,
  };
}

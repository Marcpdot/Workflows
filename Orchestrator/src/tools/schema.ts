/**
 * Model-facing tool schemas (provider-agnostic).
 * Provider wrappers (OpenAI tools[], etc.) live in model clients.
 */

import type { ModelToolSchema, Tool } from "./types.js";

export function toModelToolSchemas(tools: Tool[]): ModelToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters.map((p) => ({ ...p })),
  }));
}

/** Short system-prompt addendum when the tool loop is enabled. */
export const TOOLS_SYSTEM_ADDENDUM = `You can call tools when you need file or command information.
Only use listed tools. Prefer read_file/list_dir before run_command.
To call tools, reply with a JSON object (optionally in a fenced code block):
{"tool_calls":[{"name":"read_file","args":{"path":"package.json"}}]}
When done, answer the user in plain text without tool calls.`;

export function formatToolsForPrompt(tools: Tool[]): string {
  if (tools.length === 0) return "";
  const lines = tools.map((t) => {
    const params = t.parameters
      .map(
        (p) =>
          `${p.name}${p.required ? "*" : ""}:${p.type}` +
          (p.description ? ` — ${p.description}` : "")
      )
      .join("; ");
    return `- ${t.name}: ${t.description}${params ? ` (${params})` : ""}`;
  });
  return `Available tools:\n${lines.join("\n")}`;
}

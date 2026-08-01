/**
 * Built-in agent roles (Milestone 3C) — generic prompts, no personal profile.
 */

import type { AgentRole } from "./types.js";

/** Break down the task; prefer read-only tools only. */
export const plannerRole: AgentRole = {
  name: "planner",
  modelPreference: "local",
  toolsAllowed: ["read_file", "list_dir", "search_files"],
  systemPrompt: `You are the planner role in a short sequential pipeline.
Break the user task into a clear, ordered plan.
- List concrete steps the worker should take.
- Name files or tools when relevant.
- Do not implement the full solution yourself.
- Keep the plan concise (bullet list).
- No personal user profile assumptions.`,
};

/** Execute following the plan; full tools allowed. */
export const workerRole: AgentRole = {
  name: "worker",
  modelPreference: "local",
  // undefined = all tools from registry
  toolsAllowed: undefined,
  systemPrompt: `You are the worker role in a short sequential pipeline.
Follow the planner's plan and produce the final answer.
- Use tools when you need files or commands.
- Prefer read_file/list_dir/search_files before run_command.
- When done, answer clearly without further tool calls.
- No personal user profile assumptions.`,
};

/** Default two-stage pipeline: planner → worker. */
export function defaultPipelineRoles(): AgentRole[] {
  return [plannerRole, workerRole];
}

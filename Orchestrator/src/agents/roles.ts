/**
 * Built-in agent roles (Milestone 3C) — generic prompts, no personal profile.
 */

import type { AgentRole } from "./types.js";

/** Break down the task; structured JSON plan (M10), no tools. */
export const plannerRole: AgentRole = {
  name: "planner",
  modelPreference: "local",
  // empty = no tools; structured plan via completeStructured in orchestrator
  toolsAllowed: [],
  systemPrompt: `You are the planner role in a short sequential pipeline.
Break the user task into a clear, ordered plan for the worker.
- Name files or tools when relevant.
- Do not implement the full solution yourself.
- No personal user profile assumptions.
- Respond with ONLY valid JSON matching:
  {"steps":["step 1","step 2",...],"summary":"optional one-line overview"}
- steps must be a non-empty array of strings.
- No markdown fences unless necessary; no prose outside JSON.`,
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

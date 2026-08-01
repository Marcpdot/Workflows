/**
 * Sequential multi-role pipeline (Milestone 3C).
 * Not a swarm — ordered stages only.
 */

import type {
  PipelineResult,
  PipelineStageResult,
  RolePipelineOptions,
} from "./types.js";

/**
 * Run roles one after another. Each stage sees the task and prior stage texts.
 */
export async function runRolePipeline(
  options: RolePipelineOptions
): Promise<PipelineResult> {
  if (!options.roles || options.roles.length === 0) {
    throw new Error("runRolePipeline: roles must be a non-empty array");
  }
  if (!options.task?.trim()) {
    throw new Error("runRolePipeline: task must be a non-empty string");
  }
  if (typeof options.runStage !== "function") {
    throw new Error("runRolePipeline: runStage callback is required");
  }

  const stages: PipelineStageResult[] = [];

  for (const role of options.roles) {
    if (!role?.name?.trim()) {
      throw new Error("runRolePipeline: each role must have a name");
    }

    const out = await options.runStage({
      role,
      task: options.task,
      priorStages: [...stages],
    });

    const text = (out.text ?? "").trim();
    stages.push({
      role: role.name,
      text,
      toolSteps: out.toolSteps,
      structured: out.structured,
      structuredOk: out.structuredOk,
      structuredError: out.structuredError,
      structuredAttempts: out.structuredAttempts,
    });
  }

  const last = stages[stages.length - 1];
  return {
    finalText: last?.text ?? "",
    stages,
  };
}

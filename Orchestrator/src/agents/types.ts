import type { ToolLoopStep } from "../tools/types.js";
import type { ModelChoice } from "../types.js";

export interface AgentRole {
  name: string;
  systemPrompt: string;
  /**
   * If set, only these tools are exposed.
   * empty array = no tools; undefined = all registry tools.
   */
  toolsAllowed?: string[];
  modelPreference?: ModelChoice;
}

export interface PipelineStageResult {
  role: string;
  text: string;
  toolSteps?: ToolLoopStep[];
}

export interface PipelineResult {
  finalText: string;
  stages: PipelineStageResult[];
}

export interface RunStageInput {
  role: AgentRole;
  task: string;
  priorStages: PipelineStageResult[];
}

export interface RunStageOutput {
  text: string;
  toolSteps?: ToolLoopStep[];
}

export interface RolePipelineOptions {
  task: string;
  roles: AgentRole[];
  runStage: (input: RunStageInput) => Promise<RunStageOutput>;
}

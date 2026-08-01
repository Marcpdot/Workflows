import type { ToolLoopStep } from "@workflows/tools";

export type ModelChoice = "local" | "mid" | "frontier";

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
  /** Milestone 10 — parsed structured value when stage used completeStructured */
  structured?: unknown;
  structuredOk?: boolean;
  structuredError?: string;
  structuredAttempts?: number;
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
  structured?: unknown;
  structuredOk?: boolean;
  structuredError?: string;
  structuredAttempts?: number;
}

export interface RolePipelineOptions {
  task: string;
  roles: AgentRole[];
  runStage: (input: RunStageInput) => Promise<RunStageOutput>;
}

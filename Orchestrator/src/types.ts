/** Shared types for the orchestrator. */

import type { ToolRegistry } from "./tools/types.js";

export type ModelChoice = "local" | "frontier";

export type TaskType =
  | "summarize"
  | "tool"
  | "code"
  | "research"
  | "reasoning"
  | "general";

export type Complexity = "low" | "medium" | "high";

export interface RoutingDecision {
  model: ModelChoice;
  reason: string;
  taskType: TaskType;
  complexity: Complexity;
  localModel?: string;
  frontierModel?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  provider: ModelChoice;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/** Pluggable model client interface. */
export interface ModelClient {
  readonly provider: ModelChoice;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface CompressionSettings {
  /** Compress when history.length > threshold. Default: 20 */
  threshold: number;
  /** Number of newest messages always kept raw. Default: 8 */
  keepRecent: number;
  /** Soft max characters for summary. Default: 1500 */
  maxSummaryChars: number;
  /** Disable compression entirely. Default: false */
  disabled?: boolean;
}

export interface RetrievalSettings {
  limit: number;
  maxChars: number;
  maxChunkChars: number;
  /** Absolute or relative path to Keep the Why context dir */
  contextDir: string;
  disabled?: boolean;
}

export interface OrchestratorConfig {
  ollamaBin: string;
  ollamaModel: string;
  xaiApiKey: string;
  xaiBaseUrl: string;
  grokModel: string;
  systemPrompt: string;
  compression: CompressionSettings;
  retrieval: RetrievalSettings;
  /** Workspace root for tools (path safety). Default: process.cwd() */
  workspaceRoot: string;
  /**
   * Optional tool registry (Milestone 2 phase A).
   * Not auto-invoked by handle() — use getTools()/runTool() or phase B later.
   */
  tools?: ToolRegistry;
}

export interface OrchestratorResult {
  reply: string;
  routing: RoutingDecision;
  model: string;
  provider: ModelChoice;
  usage?: ModelResponse["usage"];
  /** Present when history was considered for compression */
  compression?: {
    compressed: boolean;
    summary: string | null;
    recentCount: number;
    originalCount: number;
  };
  /** Present when retrieval ran */
  retrieval?: {
    chunkCount: number;
    sources: string[];
    chars: number;
  };
}

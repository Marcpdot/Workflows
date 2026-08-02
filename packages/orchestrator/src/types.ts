/** Shared types for the orchestrator. */

import type {
  ToolRegistry,
  ToolLoopStep,
  ModelToolSchema,
} from "@workflows/tools";
import type { LongTermMemory, LongTermSettings } from "@workflows/memory";
import type { ProactiveSettings, Suggestion } from "@workflows/proactive";
import type { Embedder, VectorStore } from "@workflows/embeddings";
import type { ComputePolicy, PolicyDecision } from "@workflows/policy";
import type { Observer } from "@workflows/observability";
import type { WorkspaceContext } from "@workflows/workspace";
import type { KnowledgeStore } from "@workflows/knowledge";

export type ModelChoice = "local" | "mid" | "frontier";

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
  /** Provider-agnostic tool schemas; clients may wrap for their API */
  tools?: ModelToolSchema[];
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
  /** Structured tool calls when the provider returns them */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
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
  /** Milestone 9 resolved workspace (session namespace + project context) */
  workspace?: WorkspaceContext;
  /**
   * Optional tool registry (Milestone 2).
   * Phase B auto-loop only when toolsEnabled is true.
   */
  tools?: ToolRegistry;
  /** When true and tools are configured, handle() runs the tool loop */
  toolsEnabled: boolean;
  /** Max model↔tool rounds in the loop. Default 5 */
  toolsMaxSteps: number;
  /**
   * Optional long-term memory (Milestone 3A).
   * Not required for chat; exposed as orch.longTerm. Auto-inject is off by default.
   */
  longTerm?: LongTermMemory;
  longTermSettings?: LongTermSettings;
  /** Milestone 3B — next-step suggestions (default off) */
  proactive?: ProactiveSettings;
  /**
   * Milestone 4 embeddings. When set, LTM + retrieval may use semantic search.
   * Default unset / disabled via EMBEDDINGS_ENABLED=false.
   */
  embeddings?: {
    embedder: Embedder;
    store: VectorStore;
    minScore: number;
  };
  /** Milestone 7 compute policy (budget + tier) */
  policy?: ComputePolicy;
  midModel?: string;
  /** Milestone 8 observability sink */
  observer?: Observer;
  /** When true, include truncated prompt in request events */
  obsLogPrompts?: boolean;
  /**
   * Milestone 12/13 knowledge store (optional).
   * Tools registered when KNOWLEDGE_TOOLS_ENABLED; inject when KNOWLEDGE_INJECT_ENABLED.
   * Store is opened with defaultWorkspaceId from workspace / KNOWLEDGE_DEFAULT_WORKSPACE_ID.
   */
  knowledge?: KnowledgeStore;
  knowledgeSettings?: {
    toolsEnabled: boolean;
    injectEnabled: boolean;
    injectMaxChars: number;
    injectHops: 1 | 2;
  };
}

export interface OrchestratorResult {
  reply: string;
  routing: RoutingDecision;
  model: string;
  provider: ModelChoice;
  usage?: ModelResponse["usage"];
  /** Milestone 7 policy decision (reason + budget) */
  policy?: PolicyDecision;
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
  /** Present when phase B tool loop ran */
  toolSteps?: ToolLoopStep[];
  toolsHitMaxSteps?: boolean;
  /** Milestone 3B suggestions (metadata — does not alter reply) */
  suggestions?: Suggestion[];
}

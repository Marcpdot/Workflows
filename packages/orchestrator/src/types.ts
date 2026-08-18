/** Shared types for the orchestrator. */

import type {
  ToolRegistry,
  ToolLoopStep,
  ModelToolSchema,
} from "@workflows/tools";
import type {
  ExperienceSource,
  ExperienceStore,
  InteractionMode,
  LongTermMemory,
  LongTermSettings,
} from "@workflows/memory";
import type { ProactiveSettings, Suggestion } from "@workflows/proactive";
import type { Embedder, VectorStore } from "@workflows/embeddings";
import type { ComputePolicy, PolicyDecision } from "@workflows/policy";
import type { Observer } from "@workflows/observability";
import type { WorkspaceContext } from "@workflows/workspace";
import type {
  KnowledgeProposalSummary,
  KnowledgeStore,
  RepresentationSourceMetadata,
} from "@workflows/knowledge";
import type { ActivationTrace } from "./capabilityActivation.js";

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
  /** Durable raw experience sink. Caller owns its lifecycle. */
  experienceStore?: ExperienceStore;
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
   * Milestone 12–14 knowledge store (optional).
   * Tools when KNOWLEDGE_TOOLS_ENABLED; inject when KNOWLEDGE_INJECT_ENABLED;
   * auto chat ingest (proposals only) when ingestAutoOnChat.
   * Store opened with defaultWorkspaceId from workspace / KNOWLEDGE_DEFAULT_WORKSPACE_ID.
   */
  knowledge?: KnowledgeStore;
  knowledgeSettings?: {
    toolsEnabled: boolean;
    injectEnabled: boolean;
    injectMaxChars: number;
    injectHops: 1 | 2;
    /** M14: after each handle, ingest recent segment as proposals (default false) */
    ingestAutoOnChat: boolean;
    ingestMinChars: number;
    ingestMaxMessages: number;
    /**
     * Continuous capture when session mode is active (design: interaction mode).
     * Default true unless KNOWLEDGE_CAPTURE_DISABLED.
     */
    captureEnabled: boolean;
    /** Min ms between auto-extracts in a session (force /capture ignores). */
    minCaptureIntervalMs: number;
    /** Local structured extraction, or explicit degraded/offline heuristic mode. */
    captureModelTier: "local" | "heuristic";
    /** Optional local Ollama model tag used only for capture. */
    captureModel?: string;
  };
}

export interface OrchestratorResult {
  reply: string;
  routing: RoutingDecision;
  model: string;
  provider: ModelChoice | "deterministic";
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
  /** Session interaction mode used for this turn */
  interactionMode?: InteractionMode;
  /** Whether continuous proposals are enabled for the session */
  proposalsEnabled?: boolean;
  /** New pending proposals created this turn (never auto-accepted) */
  proposals?: KnowledgeProposalSummary[];
  /** Total pending proposals in the knowledge store (session/workspace scoped count is best-effort) */
  pendingProposalCount?: number;
  /** Capture skipped/ran metadata */
  capture?: {
    ran: boolean;
    reason?: string;
    mode?: string;
    eventId?: string;
    sourceExperienceIds?: string[];
  };
  /** Durable source identities created while processing this interaction. */
  experiences?: {
    input?: string;
    inputKind?: string;
    modelOutputs: string[];
    deterministicOutputs: string[];
    toolCalls: string[];
    toolResults: string[];
    output?: string;
  };
  /** Contextual identity acquisition outcome; no raw content is logged here. */
  representation?: {
    status: "not_applicable" | "resolved" | "needs_clarification";
    gapId?: string;
    canonicalId?: string;
    method?: string;
    question?: string;
    sourceEventId?: string;
  };
  /** Non-authoritative references to semantic writes caused by this operation. */
  semantic?: {
    events: Array<{
      id: string;
      sourceExperienceIds: string[];
      transformationMethod?: string;
    }>;
    proposals: Array<{
      id: string;
      kind: string;
      eventId: string;
      epistemicStatus?: string;
      canonicalIds?: string[];
      oldClaimId?: string;
      revisedClaimId?: string;
    }>;
  };
  /** Persistent background work exposed by this foreground operation. */
  background?: {
    workIds: string[];
    sourceExperienceIds: string[];
  };
  /** Privacy-preserving WHAT / HOW / HOW MUCH capability activation trace. */
  activation?: ActivationTrace;
}

export interface OrchestratorHandleOptions {
  forceModel?: ModelChoice;
  history?: ChatMessage[];
  sessionId?: string;
  /** Session interaction mode (default active). */
  interactionMode?: InteractionMode;
  proposalsEnabled?: boolean;
  /** Force knowledge capture this turn (/capture). */
  forceCapture?: boolean;
  maxProposalsPerTurn?: number;
  minUserMessageLength?: number;
  lastExtractAt?: number;
  minCaptureIntervalMs?: number;
  /** Exact user input when the model prompt is a derived command prompt. */
  sourcePrompt?: string;
  /** Modality/caller metadata for the raw input experience. */
  experienceSource?: ExperienceSource;
  /** Optional retained source-payload pointer for the raw input experience. */
  experiencePayloadRef?: string;
  /** Non-semantic source lineage retained on the authoritative input experience. */
  experienceMetadata?: Record<string, unknown>;
  /** Structured referent/source facts supplied by an input adapter. */
  representation?: RepresentationSourceMetadata & {
    /** Explicit pending gap when a UI/caller already has its stable ID. */
    clarificationGapId?: string;
    /** One bounded existing tool call used only to inspect missing metadata. */
    inspection?: {
      toolName: string;
      args?: Record<string, unknown>;
    };
  };
}

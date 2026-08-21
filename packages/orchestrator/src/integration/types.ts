/**
 * Stable JSON contract for external callers (CLI --json and HTTP).
 * Same shape from both paths — Orchestrator remains the brain.
 */

import type { KnowledgeFocus, OrchestratorResult } from "../types.js";

export type IntegrationFocus = KnowledgeFocus;

export interface IntegrationChatRequest {
  prompt: string;
  sessionId?: string;
  /** Absolute path preferred; tools bind here */
  workspaceRoot?: string;
  /**
   * Optional attention hint for knowledge retrieval this turn.
   * Omitted by existing clients; does not change routing or voice.
   */
  focus?: IntegrationFocus;
  /**
   * When true, respond as SSE (`token` | `status` | `done` | `error`).
   * Also enabled when `Accept: text/event-stream` and this is not `false`.
   */
  stream?: boolean;
  options?: {
    toolsEnabled?: boolean;
    forceModel?: "local" | "frontier";
    noMemory?: boolean;
  };
}

/** Machine-readable chat response (extends handle() result). */
export type IntegrationChatResponse = OrchestratorResult & {
  /** Effective (namespaced) short-term session id */
  sessionId?: string;
  /** User-facing session id before workspace namespace */
  logicalSessionId?: string;
  historyCount?: number;
  latencyMs?: number;
  workspaceRoot?: string;
  workspaceId?: string;
  /** Echo of request focus when provided */
  focus?: IntegrationFocus;
  /** True when a slash command was handled without a model call */
  command?: boolean;
  data?: unknown;
};

export interface IntegrationHealthResponse {
  ok: true;
  version?: string;
  service: "orchestrator";
}

export interface IntegrationProbe {
  ok: boolean;
  detail?: string;
}

export interface IntegrationStatusResponse {
  ok: true;
  service: "orchestrator";
  version?: string;
  /** At least one in-flight `/v1/chat` on this process */
  busy: boolean;
  /** True when any best-effort backend probe failed */
  degraded: boolean;
  knowledge: IntegrationProbe & {
    backend?: string;
    configured: boolean;
  };
  model: {
    local: IntegrationProbe & { bin: string; model: string };
    frontier: { configured: boolean; model: string };
    mid: { configured: boolean; model?: string };
  };
  voice: {
    enabled: boolean;
    sttProvider: string;
    ttsProvider: string;
    allowRemoteAudio: boolean;
    language: string;
  };
}

export interface IntegrationSessionResponse {
  ok: true;
  sessionId: string;
  logicalSessionId: string;
  workspaceId: string;
  workspaceRoot: string;
  /** True when short-term memory has messages or experiences for this id */
  exists: boolean;
  historyCount: number;
  interactionMode: "active" | "neutral";
  proposalsEnabled: boolean;
  lastExtractTurnId?: string;
  updatedAt: number;
}

export type IntegrationChatStreamEvent =
  | "token"
  | "status"
  | "done"
  | "error";

export type IntegrationSurfaceEventType =
  | "presence"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "proposal.created"
  | "degraded"
  | "error";

export interface IntegrationErrorResponse {
  ok: false;
  error: string;
}

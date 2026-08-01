/**
 * Stable JSON contract for external callers (CLI --json and HTTP).
 * Same shape from both paths — Orchestrator remains the brain.
 */

import type { OrchestratorResult } from "../types.js";

export interface IntegrationChatRequest {
  prompt: string;
  sessionId?: string;
  /** Absolute path preferred; tools bind here */
  workspaceRoot?: string;
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
};

export interface IntegrationHealthResponse {
  ok: true;
  version?: string;
  service: "orchestrator";
}

export interface IntegrationErrorResponse {
  ok: false;
  error: string;
}

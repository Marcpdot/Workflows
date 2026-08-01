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
  sessionId?: string;
  historyCount?: number;
  latencyMs?: number;
  workspaceRoot?: string;
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

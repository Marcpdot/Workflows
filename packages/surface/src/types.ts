export const SESSION_ID = "surface-main";

export interface StatusResponse {
  ok: true;
  service: string;
  version?: string;
  busy: boolean;
  degraded: boolean;
  knowledge: {
    ok: boolean;
    configured: boolean;
    backend?: string;
    detail?: string;
  };
  model: {
    local: { ok: boolean; bin: string; model: string; detail?: string };
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

export interface SessionResponse {
  ok: true;
  sessionId: string;
  logicalSessionId: string;
  workspaceId: string;
  exists: boolean;
  historyCount: number;
  interactionMode: "active" | "neutral";
  proposalsEnabled: boolean;
}

export interface ChatFocus {
  knowledgeId?: string;
  nodeIds?: string[];
  labels?: string[];
  projectId?: string;
  projectLabel?: string;
  workspaceId?: string;
  hops?: 1 | 2;
}

export interface ChatDone {
  reply?: string;
  routing?: { model?: string; reason?: string; taskType?: string };
  model?: string;
  provider?: string;
  latencyMs?: number;
  sessionId?: string;
  command?: boolean;
  error?: string;
  proposals?: Array<{ id: string; kind?: string; label?: string }>;
}

export interface KnowledgeNode {
  id: string;
  type: string;
  label: string;
  description?: string;
  status: string;
  workspaceId?: string | null;
}

export interface KnowledgeEdge {
  id: string;
  fromNodeId: string;
  relation: string;
  toNodeId: string;
}

export interface Proposal {
  id: string;
  kind: string;
  label?: string;
  relation?: string;
  payload?: Record<string, unknown>;
  status?: string;
  sourceRef?: string;
}

export interface SurfaceEvent {
  type: string;
  at?: string;
  sessionId?: string;
  error?: string;
  proposalId?: string;
}

export type WorkPhase = "idle" | "accepted" | "running" | "complete" | "error";

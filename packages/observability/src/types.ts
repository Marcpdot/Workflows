export type OrchestratorEventKind = "request" | "tool" | "error";

export interface OrchestratorEvent {
  ts: string;
  kind: OrchestratorEventKind;
  sessionId?: string;
  route?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokens?: number;
  tools?: string[];
  error?: string;
  /** Policy reason, compression flags, etc. Avoid full prompts unless configured */
  meta?: Record<string, unknown>;
}

export interface Observer {
  emit(event: OrchestratorEvent): void;
}

export interface ObservabilityConfig {
  enabled: boolean;
  logPath: string;
  logPrompts: boolean;
  /** Mirror events to stderr as single-line JSON */
  stderr: boolean;
}

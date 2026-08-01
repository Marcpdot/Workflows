/**
 * Model-facing types for packages/models.
 * Structurally compatible with Orchestrator ModelClient / ModelRequest / ModelResponse.
 */

export type ModelChoice = "local" | "mid" | "frontier";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Minimal tool schema for OpenAI-compatible tool passing (no tools package dep). */
export interface ModelToolSchema {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    description: string;
    required?: boolean;
  }>;
}

export interface ModelRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
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
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface ModelClient {
  readonly provider: ModelChoice;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

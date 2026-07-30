/**
 * Frontier model client — xAI Grok (OpenAI-compatible Chat Completions API).
 */

import type {
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
} from "../types.js";

export interface GrokConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  timeoutMs?: number;
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string };
}

export class GrokClient implements ModelClient {
  readonly provider = "frontier" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: GrokConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error(
        "XAI_API_KEY is missing. Set it in the environment or .env file."
      );
    }

    const model = request.model ?? this.defaultModel;
    const messages = request.messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: request.temperature ?? 0.7,
          stream: false,
        }),
        signal: controller.signal,
      });

      const body = (await res.json()) as OpenAIChatResponse;

      if (!res.ok) {
        const msg =
          body.error?.message ??
          `Grok API HTTP ${res.status} ${res.statusText}`;
        throw new Error(msg);
      }

      const content = body.choices?.[0]?.message?.content;
      if (content == null || content === "") {
        throw new Error("Grok API returned an empty completion");
      }

      return {
        content,
        model: body.model ?? model,
        provider: "frontier",
        usage: body.usage
          ? {
              promptTokens: body.usage.prompt_tokens,
              completionTokens: body.usage.completion_tokens,
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Grok API timed out after ${this.timeoutMs}ms (model=${model})`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

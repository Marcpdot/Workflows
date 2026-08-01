/**
 * Frontier model client — xAI Grok (OpenAI-compatible Chat Completions API).
 * Optionally passes tools and returns structured tool_calls when present.
 */

import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ModelToolSchema,
} from "./types.js";

export interface GrokConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  timeoutMs?: number;
  /** Default frontier; use "mid" for mid-tier OpenAI-compatible endpoints */
  provider?: "frontier" | "mid";
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string };
}

function toOpenAiTools(tools: ModelToolSchema[]) {
  return tools.map((t) => {
    const properties: Record<string, { type: string; description?: string }> =
      {};
    const required: string[] = [];
    for (const p of t.parameters) {
      properties[p.name] = {
        type: p.type === "number" ? "number" : p.type === "boolean" ? "boolean" : "string",
        description: p.description,
      };
      if (p.required) required.push(p.name);
    }
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties,
          required: required.length ? required : undefined,
        },
      },
    };
  });
}

export class GrokClient implements ModelClient {
  readonly provider: "frontier" | "mid";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: GrokConfig) {
    this.provider = config.provider ?? "frontier";
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error(
        this.provider === "mid"
          ? "Mid-tier API key missing (set MID_API_KEY or XAI_API_KEY)."
          : "XAI_API_KEY is missing. Set it in the environment or .env file."
      );
    }

    const model = request.model ?? this.defaultModel;
    const messages = request.messages.map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    }));

    const bodyPayload: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.7,
      stream: false,
    };

    if (request.tools && request.tools.length > 0) {
      bodyPayload.tools = toOpenAiTools(request.tools);
      // Let the model decide when to call tools (not forced).
      bodyPayload.tool_choice = "auto";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      const body = (await res.json()) as OpenAIChatResponse;

      if (!res.ok) {
        const msg =
          body.error?.message ??
          `Grok API HTTP ${res.status} ${res.statusText}`;
        throw new Error(msg);
      }

      const message = body.choices?.[0]?.message;
      const content = message?.content ?? "";
      const rawCalls = message?.tool_calls;

      const toolCalls =
        rawCalls && rawCalls.length > 0
          ? rawCalls
              .map((tc, i) => {
                const name = tc.function?.name ?? "";
                if (!name) return null;
                let args: Record<string, unknown> = {};
                const argStr = tc.function?.arguments;
                if (typeof argStr === "string" && argStr.trim()) {
                  try {
                    args = JSON.parse(argStr) as Record<string, unknown>;
                  } catch {
                    args = { _raw: argStr };
                  }
                }
                return {
                  id: tc.id ?? `call_${i}_${randomUUID().slice(0, 8)}`,
                  name,
                  args,
                };
              })
              .filter((c): c is NonNullable<typeof c> => c != null)
          : undefined;

      // Allow empty content when structured tool calls are present.
      if ((!content || content === "") && (!toolCalls || toolCalls.length === 0)) {
        throw new Error("Grok API returned an empty completion");
      }

      return {
        content: content || "",
        model: body.model ?? model,
        provider: "frontier",
        usage: body.usage
          ? {
              promptTokens: body.usage.prompt_tokens,
              completionTokens: body.usage.completion_tokens,
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
        toolCalls,
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

/**
 * Main orchestrator: route → compress history → call model → return reply.
 * Routing, compression, and model clients are intentionally separate.
 */

import { route, type RouterConfig } from "./router.js";
import { OllamaCliClient } from "./models/local.js";
import { GrokClient } from "./models/frontier.js";
import {
  compressHistory,
  LocalModelSummarizer,
} from "./compression/index.js";
import type {
  ChatMessage,
  ModelClient,
  ModelChoice,
  OrchestratorConfig,
  OrchestratorResult,
  RoutingDecision,
} from "./types.js";

export class Orchestrator {
  private readonly config: OrchestratorConfig;
  private readonly local: ModelClient;
  private readonly frontier: ModelClient;
  private readonly routerConfig: RouterConfig;

  constructor(
    config: OrchestratorConfig,
    clients?: { local?: ModelClient; frontier?: ModelClient }
  ) {
    this.config = config;
    this.local =
      clients?.local ??
      new OllamaCliClient({
        bin: config.ollamaBin,
        defaultModel: config.ollamaModel,
      });
    this.frontier =
      clients?.frontier ??
      new GrokClient({
        apiKey: config.xaiApiKey,
        baseUrl: config.xaiBaseUrl,
        defaultModel: config.grokModel,
      });
    this.routerConfig = {
      localModel: config.ollamaModel,
      frontierModel: config.grokModel,
    };
  }

  /** Analyze + route without calling a model. */
  decide(prompt: string): RoutingDecision {
    return route(prompt, this.routerConfig);
  }

  /**
   * Full pipeline: route → compress history → call selected model → return.
   * Optional `forceModel` overrides routing (useful for testing / manual pick).
   * Compression uses the **local** model only (never frontier).
   * Callers should still persist full user/assistant messages to memory.
   */
  async handle(
    prompt: string,
    options?: {
      forceModel?: ModelChoice;
      history?: ChatMessage[];
    }
  ): Promise<OrchestratorResult> {
    const routing = this.decide(prompt);
    const choice = options?.forceModel ?? routing.model;

    if (options?.forceModel) {
      routing.model = options.forceModel;
      routing.reason = `forced → ${options.forceModel}`;
    }

    const history = options?.history ?? [];
    const originalCount = history.length;

    let recentMessages: ChatMessage[] = history;
    let summary: string | null = null;
    let compressed = false;

    if (!this.config.compression.disabled && history.length > 0) {
      const summarizer = new LocalModelSummarizer(
        this.local,
        this.config.ollamaModel,
        this.config.compression.maxSummaryChars
      );

      const result = await compressHistory(
        history,
        {
          threshold: this.config.compression.threshold,
          keepRecent: this.config.compression.keepRecent,
          maxSummaryChars: this.config.compression.maxSummaryChars,
        },
        summarizer
      );

      recentMessages = result.recentMessages;
      summary = result.summary;
      compressed = result.compressed;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...(summary
        ? [
            {
              role: "system" as const,
              content: `Earlier in this session:\n${summary}`,
            },
          ]
        : []),
      ...recentMessages,
      { role: "user", content: prompt },
    ];

    const client = choice === "local" ? this.local : this.frontier;
    const modelName =
      choice === "local"
        ? routing.localModel ?? this.config.ollamaModel
        : routing.frontierModel ?? this.config.grokModel;

    const response = await client.complete({
      messages,
      model: modelName,
    });

    return {
      reply: response.content,
      routing,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      compression: {
        compressed,
        summary,
        recentCount: recentMessages.length,
        originalCount,
      },
    };
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OrchestratorConfig {
  return {
    ollamaBin: env.OLLAMA_BIN ?? "ollama",
    ollamaModel: env.OLLAMA_MODEL ?? "llama3.2:3b",
    xaiApiKey: env.XAI_API_KEY ?? "",
    xaiBaseUrl: env.XAI_BASE_URL ?? "https://api.x.ai/v1",
    grokModel: env.GROK_MODEL ?? "grok-3",
    systemPrompt:
      env.SYSTEM_PROMPT ??
      "You are a helpful assistant. Be concise and accurate.",
    compression: {
      threshold: parsePositiveInt(env.COMPRESSION_THRESHOLD, 20),
      keepRecent: parsePositiveInt(env.COMPRESSION_KEEP_RECENT, 8),
      maxSummaryChars: parsePositiveInt(env.COMPRESSION_MAX_SUMMARY_CHARS, 1500),
      disabled:
        env.COMPRESSION_DISABLED === "1" ||
        env.COMPRESSION_DISABLED === "true",
    },
  };
}

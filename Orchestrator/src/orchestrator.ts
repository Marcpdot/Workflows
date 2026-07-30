/**
 * Main orchestrator: route → call model → return reply.
 * Routing and model clients are intentionally separate.
 */

import { route, type RouterConfig } from "./router.js";
import { OllamaCliClient } from "./models/local.js";
import { GrokClient } from "./models/frontier.js";
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
   * Full pipeline: route user prompt, call selected model, return result.
   * Optional `forceModel` overrides routing (useful for testing / manual pick).
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

    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...(options?.history ?? []),
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
    };
  }
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OrchestratorConfig {
  return {
    ollamaBin: env.OLLAMA_BIN ?? "ollama",
    ollamaModel: env.OLLAMA_MODEL ?? "gemma4:12b",
    xaiApiKey: env.XAI_API_KEY ?? "",
    xaiBaseUrl: env.XAI_BASE_URL ?? "https://api.x.ai/v1",
    grokModel: env.GROK_MODEL ?? "grok-3",
    systemPrompt:
      env.SYSTEM_PROMPT ??
      "You are a helpful assistant. Be concise and accurate.",
  };
}

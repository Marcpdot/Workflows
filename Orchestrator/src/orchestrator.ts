/**
 * Main orchestrator: route → retrieve → compress → call model → return reply.
 * Routing, retrieval, compression, and model clients are intentionally separate.
 */

import { route, type RouterConfig } from "./router.js";
import { OllamaCliClient } from "./models/local.js";
import { GrokClient } from "./models/frontier.js";
import {
  compressHistory,
  LocalModelSummarizer,
} from "./compression/index.js";
import {
  formatRetrievalBlock,
  resolveDefaultContextDir,
  retrieve,
} from "./retrieval/index.js";
import {
  createBuiltinRegistry,
  type ToolRegistry,
  type ToolResult,
} from "./tools/index.js";
import type {
  ChatMessage,
  ModelClient,
  ModelChoice,
  OrchestratorConfig,
  OrchestratorResult,
  RoutingDecision,
} from "./types.js";
import { resolve } from "node:path";

export class Orchestrator {
  private readonly config: OrchestratorConfig;
  private readonly local: ModelClient;
  private readonly frontier: ModelClient;
  private readonly routerConfig: RouterConfig;
  private readonly tools?: ToolRegistry;

  constructor(
    config: OrchestratorConfig,
    clients?: { local?: ModelClient; frontier?: ModelClient }
  ) {
    this.config = config;
    this.tools = config.tools;
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

  /** Optional tools registry (phase A — not used inside handle). */
  getTools(): ToolRegistry | undefined {
    return this.tools;
  }

  /** Execute a registered tool against the configured workspace root. */
  async runTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<ToolResult> {
    if (!this.tools) {
      return {
        ok: false,
        output: "",
        error: "No tools registry configured on this orchestrator",
      };
    }
    return this.tools.execute(name, args, {
      workspaceRoot: this.config.workspaceRoot,
    });
  }

  /**
   * Full pipeline: route → retrieve → compress history → call model → return.
   * Optional `forceModel` overrides routing (useful for testing / manual pick).
   * Compression uses the **local** model only (never frontier).
   * Retrieval sees full history; compression only reduces chat turns sent.
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

    // 1) Retrieval over full history + project context (before compression)
    let retrievalBlock: string | null = null;
    let retrievalMeta: OrchestratorResult["retrieval"];

    if (!this.config.retrieval.disabled) {
      const chunks = await retrieve(prompt, {
        sessionMessages: history,
        contextDir: this.config.retrieval.contextDir,
        limit: this.config.retrieval.limit,
        maxChars: this.config.retrieval.maxChars,
        maxChunkChars: this.config.retrieval.maxChunkChars,
      });
      retrievalBlock = formatRetrievalBlock(chunks);
      retrievalMeta = {
        chunkCount: chunks.length,
        sources: chunks.map((c) => c.source),
        chars: chunks.reduce((n, c) => n + c.text.length, 0),
      };
    }

    // 2) Compression of chat history
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

    // 3) Build messages: system → retrieval → summary → recent → user
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      ...(retrievalBlock
        ? [
            {
              role: "system" as const,
              content: `Retrieved context:\n${retrievalBlock}`,
            },
          ]
        : []),
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
      retrieval: retrievalMeta,
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
  const contextDir =
    env.RETRIEVAL_CONTEXT_DIR?.trim() ||
    resolveDefaultContextDir(process.cwd());

  const workspaceRoot = resolve(
    process.cwd(),
    env.TOOL_WORKSPACE_ROOT?.trim() || "."
  );

  const toolsDisabled =
    env.TOOLS_DISABLED === "1" || env.TOOLS_DISABLED === "true";

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
    retrieval: {
      limit: parsePositiveInt(env.RETRIEVAL_LIMIT, 4),
      maxChars: parsePositiveInt(env.RETRIEVAL_MAX_CHARS, 2000),
      maxChunkChars: parsePositiveInt(env.RETRIEVAL_MAX_CHUNK_CHARS, 600),
      contextDir,
      disabled:
        env.RETRIEVAL_DISABLED === "1" || env.RETRIEVAL_DISABLED === "true",
    },
    workspaceRoot,
    tools: toolsDisabled ? undefined : createBuiltinRegistry(),
  };
}

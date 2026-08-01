/**
 * Main orchestrator: route → retrieve → compress → (tool loop | complete) → reply.
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
  retrieve,
} from "./retrieval/index.js";
import {
  resolveProjectLongTermDbPath,
  resolveWorkspace,
  type WorkspaceContext,
} from "./workspace/index.js";
import {
  completeStructured,
  parseStructured,
  PLAN_SCHEMA,
  type PlanValue,
} from "./structured/index.js";
import {
  createBuiltinRegistry,
  formatToolsForPrompt,
  runToolLoop,
  toModelToolSchemas,
  TOOLS_SYSTEM_ADDENDUM,
  type ToolRegistry,
  type ToolResult,
} from "./tools/index.js";
import {
  createLongTermMemory,
  resolveLongTermDbPath,
  type LongTermMemory,
} from "./memory/longterm/index.js";
import { createEmbeddingsFromEnv } from "./embeddings/index.js";
import { suggestNextSteps } from "./proactive/index.js";
import {
  DefaultComputePolicy,
  loadPolicyConfig,
  type ComputePolicy,
  type PolicyDecision,
} from "./policy/index.js";
import {
  createObserverFromEnv,
  loadObservabilityConfig,
  type Observer,
} from "./observability/index.js";
import { estimateTokensFromText } from "./eval/cost.js";
import {
  defaultPipelineRoles,
  registryForRole,
  runRolePipeline,
  type AgentRole,
  type PipelineResult,
} from "./agents/index.js";
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
  private readonly mid?: ModelClient;
  private readonly routerConfig: RouterConfig;
  private readonly tools?: ToolRegistry;
  private readonly policy: ComputePolicy;
  private readonly observer: Observer;
  private readonly obsLogPrompts: boolean;
  /** Milestone 3A long-term memory (facts/preferences). Optional. */
  readonly longTerm?: LongTermMemory;
  constructor(
    config: OrchestratorConfig,
    clients?: {
      local?: ModelClient;
      frontier?: ModelClient;
      mid?: ModelClient;
    }
  ) {
    this.config = config;
    this.tools = config.tools;
    this.longTerm = config.longTerm;
    this.policy =
      config.policy ??
      new DefaultComputePolicy(loadPolicyConfig(process.env));
    this.observer = config.observer ?? createObserverFromEnv(process.env);
    this.obsLogPrompts =
      config.obsLogPrompts ??
      loadObservabilityConfig(process.env).logPrompts;
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
        provider: "frontier",
      });
    this.mid =
      clients?.mid ??
      (config.midModel
        ? new GrokClient({
            apiKey:
              process.env.MID_API_KEY?.trim() ||
              config.xaiApiKey,
            baseUrl:
              process.env.MID_BASE_URL?.trim() ||
              config.xaiBaseUrl,
            defaultModel: config.midModel,
            provider: "mid",
          })
        : undefined);
    this.routerConfig = {
      localModel: config.ollamaModel,
      frontierModel: config.grokModel,
    };
  }

  /** Analyze + route without calling a model. */
  decide(prompt: string): RoutingDecision {
    return route(prompt, this.routerConfig);
  }

  /** Close optional LTM + vector store (idempotent). */
  close(): void {
    try {
      this.longTerm?.close();
    } catch {
      /* ignore */
    }
    try {
      this.config.embeddings?.store.close();
    } catch {
      /* ignore */
    }
  }

  /** Optional tools registry. */
  getTools(): ToolRegistry | undefined {
    return this.tools;
  }

  /** Tool / integration workspace root (M5 / M9). */
  getWorkspaceRoot(): string {
    return this.config.workspaceRoot;
  }

  /** Milestone 9 resolved workspace context (if configured). */
  getWorkspace(): WorkspaceContext | undefined {
    return this.config.workspace;
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
   * Milestone 3C: sequential role pipeline (planner → worker by default).
   * Uses models + optional tool loop per role; does not replace handle().
   */
  async runPipeline(
    task: string,
    roles: AgentRole[] = defaultPipelineRoles()
  ): Promise<PipelineResult> {
    return runRolePipeline({
      task,
      roles,
      runStage: async ({ role, task: stageTask, priorStages }) => {
        const preference = role.modelPreference ?? "local";
        const client =
          preference === "frontier" ? this.frontier : this.local;
        const modelName =
          preference === "frontier"
            ? this.config.grokModel
            : this.config.ollamaModel;

        const priorBlock =
          priorStages.length === 0
            ? ""
            : priorStages
                .map((s) => `### Stage ${s.role}\n${s.text}`)
                .join("\n\n");

        const messages: ChatMessage[] = [
          { role: "system", content: role.systemPrompt },
          {
            role: "user",
            content:
              `Task:\n${stageTask}` +
              (priorBlock
                ? `\n\nPrior pipeline stages:\n${priorBlock}\n\nContinue as role "${role.name}".`
                : `\n\nRespond as role "${role.name}".`),
          },
        ];

        // M10: planner uses completeStructured for { steps: string[] }
        if (role.name === "planner") {
          const structured = await completeStructured<PlanValue>({
            complete: async (msgs) => {
              const response = await client.complete({
                messages: msgs,
                model: modelName,
              });
              return response.content;
            },
            messages: [
              ...messages,
              {
                role: "system",
                content:
                  'Output ONLY JSON: {"steps":["..."],"summary":"optional"}. steps must be non-empty strings.',
              },
            ],
            parse: (raw) => {
              const plan = parseStructured<PlanValue>(raw, PLAN_SCHEMA);
              if (!plan.steps || plan.steps.length === 0) {
                throw new Error("steps must be a non-empty array");
              }
              for (const s of plan.steps) {
                if (typeof s !== "string" || !s.trim()) {
                  throw new Error("each step must be a non-empty string");
                }
              }
              return plan;
            },
            maxAttempts: 2,
          });

          if (structured.ok && structured.value) {
            const plan = structured.value;
            const lines = plan.steps.map((s, i) => `${i + 1}. ${s}`);
            const text =
              (plan.summary?.trim()
                ? `Summary: ${plan.summary.trim()}\n\n`
                : "") + `Plan:\n${lines.join("\n")}`;
            return {
              text,
              structured: plan,
              structuredOk: true,
              structuredAttempts: structured.attempts,
            };
          }

          // Fallback: raw text + failure metadata (do not crash pipeline)
          return {
            text:
              structured.raw?.trim() ||
              `(planner structured parse failed: ${structured.error ?? "unknown"})`,
            structuredOk: false,
            structuredError: structured.error,
            structuredAttempts: structured.attempts,
          };
        }

        const stageRegistry = registryForRole(
          this.tools,
          role.toolsAllowed
        );

        if (stageRegistry && stageRegistry.list().length > 0) {
          const loop = await runToolLoop(messages, {
            maxSteps: this.config.toolsMaxSteps,
            workspaceRoot: this.config.workspaceRoot,
            registry: stageRegistry,
            complete: async (msgs, tools) => {
              const response = await client.complete({
                messages: msgs,
                model: modelName,
                tools: toModelToolSchemas(tools),
              });
              return {
                text: response.content,
                toolCalls: response.toolCalls,
              };
            },
          });
          return { text: loop.finalText, toolSteps: loop.steps };
        }

        const response = await client.complete({
          messages: [
            ...messages.slice(0, 1),
            {
              role: "system",
              content:
                "You have no tools in this stage. Answer with text only.",
            },
            ...messages.slice(1),
          ],
          model: modelName,
        });
        return { text: response.content };
      },
    });
  }

  /**
   * Full pipeline: route → retrieve → compress → model (optional tool loop).
   * Tool loop runs only when toolsEnabled && tools registry is set.
   */
  async handle(
    prompt: string,
    options?: {
      forceModel?: ModelChoice;
      history?: ChatMessage[];
      sessionId?: string;
    }
  ): Promise<OrchestratorResult> {
    const started = performance.now();
    const sessionId = options?.sessionId;

    try {
      return await this.handleInner(prompt, options, started, sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.observer.emit({
        ts: new Date().toISOString(),
        kind: "error",
        sessionId,
        latencyMs: Math.round(performance.now() - started),
        error: message,
        meta: this.obsLogPrompts
          ? { promptPreview: prompt.slice(0, 200) }
          : undefined,
      });
      throw err;
    }
  }

  private async handleInner(
    prompt: string,
    options: {
      forceModel?: ModelChoice;
      history?: ChatMessage[];
      sessionId?: string;
    } | undefined,
    started: number,
    sessionId?: string
  ): Promise<OrchestratorResult> {
    const routing = this.decide(prompt);

    // M7: policy wraps router (when off, decide mirrors router)
    const forceTier =
      options?.forceModel === "local" ||
      options?.forceModel === "mid" ||
      options?.forceModel === "frontier"
        ? options.forceModel
        : undefined;
    const policyDecision: PolicyDecision = this.policy.decide({
      prompt,
      taskType: routing.taskType,
      complexity: routing.complexity,
      estimatedTokens: estimateTokensFromText(prompt) * 2,
      forceTier,
      routerTier:
        routing.model === "frontier" ? "frontier" : "local",
    });

    const choice: ModelChoice = policyDecision.tier;
    if (options?.forceModel) {
      routing.model =
        options.forceModel === "mid" ? "frontier" : options.forceModel;
      routing.reason = `forced → ${options.forceModel}`;
    } else {
      // Keep routing.model as router/local|frontier; policy is separate field
      routing.reason = `${routing.reason} · policy: ${policyDecision.reason}`;
    }

    const history = options?.history ?? [];
    const originalCount = history.length;

    // 1) Retrieval
    let retrievalBlock: string | null = null;
    let retrievalMeta: OrchestratorResult["retrieval"];

    if (!this.config.retrieval.disabled) {
      const chunks = await retrieve(prompt, {
        sessionMessages: history,
        contextDir: this.config.retrieval.contextDir,
        limit: this.config.retrieval.limit,
        maxChars: this.config.retrieval.maxChars,
        maxChunkChars: this.config.retrieval.maxChunkChars,
        embeddings: this.config.embeddings
          ? {
              embedder: this.config.embeddings.embedder,
              store: this.config.embeddings.store,
              minScore: this.config.embeddings.minScore,
            }
          : undefined,
      });
      retrievalBlock = formatRetrievalBlock(chunks);
      retrievalMeta = {
        chunkCount: chunks.length,
        sources: chunks.map((c) => c.source),
        chars: chunks.reduce((n, c) => n + c.text.length, 0),
      };
    }

    // 2) Compression
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

    const useToolLoop =
      this.config.toolsEnabled && this.tools != null && this.tools.list().length > 0;

    const systemParts = [this.config.systemPrompt];
    if (useToolLoop && this.tools) {
      systemParts.push(TOOLS_SYSTEM_ADDENDUM);
      systemParts.push(formatToolsForPrompt(this.tools.list()));
    }

    // Optional LTM auto-inject (3A flag; default off — full proactivity is 3B)
    let longTermBlock: string | null = null;
    const ltm = this.longTerm;
    const ltmSettings = this.config.longTermSettings;
    if (ltm && ltmSettings?.autoInject) {
      const hits = await ltm.recall({
        text: prompt,
        limit: ltmSettings.injectLimit,
      });
      if (hits.length > 0) {
        let block = hits
          .map((f) =>
            f.key ? `- [${f.key}] ${f.content}` : `- ${f.content}`
          )
          .join("\n");
        if (block.length > ltmSettings.injectMaxChars) {
          block =
            block.slice(0, Math.max(0, ltmSettings.injectMaxChars - 1)) + "…";
        }
        longTermBlock = block;
      }
    }

    // 3) Build messages
    const messages: ChatMessage[] = [
      { role: "system", content: systemParts.join("\n\n") },
      ...(longTermBlock
        ? [
            {
              role: "system" as const,
              content: `Long-term memory (relevant facts):\n${longTermBlock}`,
            },
          ]
        : []),
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

    const { client, modelName, provider } = this.resolveClient(
      choice,
      routing
    );

    if (useToolLoop && this.tools) {
      const loopResult = await runToolLoop(messages, {
        maxSteps: this.config.toolsMaxSteps,
        workspaceRoot: this.config.workspaceRoot,
        registry: this.tools,
        complete: async (msgs, tools) => {
          const response = await client.complete({
            messages: msgs,
            model: modelName,
            tools: toModelToolSchemas(tools),
          });
          return {
            text: response.content,
            toolCalls: response.toolCalls,
          };
        },
      });

      const reply = loopResult.finalText;
      const tokens =
        estimateTokensFromText(prompt) + estimateTokensFromText(reply);
      // Tool-loop usage often missing — estimate from prompt+reply
      this.policy.recordUsage(policyDecision.tier, { tokens });

      for (const step of loopResult.steps) {
        this.observer.emit({
          ts: new Date().toISOString(),
          kind: "tool",
          sessionId,
          tools: [step.call.name],
          meta: {
            ok: step.result.ok,
            durationMs: step.durationMs,
            error: step.result.error,
          },
        });
      }

      const result: OrchestratorResult = {
        reply,
        routing,
        model: modelName,
        provider,
        policy: policyDecision,
        compression: {
          compressed,
          summary,
          recentCount: recentMessages.length,
          originalCount,
        },
        retrieval: retrievalMeta,
        toolSteps: loopResult.steps,
        toolsHitMaxSteps: loopResult.hitMaxSteps,
        suggestions: await this.buildSuggestions(
          prompt,
          reply,
          retrievalBlock,
          longTermBlock
        ),
      };
      this.emitRequestEvent(result, {
        sessionId,
        started,
        tokens,
        prompt,
      });
      return result;
    }

    // Phase A / tools off: single completion
    const response = await client.complete({
      messages,
      model: modelName,
    });

    const tokens =
      response.usage?.totalTokens ??
      estimateTokensFromText(prompt) +
        estimateTokensFromText(response.content);
    this.policy.recordUsage(policyDecision.tier, {
      tokens,
    });

    const result: OrchestratorResult = {
      reply: response.content,
      routing,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      policy: policyDecision,
      compression: {
        compressed,
        summary,
        recentCount: recentMessages.length,
        originalCount,
      },
      retrieval: retrievalMeta,
      suggestions: await this.buildSuggestions(
        prompt,
        response.content,
        retrievalBlock,
        longTermBlock
      ),
    };
    this.emitRequestEvent(result, {
      sessionId,
      started,
      tokens,
      prompt,
    });
    return result;
  }

  private emitRequestEvent(
    result: OrchestratorResult,
    ctx: {
      sessionId?: string;
      started: number;
      tokens?: number;
      prompt: string;
    }
  ): void {
    const toolNames =
      result.toolSteps?.map((s) => s.call.name).filter(Boolean) ?? [];
    this.observer.emit({
      ts: new Date().toISOString(),
      kind: "request",
      sessionId: ctx.sessionId,
      route: result.routing.model,
      model: result.model,
      provider: result.provider,
      latencyMs: Math.round(performance.now() - ctx.started),
      tokens: ctx.tokens ?? result.usage?.totalTokens,
      tools: toolNames.length > 0 ? toolNames : undefined,
      meta: {
        policyReason: result.policy?.reason,
        policyTier: result.policy?.tier,
        budgetCapped: result.policy?.budgetCapped,
        taskType: result.routing.taskType,
        complexity: result.routing.complexity,
        compressed: result.compression?.compressed,
        retrievalChunks: result.retrieval?.chunkCount,
        ...(this.obsLogPrompts
          ? { promptPreview: ctx.prompt.slice(0, 200) }
          : {}),
      },
    });
  }

  private resolveClient(
    choice: ModelChoice,
    routing: RoutingDecision
  ): { client: ModelClient; modelName: string; provider: ModelChoice } {
    if (choice === "local") {
      return {
        client: this.local,
        modelName: routing.localModel ?? this.config.ollamaModel,
        provider: "local",
      };
    }
    if (choice === "mid") {
      if (this.mid && this.config.midModel) {
        return {
          client: this.mid,
          modelName: this.config.midModel,
          provider: "mid",
        };
      }
      // Fallback local if mid not configured at runtime
      return {
        client: this.local,
        modelName: this.config.ollamaModel,
        provider: "local",
      };
    }
    return {
      client: this.frontier,
      modelName: routing.frontierModel ?? this.config.grokModel,
      provider: "frontier",
    };
  }

  /**
   * Milestone 3B: optional next-step suggestions (never mutates reply).
   * Off unless proactive.enabled. Does not auto-run anything.
   */
  private async buildSuggestions(
    userPrompt: string,
    assistantReply: string,
    retrievedContext: string | null,
    longTermBlock: string | null
  ): Promise<OrchestratorResult["suggestions"]> {
    const settings = this.config.proactive;
    if (!settings?.enabled) return undefined;

    const snippets: string[] = [];
    if (longTermBlock) {
      for (const line of longTermBlock.split("\n")) {
        const s = line.replace(/^-\s*/, "").trim();
        if (s) snippets.push(s);
      }
    } else if (this.longTerm) {
      try {
        const hits = await this.longTerm.recall({
          text: userPrompt,
          limit: 3,
        });
        for (const f of hits) {
          snippets.push(f.key ? `[${f.key}] ${f.content}` : f.content);
        }
      } catch {
        // LTM optional — ignore recall failures
      }
    }

    const tips = suggestNextSteps(
      {
        userPrompt,
        assistantReply,
        retrievedContext: retrievedContext ?? undefined,
        longTermSnippets: snippets.length > 0 ? snippets : undefined,
      },
      {
        max: settings.max,
        locale: settings.locale,
        minConfidence: settings.minConfidence,
      }
    );

    // useModel polish intentionally not implemented in 3B (flag reserved)
    return tips;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    workspaceRoot?: string;
    sessionId?: string;
    cwd?: string;
  }
): OrchestratorConfig {
  const cwd = options?.cwd ?? process.cwd();
  // M9: single resolve for tools root, session namespace, project context
  const workspace = resolveWorkspace({
    workspaceRoot: options?.workspaceRoot,
    sessionId: options?.sessionId,
    cwd,
    env,
  });
  const workspaceRoot = workspace.rootPath;
  const contextDir = workspace.contextDir;

  const toolsDisabled = envFlagTrue(env.TOOLS_DISABLED);
  // Phase B loop is off by default until explicitly enabled.
  const toolsEnabled = envFlagTrue(env.TOOLS_ENABLED);

  const embeddingsRuntime = createEmbeddingsFromEnv(env);
  const embeddings = embeddingsRuntime
    ? {
        embedder: embeddingsRuntime.embedder,
        store: embeddingsRuntime.store,
        minScore: embeddingsRuntime.config.minScore,
      }
    : undefined;

  const longTermDisabled = envFlagTrue(env.LONGTERM_DISABLED);
  // LTM stays personal/global unless LONGTERM_PROJECT_SCOPED=true
  const projectLtm = resolveProjectLongTermDbPath(workspaceRoot, env);
  const longTermDbPath =
    projectLtm ?? resolveLongTermDbPath(cwd, env);
  const longTerm = longTermDisabled
    ? undefined
    : createLongTermMemory({
        dbPath: longTermDbPath,
        embeddings: embeddings
          ? {
              embedder: embeddings.embedder,
              store: embeddings.store,
              minScore: embeddings.minScore,
            }
          : undefined,
      });

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
    workspace,
    tools: toolsDisabled ? undefined : createBuiltinRegistry(),
    toolsEnabled,
    toolsMaxSteps: parsePositiveInt(env.TOOLS_MAX_STEPS, 5),
    longTerm,
    longTermSettings: {
      dbPath: longTermDbPath,
      autoInject: envFlagTrue(env.LONGTERM_AUTO_INJECT),
      injectMaxChars: parsePositiveInt(env.LONGTERM_INJECT_MAX_CHARS, 1500),
      injectLimit: parsePositiveInt(env.LONGTERM_INJECT_LIMIT, 5),
    },
    proactive: {
      enabled: envFlagTrue(env.PROACTIVE_ENABLED),
      max: parsePositiveInt(env.PROACTIVE_MAX, 3),
      useModel: envFlagTrue(env.PROACTIVE_USE_MODEL),
      minConfidence: (() => {
        const n = Number(env.PROACTIVE_MIN_CONFIDENCE ?? "0.45");
        return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.45;
      })(),
      locale: env.PROACTIVE_LOCALE === "en" ? "en" : env.PROACTIVE_LOCALE === "nb" ? "nb" : "nb",
    },
    embeddings,
    policy: new DefaultComputePolicy(loadPolicyConfig(env)),
    midModel: env.POLICY_MID_MODEL?.trim() || undefined,
    observer: createObserverFromEnv(env),
    obsLogPrompts: loadObservabilityConfig(env).logPrompts,
  };
}

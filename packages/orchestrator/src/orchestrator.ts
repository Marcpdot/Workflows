/**
 * Runtime compatibility boundary. Existing capabilities participate selectively
 * through operation-local activation state; this class remains wiring.
 */

import { route, type RouterConfig } from "./router.js";
import { OllamaCliClient } from "@workflows/models/local";
import { GrokClient } from "@workflows/models/frontier";
import {
  resolveProjectLongTermDbPath,
  resolveWorkspace,
  type WorkspaceContext,
} from "@workflows/workspace";
import {
  completeStructured,
  parseStructured,
  PLAN_SCHEMA,
  type PlanValue,
} from "@workflows/structured";
import {
  createBuiltinRegistry,
  formatToolsForPrompt,
  runToolLoop,
  toModelToolSchemas,
  TOOLS_SYSTEM_ADDENDUM,
  type ToolRegistry,
  type ToolResult,
} from "@workflows/tools";
import {
  createLongTermMemory,
  resolveLongTermDbPath,
  type ExperienceRecord,
  type ExperienceStore,
  type LongTermMemory,
  type RecordExperienceInput,
} from "@workflows/memory";
import {
  captureConversationSegment,
  createKnowledgeStore,
  createKnowledgeTools,
  findPendingRepresentationGap,
  hasRepresentationAcquisitionSignal,
  listPendingForSession,
  type KnowledgeProposalSummary,
  type KnowledgeStore,
  type RepresentationAcquisitionResult,
  type RepresentationSourceMetadata,
} from "@workflows/knowledge";
import type { InteractionMode } from "@workflows/memory";
import { createEmbeddingsFromEnv } from "@workflows/embeddings";
import { suggestNextSteps } from "@workflows/proactive";
import {
  DefaultComputePolicy,
  loadPolicyConfig,
  type ComputePolicy,
  type PolicyDecision,
} from "@workflows/policy";
import {
  createObserverFromEnv,
  emitSafely,
  loadObservabilityConfig,
  type Observer,
} from "@workflows/observability";
import { estimateTokensFromText } from "@workflows/eval/cost";
import {
  defaultPipelineRoles,
  registryForRole,
  runRolePipeline,
  type AgentRole,
  type PipelineResult,
} from "@workflows/agents";
import type {
  ChatMessage,
  ModelClient,
  ModelChoice,
  OrchestratorConfig,
  OrchestratorHandleOptions,
  OrchestratorResult,
  RoutingDecision,
} from "./types.js";
import {
  buildModelMessages,
  calculateDeterministicResponse,
  capabilityValue,
  contributeContextRetrieval,
  contributeHistoryCompression,
  contributeKnowledgeRetrieval,
  contributeLongTermMemory,
  contributeModelResponse,
  contributeOperationStart,
  contributeProvenanceLineage,
  contributeRepresentationAcquisition,
  contributeToolResponse,
  isExplicitCorrection,
  shouldActivateKnowledgeCapture,
  type CompressionValue,
  type ContextRetrievalValue,
  type DeterministicResponseValue,
  type LongTermMemoryValue,
} from "./capabilityContributors.js";
import {
  contributeCapabilityOutput,
  contributeModelOutput,
  createRuntimeCognitiveContext,
  expandCapabilities,
  isCapabilityActive,
  recordCapabilityDegradation,
  type CognitiveOperationContext,
} from "./capabilityActivation.js";
import {
  knowledgeDiagnosticEvent,
  observeCognitiveOperation,
} from "./cognitiveObservability.js";

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
  private readonly experiences?: ExperienceStore;
  /** Milestone 3A long-term memory (facts/preferences). Optional. */
  readonly longTerm?: LongTermMemory;
  /** Milestone 12 knowledge store (optional). */
  readonly knowledge?: KnowledgeStore;
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
    this.experiences = config.experienceStore;
    this.longTerm = config.longTerm;
    this.knowledge = config.knowledge;
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

  /** Close optional LTM + knowledge + vector store (idempotent). */
  close(): void {
    try {
      this.longTerm?.close();
    } catch {
      /* ignore */
    }
    try {
      this.knowledge?.close();
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

  private async recordExperience(
    input: RecordExperienceInput,
    backgroundTrace?: NonNullable<OrchestratorResult["background"]>
  ): Promise<ExperienceRecord | undefined> {
    if (!this.experiences) return undefined;
    const record = await this.experiences.recordExperience({
      ...input,
      workspaceId: input.workspaceId ?? this.config.workspace?.id,
    });
    if (
      this.knowledge &&
      ["user_message", "human_correction", "external_observation", "tool_result"].includes(record.kind)
    ) {
      try {
        const queued = await this.knowledge.enqueueBackgroundWork({
          kind: "semantic_consolidation",
          workKey: `semantic-consolidation:${record.id}`,
          sourceExperienceId: record.id,
          payload: {
            experienceKind: record.kind,
            sessionId: record.sessionId,
            workspaceId: record.workspaceId,
            sourceType: record.source?.type,
          },
        });
        if (backgroundTrace) {
          if (!backgroundTrace.workIds.includes(queued.work.id)) {
            backgroundTrace.workIds.push(queued.work.id);
          }
          if (!backgroundTrace.sourceExperienceIds.includes(record.id)) {
            backgroundTrace.sourceExperienceIds.push(record.id);
          }
        }
      } catch (error) {
        // Background persistence must not delay or invalidate the foreground
        // operation. The durable experience remains authoritative and can be
        // explicitly re-enqueued after the dependency recovers.
        emitSafely(this.observer, {
          ts: new Date().toISOString(),
          kind: "error",
          sessionId: record.sessionId,
          error: error instanceof Error ? error.message : String(error),
          meta: { capability: "knowledge_background_enqueue", experienceId: record.id },
        });
      }
    }
    return record;
  }

  private async sourceExperienceIds(
    sessionId: string | undefined,
    currentIds: Array<string | undefined>,
    maxMessages: number
  ): Promise<string[]> {
    const ids: string[] = [];
    if (this.experiences && sessionId) {
      const messages = await this.experiences.listExperiences({
        sessionId,
        kinds: [
          "user_message",
          "human_correction",
          "assistant_output",
          "system_message",
        ],
        limit: Math.max(maxMessages * 3, maxMessages),
      });
      ids.push(
        ...messages
          .filter((record) => record.metadata.historyMessage !== false)
          .slice(-maxMessages)
          .map((record) => record.id)
      );
    }
    ids.push(...currentIds.filter((id): id is string => Boolean(id)));
    return [...new Set(ids)];
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
   * Compatibility entrypoint for one selectively assembled cognitive operation.
   * Package-owned contributors supply operation values; this method wires them.
   */
  async handle(
    prompt: string,
    options?: OrchestratorHandleOptions
  ): Promise<OrchestratorResult> {
    const started = performance.now();
    const sessionId = options?.sessionId;

    try {
      return await this.handleInner(prompt, options, started, sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitSafely(this.observer, {
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
    options: OrchestratorHandleOptions | undefined,
    started: number,
    sessionId?: string
  ): Promise<OrchestratorResult> {
    const interactionMode: InteractionMode =
      options?.interactionMode === "neutral" ? "neutral" : "active";
    const proposalsEnabled = options?.proposalsEnabled !== false;
    const experienceTrace: NonNullable<OrchestratorResult["experiences"]> = {
      modelOutputs: [],
      deterministicOutputs: [],
      toolCalls: [],
      toolResults: [],
    };
    const backgroundTrace: NonNullable<OrchestratorResult["background"]> = {
      workIds: [],
      sourceExperienceIds: [],
    };
    const sourcePrompt = options?.sourcePrompt ?? prompt;
    const deterministic = calculateDeterministicResponse(prompt);
    const explicitRepresentation = options?.representation;
    const representationMetadata: RepresentationSourceMetadata | undefined =
      explicitRepresentation
        ? {
            ...explicitRepresentation,
            sourceType:
              explicitRepresentation.sourceType ?? options?.experienceSource?.type,
            sourceRef:
              explicitRepresentation.sourceRef ?? options?.experienceSource?.ref,
          }
        : undefined;
    const inputExperience = await this.recordExperience({
      kind: isExplicitCorrection(sourcePrompt) ? "human_correction" : "user_message",
      sessionId,
      content: sourcePrompt,
      payloadRef: options?.experiencePayloadRef,
      source: options?.experienceSource ?? { type: "chat" },
      metadata: {
        ...options?.experienceMetadata,
        ...(options?.sourcePrompt != null && options.sourcePrompt !== prompt
          ? { modelInput: prompt }
          : {}),
        ...(explicitRepresentation
          ? {
              representationSource: true,
              stableIdentifier: explicitRepresentation.stableIdentifier,
              referentLabel: explicitRepresentation.referentLabel,
              contextKey: explicitRepresentation.contextKey,
              clarificationGapId: explicitRepresentation.clarificationGapId,
            }
          : {}),
      },
    }, backgroundTrace);
    experienceTrace.input = inputExperience?.id;
    experienceTrace.inputKind = inputExperience?.kind;
    const shouldResumePendingRepresentation =
      (explicitRepresentation == null && sessionId != null) ||
      explicitRepresentation?.clarificationGapId != null;
    const pendingRepresentationGap = this.knowledge && shouldResumePendingRepresentation
      ? await findPendingRepresentationGap(this.knowledge, {
          sessionId,
          gapId: explicitRepresentation?.clarificationGapId,
        })
      : null;
    const representationRequested =
      pendingRepresentationGap != null ||
      hasRepresentationAcquisitionSignal(sourcePrompt, representationMetadata);
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
    const captureRequested = shouldActivateKnowledgeCapture({
      prompt: sourcePrompt,
      force: options?.forceCapture === true,
      interactionMode,
      proposalsEnabled,
      settings: this.config.knowledgeSettings,
      knowledgeAvailable: this.knowledge != null,
      minUserMessageLength: options?.minUserMessageLength,
      lastExtractAt: options?.lastExtractAt,
      minCaptureIntervalMs: options?.minCaptureIntervalMs,
    });
    let cognition = createRuntimeCognitiveContext({
      currentInput: prompt,
      inputExperienceId: inputExperience?.id,
      sessionId,
      workspaceId: this.config.workspace?.id,
      state: {
        historyCount: history.length,
        compressionThreshold: this.config.compression.threshold,
        compressionAvailable: !this.config.compression.disabled,
        retrievalAvailable: !this.config.retrieval.disabled,
        knowledgeAvailable:
          this.knowledge != null &&
          this.config.knowledgeSettings?.injectEnabled === true,
        longTermMemoryAvailable:
          this.longTerm != null &&
          this.config.longTermSettings?.autoInject === true,
        toolsAvailable:
          this.config.toolsEnabled &&
          this.tools != null &&
          this.tools.list().length > 0,
        selectedModel: choice,
        responseModelRequired: deterministic == null && !representationRequested,
        representationAcquisitionAvailable: this.knowledge != null,
        representationAcquisitionRequested: representationRequested,
        representationToolRequested: explicitRepresentation?.inspection != null,
        knowledgeCaptureAvailable: this.knowledge != null,
        knowledgeCaptureRequested: captureRequested,
        knowledgeCaptureUsesModel:
          captureRequested &&
          this.config.knowledgeSettings?.captureModelTier === "local",
        historyCompressionUsesModel:
          !this.config.compression.disabled &&
          history.length > this.config.compression.threshold,
        localModelAvailable: true,
        midModelAvailable: this.mid != null,
        frontierModelAvailable: true,
      },
      limits: {
        retrievalChars: this.config.retrieval.maxChars,
        knowledgeChars: this.config.knowledgeSettings?.injectMaxChars ?? 2_000,
        historyMessages: Math.max(history.length, 1),
        toolSteps: this.config.toolsMaxSteps,
      },
    });
    cognition = contributeOperationStart(cognition, { history, deterministic });

    const representationContribution = await contributeRepresentationAcquisition(
      cognition,
      {
        store: this.knowledge,
        prompt: sourcePrompt,
        sourceExperienceId: inputExperience?.id,
        sessionId,
        workspaceId: this.config.workspace?.id,
        metadata: representationMetadata,
        pendingGap: pendingRepresentationGap,
        inspection: explicitRepresentation?.inspection,
        registry: this.tools,
        workspaceRoot: this.config.workspaceRoot,
        experiences: experienceTrace,
        recordExperience: (record) => this.recordExperience(record, backgroundTrace),
      }
    );
    cognition = representationContribution.cognition;
    const representationResult = representationContribution.result;
    const representationSummary: OrchestratorResult["representation"] =
      representationResult
        ? {
            status: representationResult.status,
            gapId: representationResult.gap?.id,
            canonicalId: representationResult.canonical?.id,
            method: representationResult.method,
            question: representationResult.question,
            sourceEventId: representationResult.sourceEventId,
          }
        : undefined;

    if (
      representationResult?.status === "needs_clarification" ||
      (pendingRepresentationGap && representationResult?.status === "resolved")
    ) {
      const resolutionReply = representationResult.status === "needs_clarification"
        ? representationResult.question!
        : `Understood — I’ll use ${representationResult.canonical!.label} for “${pendingRepresentationGap!.unresolved}” in this context.`;
      return this.finishDeterministicOperation({
        prompt,
        sourcePrompt,
        deterministic: {
          reply: resolutionReply,
          mechanism:
            representationResult.status === "needs_clarification"
              ? "representation_clarification"
              : "representation_resolution",
        },
        routing,
        policyDecision,
        cognition,
        experienceTrace,
        backgroundTrace,
        history,
        sessionId,
        interactionMode,
        proposalsEnabled,
        options,
        originalCount,
        recentMessages: history,
        summary: null,
        compressed: false,
        retrievalMeta: undefined,
        retrievalBlock: null,
        longTermBlock: null,
        started,
        representation: representationSummary,
        skipCaptureReason: "representation acquisition is already persisted through its gap/event lineage",
      });
    }

    if (representationRequested && deterministic == null) {
      cognition = expandCapabilities(cognition, {
        trigger: "missing_information",
        reason:
          representationResult?.status === "resolved"
            ? "the referent is resolved; language or general reasoning can now continue"
            : "representation acquisition found no blocking ambiguity; normal response processing can continue",
        fromCapabilityId: "representation_acquisition",
        capabilityIds: [`${choice}_model`],
      });
    }

    cognition = await contributeContextRetrieval(cognition, {
      prompt,
      history,
      settings: this.config.retrieval,
      embeddings: this.config.embeddings,
    });

    cognition = await contributeHistoryCompression(cognition, {
      history,
      settings: this.config.compression,
      local: this.local,
      localModel: this.config.ollamaModel,
    });
    const compressedHistory = capabilityValue<CompressionValue>(
      cognition,
      "history_compression"
    );
    if (compressedHistory?.summary) {
      const historyExperienceIds = (
        await this.sourceExperienceIds(sessionId, [], history.length + 1)
      ).filter((id) => id !== inputExperience?.id);
      const summaryExperience = await this.recordExperience({
        kind: "assistant_output",
        sessionId,
        content: compressedHistory.summary,
        source: {
          type: "model",
          ref: `local:${this.config.ollamaModel}`,
        },
        parentExperienceIds: historyExperienceIds,
        metadata: {
          model: this.config.ollamaModel,
          provider: "local",
          historyCompression: true,
          historyMessage: false,
        },
      }, backgroundTrace);
      if (summaryExperience) {
        experienceTrace.modelOutputs.push(summaryExperience.id);
        cognition = contributeModelOutput(cognition, {
          provider: "local",
          model: this.config.ollamaModel,
          experienceId: summaryExperience.id,
          characters: compressedHistory.summary.length,
        });
      }
    }

    const useToolLoop =
      isCapabilityActive(cognition, "tools") &&
      cognition.signals.tools &&
      this.config.toolsEnabled &&
      this.tools != null &&
      this.tools.list().length > 0;

    cognition = await contributeKnowledgeRetrieval(cognition, {
      store: this.knowledge,
      prompt,
      maxChars: cognition.limits.knowledgeChars,
      hops: this.config.knowledgeSettings?.injectHops ?? 1,
    });
    cognition = await contributeProvenanceLineage(cognition, this.knowledge);

    cognition = await contributeLongTermMemory(cognition, {
      memory: this.longTerm,
      prompt,
      settings: this.config.longTermSettings,
    });

    const messages = buildModelMessages(cognition, {
      prompt,
      systemPrompt: this.config.systemPrompt,
      interactionMode,
      tools: this.tools,
      useTools: useToolLoop,
      toolsSystemAddendum: TOOLS_SYSTEM_ADDENDUM,
      formatTools: formatToolsForPrompt,
    });
    const compression = capabilityValue<CompressionValue>(cognition, "history_compression");
    const retrieval = capabilityValue<ContextRetrievalValue>(cognition, "context_retrieval");
    const longTermBlock = capabilityValue<LongTermMemoryValue>(cognition, "long_term_memory")?.block ?? null;
    const retrievalBlock = retrieval?.block ?? null;
    const retrievalMeta: OrchestratorResult["retrieval"] = retrieval
      ? {
          chunkCount: retrieval.chunks.length,
          sources: retrieval.chunks.map((chunk) => chunk.source),
          chars: retrieval.chunks.reduce((count, chunk) => count + chunk.text.length, 0),
        }
      : undefined;
    const summary = compression?.summary ?? null;
    const recentMessages = compression?.recentMessages ?? history;
    const compressed = compression?.compressed ?? false;

    if (deterministic) {
      return this.finishDeterministicOperation({
        prompt,
        sourcePrompt,
        deterministic,
        routing,
        policyDecision,
        cognition,
        experienceTrace,
        backgroundTrace,
        history,
        sessionId,
        interactionMode,
        proposalsEnabled,
        options,
        originalCount,
        recentMessages,
        summary,
        compressed,
        retrievalMeta,
        retrievalBlock,
        longTermBlock,
        started,
      });
    }

    const { client, modelName, provider } = this.resolveClient(
      choice,
      routing
    );

    if (useToolLoop && this.tools) {
      const activated = await contributeToolResponse({
        client,
        model: modelName,
        provider,
        messages,
        sessionId,
        cognition,
        experiences: experienceTrace,
        registry: this.tools,
        workspaceRoot: this.config.workspaceRoot,
        maxSteps: this.config.toolsMaxSteps,
        recordExperience: (record) => this.recordExperience(record, backgroundTrace),
      });
      cognition = activated.cognition;
      const loopResult = {
        finalText: activated.reply,
        steps: activated.toolSteps ?? [],
        hitMaxSteps: activated.toolsHitMaxSteps === true,
      };
      const reply = loopResult.finalText;
      const tokens =
        estimateTokensFromText(prompt) + estimateTokensFromText(reply);
      // Tool-loop usage often missing — estimate from prompt+reply
      this.policy.recordUsage(policyDecision.tier, { tokens });

      for (const step of loopResult.steps) {
        emitSafely(this.observer, {
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
        experiences: this.experiences ? experienceTrace : undefined,
        background: backgroundTrace.workIds.length ? backgroundTrace : undefined,
        representation: representationSummary,
        activation: cognition.trace,
      };
      const sourceExperienceIds = await this.sourceExperienceIds(
        sessionId,
        [
          experienceTrace.input,
          ...experienceTrace.modelOutputs,
          ...experienceTrace.toolCalls,
          ...experienceTrace.toolResults,
        ],
        this.config.knowledgeSettings?.ingestMaxMessages ?? 12
      );
      cognition = await this.attachCapture(
        result,
        history,
        sourcePrompt,
        reply,
        sessionId,
        interactionMode,
        proposalsEnabled,
        cognition,
        options,
        sourceExperienceIds,
        backgroundTrace
      );
      result.activation = cognition.trace;
      this.emitRequestEvent(result, {
        sessionId,
        started,
        tokens,
        prompt,
      });
      return result;
    }

    const activated = await contributeModelResponse({
      client,
      model: modelName,
      provider,
      messages,
      sessionId,
      cognition,
      experiences: experienceTrace,
      recordExperience: (record) => this.recordExperience(record, backgroundTrace),
    });
    cognition = activated.cognition;
    const response = {
      content: activated.reply,
      model: activated.model,
      provider: activated.provider,
      usage: activated.usage,
    };

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
      experiences: this.experiences ? experienceTrace : undefined,
      background: backgroundTrace.workIds.length ? backgroundTrace : undefined,
      representation: representationSummary,
      activation: cognition.trace,
    };
    const sourceExperienceIds = await this.sourceExperienceIds(
      sessionId,
      [
        experienceTrace.input,
        ...experienceTrace.modelOutputs,
        experienceTrace.output,
      ],
      this.config.knowledgeSettings?.ingestMaxMessages ?? 12
    );
    cognition = await this.attachCapture(
      result,
      history,
      sourcePrompt,
      response.content,
      sessionId,
      interactionMode,
      proposalsEnabled,
      cognition,
      options,
      sourceExperienceIds,
      backgroundTrace
    );
    result.activation = cognition.trace;
    this.emitRequestEvent(result, {
      sessionId,
      started,
      tokens,
      prompt,
    });
    return result;
  }

  private async finishDeterministicOperation(input: {
    prompt: string;
    sourcePrompt: string;
    deterministic: DeterministicResponseValue;
    routing: RoutingDecision;
    policyDecision: PolicyDecision;
    cognition: CognitiveOperationContext;
    experienceTrace: NonNullable<OrchestratorResult["experiences"]>;
    backgroundTrace: NonNullable<OrchestratorResult["background"]>;
    history: ChatMessage[];
    sessionId?: string;
    interactionMode: InteractionMode;
    proposalsEnabled: boolean;
    options?: OrchestratorHandleOptions;
    originalCount: number;
    recentMessages: ChatMessage[];
    summary: string | null;
    compressed: boolean;
    retrievalMeta: OrchestratorResult["retrieval"];
    retrievalBlock: string | null;
    longTermBlock: string | null;
    started: number;
    representation?: OrchestratorResult["representation"];
    skipCaptureReason?: string;
  }): Promise<OrchestratorResult> {
    const output = await this.recordExperience({
      kind: "assistant_output",
      sessionId: input.sessionId,
      content: input.deterministic.reply,
      source: { type: "deterministic", ref: input.deterministic.mechanism },
      parentExperienceIds: input.experienceTrace.input
        ? [input.experienceTrace.input]
        : undefined,
      metadata: {
        mechanism: input.deterministic.mechanism,
        historyMessage: true,
      },
    }, input.backgroundTrace);
    if (output) {
      input.experienceTrace.deterministicOutputs.push(output.id);
      input.experienceTrace.output = output.id;
    }
    let cognition = contributeCapabilityOutput(input.cognition, {
      capabilityId: "deterministic_processing",
      status: "produced",
      value: input.deterministic,
      representations: [{
        capabilityId: "deterministic_processing",
        kind: "deterministic_response",
        ids: output ? [output.id] : undefined,
        characters: input.deterministic.reply.length,
        detail: input.deterministic.mechanism,
      }],
    });
    const result: OrchestratorResult = {
      reply: input.deterministic.reply,
      routing: input.routing,
      model: `deterministic:${input.deterministic.mechanism}`,
      provider: "deterministic",
      policy: input.policyDecision,
      compression: {
        compressed: input.compressed,
        summary: input.summary,
        recentCount: input.recentMessages.length,
        originalCount: input.originalCount,
      },
      retrieval: input.retrievalMeta,
      suggestions: await this.buildSuggestions(
        input.prompt,
        input.deterministic.reply,
        input.retrievalBlock,
        input.longTermBlock
      ),
      experiences: this.experiences ? input.experienceTrace : undefined,
      background: input.backgroundTrace.workIds.length
        ? input.backgroundTrace
        : undefined,
      representation: input.representation,
      activation: cognition.trace,
    };
    if (input.skipCaptureReason) {
      result.interactionMode = input.interactionMode;
      result.proposalsEnabled = input.proposalsEnabled;
      result.capture = { ran: false, reason: input.skipCaptureReason };
      try {
        result.pendingProposalCount = this.knowledge
          ? (await this.knowledge.listProposals({ status: "pending", limit: 1_000 })).length
          : 0;
      } catch {
        result.pendingProposalCount = 0;
      }
      this.emitRequestEvent(result, {
        sessionId: input.sessionId,
        started: input.started,
        prompt: input.prompt,
      });
      return result;
    }
    const sourceExperienceIds = await this.sourceExperienceIds(
      input.sessionId,
      [
        input.experienceTrace.input,
        ...input.experienceTrace.modelOutputs,
        input.experienceTrace.output,
      ],
      this.config.knowledgeSettings?.ingestMaxMessages ?? 12
    );
    cognition = await this.attachCapture(
      result,
      input.history,
      input.sourcePrompt,
      input.deterministic.reply,
      input.sessionId,
      input.interactionMode,
      input.proposalsEnabled,
      cognition,
      input.options,
      sourceExperienceIds,
      input.backgroundTrace
    );
    result.activation = cognition.trace;
    this.emitRequestEvent(result, {
      sessionId: input.sessionId,
      started: input.started,
      prompt: input.prompt,
    });
    return result;
  }

  /**
   * Continuous capture (active mode) + optional M14 legacy auto-ingest flag.
   * Never accepts proposals.
   */
  private async attachCapture(
    result: OrchestratorResult,
    history: Array<{ role: string; content: string }>,
    prompt: string,
    reply: string,
    sessionId: string | undefined,
    interactionMode: InteractionMode,
    proposalsEnabled: boolean,
    cognition: CognitiveOperationContext,
    options?: OrchestratorHandleOptions,
    sourceExperienceIds: string[] = [],
    backgroundTrace?: NonNullable<OrchestratorResult["background"]>
  ): Promise<CognitiveOperationContext> {
    result.interactionMode = interactionMode;
    result.proposalsEnabled = proposalsEnabled;
    const sid = sessionId ?? "default";

    const kSettings = this.config.knowledgeSettings;
    if (!this.knowledge || !kSettings) {
      result.capture = { ran: false, reason: "knowledge store closed" };
      result.pendingProposalCount = 0;
      return cognition;
    }

    const force = options?.forceCapture === true;
    const shouldCapture =
      force ||
      (kSettings.captureEnabled &&
        interactionMode === "active" &&
        proposalsEnabled) ||
      kSettings.ingestAutoOnChat;

    const reportPending = async () => {
      try {
        const sessionPending = await listPendingForSession(this.knowledge!, sid);
        result.pendingProposalCount = sessionPending.length;
      } catch {
        try {
          const pending = await this.knowledge!.listProposals({
            status: "pending",
          });
          result.pendingProposalCount = pending.length;
        } catch {
          result.pendingProposalCount = 0;
        }
      }
    };

    if (!shouldCapture) {
      result.capture = {
        ran: false,
        reason:
          interactionMode === "neutral"
            ? "neutral mode (use /capture or /mode active)"
            : !proposalsEnabled
              ? "proposals off"
              : "capture disabled",
      };
      await reportPending();
      return cognition;
    }
    if (!isCapabilityActive(cognition, "knowledge_capture")) {
      result.capture = {
        ran: false,
        reason: "bounded activation skipped semantic capture for this input",
      };
      await reportPending();
      return cognition;
    }

    try {
      const messages = [
        ...history,
        { role: "user", content: prompt },
        { role: "assistant", content: reply },
      ];
      const captureTier = kSettings.captureModelTier;
      const captureTarget =
        captureTier === "heuristic"
          ? undefined
          : {
              client: this.local,
              model: kSettings.captureModel ?? this.config.ollamaModel,
            };
      let captureModelExperienceId: string | undefined;
      const turnId = result.experiences?.input ?? String(Date.now());
      const cap = await captureConversationSegment({
        store: this.knowledge,
        messages,
        sessionId: sid,
        turnId,
        experienceIds: sourceExperienceIds,
        force,
        minUserMessageLength:
          options?.minUserMessageLength ?? kSettings.ingestMinChars,
        maxProposalsPerTurn: options?.maxProposalsPerTurn ?? 8,
        maxMessages: kSettings.ingestMaxMessages,
        minIntervalMs: force
          ? 0
          : (options?.minCaptureIntervalMs ??
            kSettings.minCaptureIntervalMs ??
            8000),
        lastExtractAt: options?.lastExtractAt,
        model: captureTarget?.model,
        complete: captureTarget
          ? async (captureMessages) => {
              const response = await captureTarget.client.complete({
                messages: captureMessages,
                model: captureTarget.model,
                temperature: 0,
              });
              return response.content;
            }
          : undefined,
        onModelOutput: captureTarget
          ? async (output) => {
              const record = await this.recordExperience({
                kind: "assistant_output",
                sessionId,
                content: output,
                source: {
                  type: "model",
                  ref: `local:${captureTarget.model}`,
                },
                parentExperienceIds: sourceExperienceIds,
                metadata: {
                  model: captureTarget.model,
                  provider: "local",
                  semanticCapture: true,
                  historyMessage: false,
                },
              }, backgroundTrace);
              if (record) {
                captureModelExperienceId = record.id;
                result.experiences?.modelOutputs.push(record.id);
              }
              return record?.id;
            }
          : undefined,
      });
      result.proposals = cap.summaries as KnowledgeProposalSummary[];
      result.capture = {
        ran: cap.proposals.length > 0,
        reason: cap.reason,
        mode: cap.mode,
        eventId: cap.eventId || undefined,
        sourceExperienceIds: cap.sourceExperienceIds,
      };
      const sourceEvent = cap.eventId
        ? await this.knowledge.getEvent(cap.eventId)
        : null;
      result.semantic = {
        events: sourceEvent
          ? [{
              id: sourceEvent.id,
              sourceExperienceIds: sourceEvent.sourceExperienceIds,
              transformationMethod: sourceEvent.transformation?.method,
            }]
          : [],
        proposals: cap.proposals.map((proposal) => {
          const payload = proposal.payload;
          const canonicalIds = [
            payload.canonicalId,
            payload.canonicalNodeId,
            payload.targetId,
            payload.sourceId,
            payload.fromId,
            payload.toId,
          ].filter((value): value is string => typeof value === "string");
          return {
            id: proposal.id,
            kind: proposal.kind,
            eventId: proposal.eventId,
            epistemicStatus:
              typeof payload.epistemicStatus === "string"
                ? payload.epistemicStatus
                : undefined,
            canonicalIds: canonicalIds.length
              ? [...new Set(canonicalIds)]
              : undefined,
            oldClaimId:
              typeof payload.oldClaimId === "string"
                ? payload.oldClaimId
                : undefined,
            revisedClaimId:
              typeof payload.newClaimId === "string"
                ? payload.newClaimId
                : undefined,
          };
        }),
      };
      await reportPending();
      if (captureModelExperienceId) {
        cognition = contributeModelOutput(cognition, {
          provider: "local",
          model: captureTarget?.model ?? this.config.ollamaModel,
          experienceId: captureModelExperienceId,
          characters:
            (await this.experiences?.getExperience(captureModelExperienceId))
              ?.content?.length ?? 0,
        });
      }
      return contributeCapabilityOutput(cognition, {
        capabilityId: "knowledge_capture",
        status: cap.proposals.length > 0 ? "produced" : "empty",
        value: cap,
        detail: cap.reason,
        representations: cap.proposals.length > 0
          ? [{
              capabilityId: "knowledge_capture",
              kind: "pending_knowledge_proposals",
              ids: cap.proposals.map((proposal) => proposal.id),
              count: cap.proposals.length,
              detail: `${cap.mode}; event=${cap.eventId}`,
            }]
          : [],
      });
    } catch (err) {
      // Never break the main reply
      result.capture = {
        ran: false,
        reason: err instanceof Error ? err.message : String(err),
      };
      await reportPending();
      return recordCapabilityDegradation(cognition, {
        capabilityId: "knowledge_capture",
        reason: err instanceof Error ? err.message : String(err),
        fallback: "retain durable experiences and the response; create no semantic proposal",
      });
    }
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
    const latencyMs = Math.round(performance.now() - ctx.started);
    emitSafely(this.observer, {
      ts: new Date().toISOString(),
      kind: "request",
      sessionId: ctx.sessionId,
      route: result.routing.model,
      model: result.model,
      provider: result.provider,
      latencyMs,
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
    const cognition = observeCognitiveOperation(result, {
      latencyMs,
      tokens: ctx.tokens,
      promptPreviewIncluded: this.obsLogPrompts,
    });
    if (cognition) {
      emitSafely(this.observer, {
        ts: new Date().toISOString(),
        kind: "cognition",
        sessionId: ctx.sessionId,
        operationId: cognition.operationId,
        model: result.model,
        provider: result.provider,
        latencyMs,
        tokens: ctx.tokens ?? result.usage?.totalTokens,
        tools: toolNames.length > 0 ? toolNames : undefined,
        cognition,
      });
    }
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
  const observer = createObserverFromEnv(env);

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

  // M12–M14 + continuous capture: open knowledge unless capture explicitly disabled
  const knowledgeToolsEnabled = envFlagTrue(env.KNOWLEDGE_TOOLS_ENABLED);
  const knowledgeInjectEnabled = envFlagTrue(env.KNOWLEDGE_INJECT_ENABLED);
  const knowledgeIngestAutoOnChat = envFlagTrue(
    env.KNOWLEDGE_INGEST_AUTO_ON_CHAT
  );
  const knowledgeCaptureDisabled = envFlagTrue(
    env.KNOWLEDGE_CAPTURE_DISABLED
  );
  const knowledgeCaptureEnabled = !knowledgeCaptureDisabled;
  const captureTierRaw = env.KNOWLEDGE_CAPTURE_TIER?.trim().toLowerCase();
  const captureModelTier: "local" | "heuristic" =
    captureTierRaw === "heuristic" ? "heuristic" : "local";
  const defaultWorkspaceId =
    env.KNOWLEDGE_DEFAULT_WORKSPACE_ID?.trim() || workspace.id;
  const knowledge =
    knowledgeToolsEnabled ||
    knowledgeInjectEnabled ||
    knowledgeIngestAutoOnChat ||
    knowledgeCaptureEnabled
      ? createKnowledgeStore({
          defaultWorkspaceId,
          diagnosticSink: (record) => {
            emitSafely(observer, knowledgeDiagnosticEvent(record));
          },
        })
      : undefined;

  let tools = toolsDisabled ? undefined : createBuiltinRegistry();
  if (tools && knowledge && knowledgeToolsEnabled) {
    for (const t of createKnowledgeTools(knowledge)) {
      tools.register(t);
    }
  }

  return {
    ollamaBin: env.OLLAMA_BIN ?? "ollama",
    ollamaModel: env.OLLAMA_MODEL ?? "llama3.1:8b",
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
    tools,
    toolsEnabled,
    toolsMaxSteps: parsePositiveInt(env.TOOLS_MAX_STEPS, 5),
    longTerm,
    knowledge,
    knowledgeSettings: {
      toolsEnabled: knowledgeToolsEnabled,
      injectEnabled: knowledgeInjectEnabled,
      injectMaxChars: parsePositiveInt(env.KNOWLEDGE_INJECT_MAX_CHARS, 2000),
      injectHops: (parsePositiveInt(env.KNOWLEDGE_INJECT_HOPS, 1) >= 2
        ? 2
        : 1) as 1 | 2,
      ingestAutoOnChat: knowledgeIngestAutoOnChat,
      ingestMinChars: parsePositiveInt(env.KNOWLEDGE_INGEST_MIN_CHARS, 40),
      ingestMaxMessages: parsePositiveInt(
        env.KNOWLEDGE_INGEST_MAX_MESSAGES,
        12
      ),
      captureEnabled: knowledgeCaptureEnabled,
      minCaptureIntervalMs: parsePositiveInt(
        env.KNOWLEDGE_CAPTURE_MIN_INTERVAL_MS,
        8000
      ),
      captureModelTier,
      captureModel: env.KNOWLEDGE_CAPTURE_MODEL?.trim() || undefined,
    },
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
    observer,
    obsLogPrompts: loadObservabilityConfig(env).logPrompts,
  };
}

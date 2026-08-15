/**
 * Small runtime adapters that let package-owned capabilities contribute values
 * to one operation. Selection remains in capabilityActivation; no function in
 * this module owns the interactive loop.
 */

import {
  compressHistory,
  LocalModelSummarizer,
} from "@workflows/compression";
import {
  formatRetrievalBlock,
  retrieve,
  type RetrievedChunk,
} from "@workflows/retrieval";
import {
  acquireRepresentation,
  resolveRepresentationClarification,
  hydrateKnowledgeLineageContext,
  isLowSubstanceUserMessage,
  selectKnowledgeContext,
  type KnowledgeContextSelection,
  type KnowledgeLineageContext,
  type KnowledgeStore,
  type RepresentationAcquisitionResult,
  type RepresentationGap,
  type RepresentationSourceMetadata,
} from "@workflows/knowledge";
import type {
  ExperienceRecord,
  LongTermMemory,
  MemoryFact,
  RecordExperienceInput,
} from "@workflows/memory";
import {
  runToolLoop,
  toModelToolSchemas,
  type ToolLoopStep,
  type ToolRegistry,
} from "@workflows/tools";
import type {
  ChatMessage,
  ModelClient,
  ModelChoice,
  ModelResponse,
  OrchestratorConfig,
  OrchestratorResult,
} from "./types.js";
import {
  contributeCapabilityOutput,
  contributeModelOutput,
  contributeToolOutputs,
  expandCapabilities,
  isCapabilityActive,
  recordCapabilityDegradation,
  type CapabilityId,
  type CognitiveOperationContext,
} from "./capabilityActivation.js";

export interface DeterministicResponseValue {
  reply: string;
  mechanism:
    | "arithmetic"
    | "representation_clarification"
    | "representation_resolution";
}

export interface RepresentationAcquisitionValue {
  result: RepresentationAcquisitionResult;
}

export interface SessionHistoryValue {
  messages: ChatMessage[];
}

export interface CompressionValue {
  summary: string | null;
  recentMessages: ChatMessage[];
  compressed: boolean;
  originalCount: number;
}

export interface ContextRetrievalValue {
  chunks: RetrievedChunk[];
  block: string | null;
}

export interface KnowledgeRetrievalValue {
  selected: KnowledgeContextSelection | null;
}

export interface ProvenanceLineageValue {
  lineage: KnowledgeLineageContext;
}

export interface LongTermMemoryValue {
  facts: MemoryFact[];
  block: string | null;
}

export interface ActivatedResponse {
  reply: string;
  model: string;
  provider: ModelChoice;
  usage?: ModelResponse["usage"];
  toolSteps?: ToolLoopStep[];
  toolsHitMaxSteps?: boolean;
  cognition: CognitiveOperationContext;
  experiences: NonNullable<OrchestratorResult["experiences"]>;
}

interface ResponseCapabilityInput {
  client: ModelClient;
  model: string;
  provider: ModelChoice;
  messages: ChatMessage[];
  sessionId?: string;
  cognition: CognitiveOperationContext;
  experiences: NonNullable<OrchestratorResult["experiences"]>;
  recordExperience(
    input: RecordExperienceInput
  ): Promise<ExperienceRecord | undefined>;
}

/** The selected model contributes one response; it does not own the operation. */
export async function contributeModelResponse(
  input: ResponseCapabilityInput
): Promise<ActivatedResponse> {
  const response = await input.client.complete({
    messages: input.messages,
    model: input.model,
  });
  const output = await input.recordExperience({
    kind: "assistant_output",
    sessionId: input.sessionId,
    content: response.content,
    source: { type: "model", ref: `${response.provider}:${response.model}` },
    parentExperienceIds: input.experiences.input
      ? [input.experiences.input]
      : undefined,
    metadata: {
      model: response.model,
      provider: response.provider,
      usage: response.usage,
    },
  });
  if (output) {
    input.experiences.modelOutputs.push(output.id);
    input.experiences.output = output.id;
  }
  return {
    reply: response.content,
    model: response.model,
    provider: response.provider,
    usage: response.usage,
    cognition: contributeModelOutput(input.cognition, {
      provider: response.provider,
      model: response.model,
      experienceId: output?.id,
      characters: response.content.length,
    }),
    experiences: input.experiences,
  };
}

/** The tools package owns its bounded loop; hooks retain every influential source. */
export async function contributeToolResponse(
  input: ResponseCapabilityInput & {
    registry: ToolRegistry;
    workspaceRoot: string;
    maxSteps: number;
  }
): Promise<ActivatedResponse> {
  let finalOutputExperienceId: string | undefined;
  const loop = await runToolLoop(input.messages, {
    maxSteps: input.maxSteps,
    workspaceRoot: input.workspaceRoot,
    registry: input.registry,
    complete: async (messages, tools) => {
      const response = await input.client.complete({
        messages,
        model: input.model,
        tools: toModelToolSchemas(tools),
      });
      return { text: response.content, toolCalls: response.toolCalls };
    },
    onModelOutput: async (output) => {
      if (!output.text) return;
      const parent =
        input.experiences.toolResults.at(-1) ?? input.experiences.input;
      const record = await input.recordExperience({
        kind: "assistant_output",
        sessionId: input.sessionId,
        content: output.text,
        source: { type: "model", ref: `${input.provider}:${input.model}` },
        parentExperienceIds: parent ? [parent] : undefined,
        metadata: {
          model: input.model,
          provider: input.provider,
          intermediate: Boolean(output.toolCalls?.length),
          historyMessage: !output.toolCalls?.length,
        },
      });
      if (record) {
        input.experiences.modelOutputs.push(record.id);
        if (!output.toolCalls?.length) finalOutputExperienceId = record.id;
      }
      return record?.id;
    },
    onToolCall: async (call, modelOutputExperienceId) => {
      const parent = modelOutputExperienceId ?? input.experiences.input;
      const record = await input.recordExperience({
        kind: "tool_call",
        sessionId: input.sessionId,
        content: JSON.stringify({ name: call.name, args: call.args }),
        source: { type: "model", ref: call.id },
        parentExperienceIds: parent ? [parent] : undefined,
        metadata: { tool: call.name, callId: call.id },
      });
      if (record) input.experiences.toolCalls.push(record.id);
      return record?.id;
    },
    onToolResult: async (step, toolCallExperienceId) => {
      const record = await input.recordExperience({
        kind: "tool_result",
        sessionId: input.sessionId,
        content: step.result.output,
        source: { type: "tool", ref: step.call.name },
        parentExperienceIds: toolCallExperienceId
          ? [toolCallExperienceId]
          : undefined,
        metadata: {
          tool: step.call.name,
          callId: step.call.id,
          ok: step.result.ok,
          error: step.result.error,
          durationMs: step.durationMs,
        },
      });
      if (record) input.experiences.toolResults.push(record.id);
      return record?.id;
    },
  });
  if (!finalOutputExperienceId) {
    const parent =
      input.experiences.toolResults.at(-1) ?? input.experiences.input;
    const record = await input.recordExperience({
      kind: "assistant_output",
      sessionId: input.sessionId,
      content: loop.finalText,
      source: { type: "model", ref: `${input.provider}:${input.model}` },
      parentExperienceIds: parent ? [parent] : undefined,
      metadata: {
        model: input.model,
        provider: input.provider,
        historyMessage: true,
        maxStepsOutcome: loop.hitMaxSteps,
      },
    });
    if (record) {
      input.experiences.modelOutputs.push(record.id);
      finalOutputExperienceId = record.id;
    }
  }
  input.experiences.output = finalOutputExperienceId;
  let cognition = contributeToolOutputs(
    input.cognition,
    loop.steps.map((step, index) => ({
      name: step.call.name,
      ok: step.result.ok,
      characters: step.result.output.length,
      experienceId: input.experiences.toolResults[index],
    }))
  );
  cognition = contributeModelOutput(cognition, {
    provider: input.provider,
    model: input.model,
    experienceId: finalOutputExperienceId,
    characters: loop.finalText.length,
  });
  return {
    reply: loop.finalText,
    model: input.model,
    provider: input.provider,
    toolSteps: loop.steps,
    toolsHitMaxSteps: loop.hitMaxSteps,
    cognition,
    experiences: input.experiences,
  };
}

export function capabilityValue<T>(
  context: CognitiveOperationContext,
  capabilityId: CapabilityId
): T | undefined {
  return [...context.outputs]
    .reverse()
    .find((output) => output.capabilityId === capabilityId && output.status === "produced")
    ?.value as T | undefined;
}

/** A deliberately tiny deterministic capability, not an intent taxonomy. */
export function calculateDeterministicResponse(
  input: string
): DeterministicResponseValue | null {
  const match = input.trim().match(
    /^(?:(?:what is|calculate|compute|hva er|regn ut)\s+)?(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*\??$/i
  );
  if (!match) return null;
  const left = Number(match[1]);
  const right = Number(match[3]);
  const operator = match[2]!;
  let value: number;
  if (operator === "+") value = left + right;
  else if (operator === "-") value = left - right;
  else if (operator === "*") value = left * right;
  else {
    if (right === 0) return null;
    value = left / right;
  }
  if (!Number.isFinite(value)) return null;
  return {
    reply: `${left} ${operator} ${right} = ${Number.isInteger(value) ? value : Number(value.toPrecision(12))}`,
    mechanism: "arithmetic",
  };
}

export function isExplicitCorrection(input: string): boolean {
  return /\b(actually|correction|correct(?:ion|ing)?|instead|not .{1,80} but|faktisk|rettelse|korriger(?:ing|er|te)?|ikke .{1,80} men)\b/i.test(input);
}

export function shouldActivateKnowledgeCapture(input: {
  prompt: string;
  force: boolean;
  interactionMode: "active" | "neutral";
  proposalsEnabled: boolean;
  settings?: OrchestratorConfig["knowledgeSettings"];
  knowledgeAvailable: boolean;
  minUserMessageLength?: number;
  lastExtractAt?: number;
  minCaptureIntervalMs?: number;
}): boolean {
  const settings = input.settings;
  if (!settings || !input.knowledgeAvailable) return false;
  const enabled =
    input.force ||
    (settings.captureEnabled &&
      input.interactionMode === "active" &&
      input.proposalsEnabled) ||
    settings.ingestAutoOnChat;
  if (!enabled) return false;
  if (input.force) return true;
  const minInterval =
    input.minCaptureIntervalMs ?? settings.minCaptureIntervalMs ?? 8_000;
  if (
    minInterval > 0 &&
    input.lastExtractAt != null &&
    Date.now() - input.lastExtractAt < minInterval
  ) {
    return false;
  }
  return !isLowSubstanceUserMessage(
    input.prompt,
    input.minUserMessageLength ?? settings.ingestMinChars
  );
}

export function contributeOperationStart(
  context: CognitiveOperationContext,
  input: {
    history: ChatMessage[];
    deterministic: DeterministicResponseValue | null;
  }
): CognitiveOperationContext {
  let next = contributeCapabilityOutput(context, {
    capabilityId: "deterministic_processing",
    status: "produced",
    detail: "routing, identity/context resolution, and bounded activation signals",
    value: input.deterministic ?? undefined,
    representations: [
      ...(context.inputExperienceId
        ? [{
            capabilityId: "deterministic_processing" as const,
            kind: "durable_input_experience",
            ids: [context.inputExperienceId],
            count: 1,
          }]
        : []),
      {
        capabilityId: "deterministic_processing",
        kind: "available_identity_context",
        count: Number(Boolean(context.sessionId)) + Number(Boolean(context.workspaceId)),
        detail: "optional session/workspace context resolved without requiring a project",
      },
      ...(input.deterministic
        ? [{
            capabilityId: "deterministic_processing" as const,
            kind: "deterministic_result",
            characters: input.deterministic.reply.length,
            detail: input.deterministic.mechanism,
          }]
        : []),
    ],
  });
  if (isCapabilityActive(next, "session_history")) {
    next = contributeCapabilityOutput(next, {
      capabilityId: "session_history",
      status: input.history.length > 0 ? "produced" : "empty",
      value: { messages: input.history } satisfies SessionHistoryValue,
      representations: input.history.length > 0
        ? [{
            capabilityId: "session_history",
            kind: "session_messages",
            count: input.history.length,
          }]
        : [],
    });
  }
  return next;
}

function inspectionMetadata(value: unknown): RepresentationSourceMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  const nested = root.metadata;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as RepresentationSourceMetadata
    : root as RepresentationSourceMetadata;
}

/**
 * Resolve one operation-local referent through the knowledge package. Tool
 * execution remains bounded and owned by the existing registry.
 */
export async function contributeRepresentationAcquisition(
  context: CognitiveOperationContext,
  input: {
    store?: KnowledgeStore;
    prompt: string;
    sourceExperienceId?: string;
    sessionId?: string;
    workspaceId?: string;
    metadata?: RepresentationSourceMetadata;
    pendingGap?: RepresentationGap | null;
    inspection?: { toolName: string; args?: Record<string, unknown> };
    registry?: ToolRegistry;
    workspaceRoot: string;
    experiences: NonNullable<OrchestratorResult["experiences"]>;
    recordExperience(
      input: RecordExperienceInput
    ): Promise<ExperienceRecord | undefined>;
  }
): Promise<{
  cognition: CognitiveOperationContext;
  result?: RepresentationAcquisitionResult;
}> {
  if (
    !input.store ||
    !input.sourceExperienceId ||
    !isCapabilityActive(context, "representation_acquisition")
  ) {
    return { cognition: context };
  }

  let next = context;
  try {
    const result = input.pendingGap
      ? await resolveRepresentationClarification({
          store: input.store,
          gap: input.pendingGap,
          answer: input.prompt,
          clarificationExperienceId: input.sourceExperienceId,
          canonicalId: input.metadata?.canonicalId,
          sourceType: input.metadata?.sourceType,
        })
      : await acquireRepresentation({
          store: input.store,
          content: input.prompt,
          sourceExperienceId: input.sourceExperienceId,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          metadata: input.metadata,
          inspect:
            input.inspection &&
            input.registry &&
            isCapabilityActive(next, "tools")
              ? async () => {
                  const call = {
                    id: `${next.operationId}:representation-inspection`,
                    name: input.inspection!.toolName,
                    args: input.inspection!.args ?? {},
                  };
                  const callExperience = await input.recordExperience({
                    kind: "tool_call",
                    sessionId: input.sessionId,
                    content: JSON.stringify({ name: call.name, args: call.args }),
                    source: { type: "representation_acquisition", ref: call.id },
                    parentExperienceIds: [input.sourceExperienceId!],
                    metadata: {
                      tool: call.name,
                      callId: call.id,
                      representationInspection: true,
                    },
                  });
                  if (callExperience) input.experiences.toolCalls.push(callExperience.id);
                  const started = performance.now();
                  const toolResult = await input.registry!.execute(
                    call.name,
                    call.args,
                    { workspaceRoot: input.workspaceRoot }
                  );
                  const resultExperience = await input.recordExperience({
                    kind: "tool_result",
                    sessionId: input.sessionId,
                    content: toolResult.output,
                    source: { type: "tool", ref: call.name },
                    parentExperienceIds: callExperience ? [callExperience.id] : undefined,
                    metadata: {
                      tool: call.name,
                      callId: call.id,
                      ok: toolResult.ok,
                      error: toolResult.error,
                      durationMs: Math.round(performance.now() - started),
                      representationInspection: true,
                    },
                  });
                  if (resultExperience) input.experiences.toolResults.push(resultExperience.id);
                  next = contributeToolOutputs(next, [{
                    name: call.name,
                    ok: toolResult.ok,
                    characters: toolResult.output.length,
                    experienceId: resultExperience?.id,
                  }]);
                  let data = inspectionMetadata(toolResult.data);
                  if (!data && toolResult.output.trim().startsWith("{")) {
                    try {
                      data = inspectionMetadata(JSON.parse(toolResult.output));
                    } catch {
                      // A non-JSON tool result simply did not resolve metadata.
                    }
                  }
                  if (!toolResult.ok) {
                    next = recordCapabilityDegradation(next, {
                      capabilityId: "tools",
                      reason: toolResult.error || "representation inspection tool failed",
                      fallback: "preserve the gap and ask one bounded clarification",
                    });
                  }
                  return {
                    metadata: data,
                    sourceExperienceIds: [
                      ...(callExperience ? [callExperience.id] : []),
                      ...(resultExperience ? [resultExperience.id] : []),
                    ],
                  };
                }
              : undefined,
        });
    next = contributeCapabilityOutput(next, {
      capabilityId: "representation_acquisition",
      status: result.status === "not_applicable" ? "empty" : "produced",
      value: { result } satisfies RepresentationAcquisitionValue,
      detail:
        result.status === "resolved"
          ? `resolved by ${result.method}`
          : result.status === "needs_clarification"
            ? "material ambiguity remains"
            : "no material representational gap",
      representations: [
        ...(result.gap
          ? [{
              capabilityId: "representation_acquisition" as const,
              kind: "representation_gap",
              ids: [result.gap.id],
              count: 1,
              detail: result.gap.status,
            }]
          : []),
        ...(result.canonical
          ? [{
              capabilityId: "representation_acquisition" as const,
              kind: "canonical_identity",
              ids: [result.canonical.id],
              count: 1,
              detail: result.method,
            }]
          : []),
        ...(result.sourceExperienceIds.length
          ? [{
              capabilityId: "representation_acquisition" as const,
              kind: "source_experience_references",
              ids: result.sourceExperienceIds,
              count: result.sourceExperienceIds.length,
            }]
          : []),
      ],
    });
    return { cognition: next, result };
  } catch (error) {
    return {
      cognition: recordCapabilityDegradation(next, {
        capabilityId: "representation_acquisition",
        reason: error instanceof Error ? error.message : String(error),
        fallback: "preserve existing canonical identities and continue without an identity guess",
      }),
    };
  }
}

export async function contributeContextRetrieval(
  context: CognitiveOperationContext,
  input: {
    prompt: string;
    history: ChatMessage[];
    settings: OrchestratorConfig["retrieval"];
    embeddings?: OrchestratorConfig["embeddings"];
  }
): Promise<CognitiveOperationContext> {
  if (!isCapabilityActive(context, "context_retrieval")) return context;
  try {
    const chunks = await retrieve(input.prompt, {
      sessionMessages: input.history,
      contextDir: input.settings.contextDir,
      limit: input.settings.limit,
      maxChars: input.settings.maxChars,
      maxChunkChars: input.settings.maxChunkChars,
      embeddings: input.embeddings,
    });
    return contributeCapabilityOutput(context, {
      capabilityId: "context_retrieval",
      status: chunks.length > 0 ? "produced" : "empty",
      value: { chunks, block: formatRetrievalBlock(chunks) } satisfies ContextRetrievalValue,
      representations: chunks.map((chunk) => ({
        capabilityId: "context_retrieval",
        kind: chunk.source,
        ids: [chunk.id],
        characters: chunk.text.length,
      })),
    });
  } catch (error) {
    return recordCapabilityDegradation(context, {
      capabilityId: "context_retrieval",
      reason: error instanceof Error ? error.message : String(error),
      fallback: "continue without retrieved context",
    });
  }
}

export async function contributeHistoryCompression(
  context: CognitiveOperationContext,
  input: {
    history: ChatMessage[];
    settings: OrchestratorConfig["compression"];
    local: ModelClient;
    localModel: string;
  }
): Promise<CognitiveOperationContext> {
  if (!isCapabilityActive(context, "history_compression")) return context;
  const result = await compressHistory(
    input.history,
    input.settings,
    new LocalModelSummarizer(
      input.local,
      input.localModel,
      input.settings.maxSummaryChars
    )
  );
  return contributeCapabilityOutput(context, {
    capabilityId: "history_compression",
    status: result.compressed ? "produced" : "empty",
    value: {
      summary: result.summary,
      recentMessages: result.recentMessages,
      compressed: result.compressed,
      originalCount: input.history.length,
    } satisfies CompressionValue,
    representations: result.summary
      ? [{
          capabilityId: "history_compression",
          kind: "history_summary",
          count: input.history.length - result.recentMessages.length,
          characters: result.summary.length,
        }]
      : [],
  });
}

export async function contributeKnowledgeRetrieval(
  context: CognitiveOperationContext,
  input: {
    store?: KnowledgeStore;
    prompt: string;
    maxChars: number;
    hops: 1 | 2;
  }
): Promise<CognitiveOperationContext> {
  if (!input.store || !isCapabilityActive(context, "knowledge_retrieval")) {
    return context;
  }
  try {
    const selected = await selectKnowledgeContext(input.store, input.prompt, {
      maxChars: input.maxChars,
      hops: input.hops,
    });
    let next = contributeCapabilityOutput(context, {
      capabilityId: "knowledge_retrieval",
      status: selected ? "produced" : "empty",
      value: { selected } satisfies KnowledgeRetrievalValue,
      representations: selected
        ? [{
            capabilityId: "knowledge_retrieval",
            kind: "canonical_knowledge",
            ids: selected.canonicalIds,
            count: selected.canonicalIds.length,
            characters: selected.text.length,
          }]
        : [],
    });
    if (
      selected?.contradictionIds.length &&
      !isCapabilityActive(next, "provenance_lineage")
    ) {
      next = expandCapabilities(next, {
        trigger: "contradiction",
        reason: "retrieved canonical knowledge contains a contradiction",
        fromCapabilityId: "knowledge_retrieval",
        capabilityIds: ["provenance_lineage"],
      });
    }
    return next;
  } catch (error) {
    return recordCapabilityDegradation(context, {
      capabilityId: "knowledge_retrieval",
      reason: error instanceof Error ? error.message : String(error),
      fallback: "continue with bounded session/workspace context and the selected response capability",
    });
  }
}

export async function contributeProvenanceLineage(
  context: CognitiveOperationContext,
  store?: KnowledgeStore
): Promise<CognitiveOperationContext> {
  if (!store || !isCapabilityActive(context, "provenance_lineage")) return context;
  const selected = capabilityValue<KnowledgeRetrievalValue>(
    context,
    "knowledge_retrieval"
  )?.selected;
  try {
    const lineage = await hydrateKnowledgeLineageContext(
      store,
      selected?.claimIds ?? [],
      context.limits.knowledgeChars
    );
    return contributeCapabilityOutput(context, {
      capabilityId: "provenance_lineage",
      status: lineage.claimIds.length > 0 ? "produced" : "empty",
      value: { lineage } satisfies ProvenanceLineageValue,
      representations: lineage.claimIds.length > 0
        ? [
            {
              capabilityId: "provenance_lineage",
              kind: "claim_lineage",
              ids: lineage.claimIds,
              count: lineage.claimIds.length,
              characters: lineage.text?.length,
              detail: `${lineage.eventIds.length} events; ${lineage.experienceIds.length} source experiences`,
            },
            ...(lineage.experienceIds.length > 0
              ? [{
                  capabilityId: "provenance_lineage" as const,
                  kind: "source_experience_references",
                  ids: lineage.experienceIds,
                  count: lineage.experienceIds.length,
                }]
              : []),
          ]
        : [],
    });
  } catch (error) {
    return recordCapabilityDegradation(context, {
      capabilityId: "provenance_lineage",
      reason: error instanceof Error ? error.message : String(error),
      fallback: "retain canonical knowledge without claiming hydrated provenance",
    });
  }
}

export async function contributeLongTermMemory(
  context: CognitiveOperationContext,
  input: {
    memory?: LongTermMemory;
    prompt: string;
    settings?: OrchestratorConfig["longTermSettings"];
  }
): Promise<CognitiveOperationContext> {
  if (!input.memory || !isCapabilityActive(context, "long_term_memory")) {
    return context;
  }
  try {
    const facts = await input.memory.recall({
      text: input.prompt,
      limit: input.settings?.injectLimit ?? 5,
    });
    let block = facts
      .map((fact) => fact.key ? `- [${fact.key}] ${fact.content}` : `- ${fact.content}`)
      .join("\n");
    const maxChars = input.settings?.injectMaxChars ?? 1_500;
    if (block.length > maxChars) block = block.slice(0, Math.max(0, maxChars - 3)) + "...";
    return contributeCapabilityOutput(context, {
      capabilityId: "long_term_memory",
      status: facts.length > 0 ? "produced" : "empty",
      value: { facts, block: block || null } satisfies LongTermMemoryValue,
      representations: facts.map((fact) => ({
        capabilityId: "long_term_memory",
        kind: "memory_fact",
        ids: [fact.id],
        characters: fact.content.length,
      })),
    });
  } catch (error) {
    return recordCapabilityDegradation(context, {
      capabilityId: "long_term_memory",
      reason: error instanceof Error ? error.message : String(error),
      fallback: "continue without long-term memory",
    });
  }
}

export function buildModelMessages(
  context: CognitiveOperationContext,
  input: {
    prompt: string;
    systemPrompt: string;
    interactionMode: "active" | "neutral";
    tools?: ToolRegistry;
    useTools: boolean;
    toolsSystemAddendum: string;
    formatTools: (tools: ReturnType<ToolRegistry["list"]>) => string;
  }
): ChatMessage[] {
  const systemParts = [input.systemPrompt];
  if (input.useTools && input.tools) {
    systemParts.push(input.toolsSystemAddendum, input.formatTools(input.tools.list()));
  }
  systemParts.push(
    input.interactionMode === "active"
      ? "Interaction mode: ACTIVE (sparring). Free-form reasoning partner - do not take over the analysis. Challenge weak assumptions; point out missing causal links; stay concise. Knowledge capture runs separately into a pending queue."
      : "Interaction mode: NEUTRAL. Answer helpfully and briefly. Do not expand into unsolicited coaching. Knowledge is only stored when explicitly captured."
  );
  const knowledge = capabilityValue<KnowledgeRetrievalValue>(context, "knowledge_retrieval")?.selected;
  const representation = capabilityValue<RepresentationAcquisitionValue>(
    context,
    "representation_acquisition"
  )?.result;
  if (representation?.canonical) {
    systemParts.push(
      `Resolved referent (canonical, contextual): ${representation.canonical.label} ` +
      `(id=${representation.canonical.id}, type=${representation.canonical.type}, method=${representation.method}).`
    );
  }
  const lineage = capabilityValue<ProvenanceLineageValue>(context, "provenance_lineage")?.lineage;
  if (knowledge?.text) systemParts.push(knowledge.text);
  if (lineage?.text) systemParts.push(lineage.text);
  const ltm = capabilityValue<LongTermMemoryValue>(context, "long_term_memory");
  const retrieved = capabilityValue<ContextRetrievalValue>(context, "context_retrieval");
  const compressed = capabilityValue<CompressionValue>(context, "history_compression");
  const history = capabilityValue<SessionHistoryValue>(context, "session_history")?.messages ?? [];
  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...(ltm?.block ? [{ role: "system" as const, content: `Long-term memory (relevant facts):\n${ltm.block}` }] : []),
    ...(retrieved?.block ? [{ role: "system" as const, content: `Retrieved context:\n${retrieved.block}` }] : []),
    ...(compressed?.summary ? [{ role: "system" as const, content: `Earlier in this session:\n${compressed.summary}` }] : []),
    ...(compressed?.recentMessages ?? history),
    { role: "user", content: input.prompt },
  ];
}

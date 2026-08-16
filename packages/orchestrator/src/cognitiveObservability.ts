import type {
  KnowledgeBackgroundPassResult,
  KnowledgeDiagnosticRecord,
} from "@workflows/knowledge";
import type {
  CcBackgroundPassObservation,
  CcCapabilityDecisionSummary,
  CcKnowledgeWriteObservation,
  CcOperationObservation,
  OrchestratorEvent,
} from "@workflows/observability";
import type { OrchestratorResult } from "./types.js";

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function decisionSummary(
  decision: NonNullable<OrchestratorResult["activation"]>["decisions"][number]
): CcCapabilityDecisionSummary {
  return {
    capabilityId: decision.capabilityId,
    kind: decision.kind,
    phase: decision.phase,
    reason: decision.reason,
    budget: decision.budget,
  };
}

/** Pure diagnostic projection. It intentionally has no access to private content. */
export function observeCognitiveOperation(
  result: OrchestratorResult,
  input: {
    latencyMs: number;
    tokens?: number;
    promptPreviewIncluded: boolean;
  }
): CcOperationObservation | undefined {
  const activation = result.activation;
  if (!activation) return undefined;
  const experiences = result.experiences;
  const semanticEvents = result.semantic?.events ?? [];
  const semanticProposals = result.semantic?.proposals ?? [];
  const representations = activation.representations;
  const canonicalIds = unique([
    result.representation?.canonicalId,
    ...representations
      .filter((item) =>
        item.kind === "canonical_identity" || item.kind === "canonical_knowledge"
      )
      .flatMap((item) => item.ids ?? []),
  ]);
  const sourceExperienceIds = unique([
    ...semanticEvents.flatMap((item) => item.sourceExperienceIds),
    ...representations
      .filter((item) => item.kind === "source_experience_references")
      .flatMap((item) => item.ids ?? []),
  ]);
  const correctionOccurred =
    experiences?.inputKind === "human_correction" ||
    semanticProposals.some((item) => item.kind === "supersede");
  const clarificationResolved =
    result.representation?.status === "resolved" &&
    result.representation.method === "human_clarification";
  const priorClarificationReused =
    result.representation?.status === "resolved" &&
    result.representation.method === "prior_clarification";
  const toolSuccesses = result.toolSteps?.filter((step) => step.result.ok).length ?? 0;
  const toolFailures = result.toolSteps?.filter((step) => !step.result.ok).length ?? 0;
  const outputIds = unique([
    experiences?.output,
    ...(experiences?.modelOutputs ?? []),
    ...(experiences?.deterministicOutputs ?? []),
  ]);

  return {
    schemaVersion: 1,
    operationId: activation.operationId,
    experiences: {
      inputExperienceId: experiences?.input,
      inputKind: experiences?.inputKind,
      outputExperienceIds: outputIds,
      modelOutputExperienceIds: experiences?.modelOutputs ?? [],
      deterministicOutputExperienceIds: experiences?.deterministicOutputs ?? [],
      toolCallExperienceIds: experiences?.toolCalls ?? [],
      toolResultExperienceIds: experiences?.toolResults ?? [],
      clarificationExperienceIds:
        clarificationResolved && experiences?.input ? [experiences.input] : [],
      correctionExperienceIds:
        correctionOccurred && experiences?.input ? [experiences.input] : [],
      backgroundSourceExperienceIds: result.background?.sourceExperienceIds ?? [],
    },
    activation: {
      selected: activation.decisions
        .filter((item) => item.state === "selected")
        .map(decisionSummary),
      skipped: activation.decisions
        .filter((item) => item.state === "skipped")
        .map(decisionSummary),
      degraded: activation.decisions
        .filter((item) => item.state === "degraded")
        .map(decisionSummary),
      expansions: activation.expansions.map((item) => ({
        trigger: item.trigger,
        depth: item.depth,
        requested: item.requested,
        activated: item.activated,
        rejected: item.rejected,
        reason: item.reason,
      })),
      limits: { ...activation.limits },
      representations: representations.map((item) => ({ ...item })),
      outcomes: activation.outcomes.map((item) => ({ ...item })),
    },
    model: {
      tier: result.policy?.tier ?? result.provider,
      provider: result.provider,
      model: result.model,
    },
    tools: unique(result.toolSteps?.map((step) => step.call.name) ?? []),
    knowledge: {
      canonicalIds,
      sourceEventIds: unique([
        result.capture?.eventId,
        result.representation?.sourceEventId,
        ...semanticEvents.map((item) => item.id),
      ]),
      sourceExperienceIds,
      proposalWrites: semanticProposals.map((item) => ({
        proposalId: item.id,
        kind: item.kind,
        eventId: item.eventId,
        epistemicStatus: item.epistemicStatus,
        canonicalIds: item.canonicalIds,
        oldClaimId: item.oldClaimId,
        revisedClaimId: item.revisedClaimId,
      })),
      epistemicStatuses: unique(
        semanticProposals.map((item) => item.epistemicStatus)
      ),
      transformationMethods: unique(
        semanticEvents.map((item) => item.transformationMethod)
      ),
      gapId: result.representation?.gapId,
      resolutionMethod: result.representation?.method,
      // Capture writes are proposals, not completed truth revisions.
      supersededClaimIds: [],
      disputedClaimIds: [],
      contradictionIds: [],
    },
    outcome: {
      correctionOccurred,
      clarificationResolved,
      priorClarificationReused,
      responseDegraded: activation.degradations.length > 0 || toolFailures > 0,
      toolSuccesses,
      toolFailures,
      canonicalUnderstandingRevised: false,
      backgroundDeferred: (result.background?.workIds.length ?? 0) > 0,
      proposalIds: semanticProposals.map((item) => item.id),
    },
    usage: {
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
      totalTokens: result.usage?.totalTokens ?? input.tokens,
      latencyMs: input.latencyMs,
      toolSteps: result.toolSteps?.length ?? 0,
    },
    privacy: {
      fullContentIncluded: false,
      promptPreviewIncluded: input.promptPreviewIncluded,
    },
  };
}

export function observeKnowledgeWrite(
  record: KnowledgeDiagnosticRecord
): CcKnowledgeWriteObservation {
  return {
    action: record.action,
    eventId: record.eventId,
    proposalIds: record.proposalIds ?? [],
    proposalKind: record.proposalKind,
    canonicalIds: record.canonicalIds ?? [],
    sourceExperienceIds: record.sourceExperienceIds ?? [],
    epistemicStatus: record.epistemicStatus,
    transformationMethod: record.transformationMethod,
    gapId: record.gapId,
    resolutionMethod: record.resolutionMethod,
    oldClaimId: record.oldClaimId,
    revisedClaimId: record.revisedClaimId,
    contradictionId: record.contradictionId,
  };
}

export function knowledgeDiagnosticEvent(
  record: KnowledgeDiagnosticRecord
): OrchestratorEvent {
  return {
    ts: new Date().toISOString(),
    kind: "knowledge",
    knowledge: observeKnowledgeWrite(record),
  };
}

export function observeBackgroundPass(
  passId: string,
  result: KnowledgeBackgroundPassResult,
  input: {
    limits?: Record<string, number>;
    workIds?: string[];
    work?: CcBackgroundPassObservation["work"];
    sourceExperienceIds?: string[];
  } = {}
): CcBackgroundPassObservation {
  return {
    passId,
    limits: input.limits,
    workIds: input.workIds ?? [],
    work: input.work ?? [],
    sourceExperienceIds: input.sourceExperienceIds ?? [],
    ...result,
  };
}

import type { Pool } from "pg";
import { conversationHeuristicExtract, isLowSubstanceUserMessage, rankAndCapItems } from "./conversationExtract.js";
import { extractionToProposalItems } from "./extract.js";
import { processGraphProjectionOutbox } from "./graphProjection.js";
import { proposalToRepresentationGap } from "./representationAcquisition.js";
import { processVectorProjectionOutbox, type SemanticEmbeddingProvider } from "./semanticProjection.js";
import type { CanonicalKnowledgeRepository, GraphRepository, VectorRepository } from "./storage/contracts.js";
import type {
  KnowledgeBackgroundWork,
  KnowledgeNode,
  KnowledgeTransformation,
} from "./types.js";
import { createPostgresBackgroundWorkRepository } from "./postgres/backgroundRepository.js";

export interface BackgroundExperienceSource {
  getExperience(id: string): Promise<{
    id: string;
    kind: string;
    content?: string;
    payloadRef?: string;
    source?: { type: string; ref?: string };
    parentExperienceIds: string[];
  } | null>;
}

export interface BackgroundWorkPersistence {
  withExclusivePass<T>(run: () => Promise<T>): Promise<T | null>;
  listAvailable(limit: number): Promise<KnowledgeBackgroundWork[]>;
  hasSemanticProposalsForExperience(experienceId: string): Promise<boolean>;
  ensureEvent(input: {
    work: KnowledgeBackgroundWork;
    sourceType: "conversation" | "file" | "project" | "manual";
    sourceExperienceIds: string[];
    transformation: KnowledgeTransformation;
  }): Promise<string>;
  complete(id: string, payloadPatch?: Record<string, unknown>): Promise<void>;
  wait(id: string, payloadPatch?: Record<string, unknown>): Promise<void>;
  escalate(id: string, payloadPatch: Record<string, unknown>): Promise<void>;
  fail(input: {
    id: string;
    error: string;
    maxRetries: number;
    retryDelayMs: number;
  }): Promise<"retry" | "escalated">;
}

export interface KnowledgeBackgroundLimits {
  maxItems: number;
  maxProposalsPerExperience: number;
  maxRetries: number;
  retryDelayMs: number;
  maxLineageDepth: number;
  maxContradictionInspections: number;
  maxProjectionItems: number;
  maxModelCalls: number;
}

export interface KnowledgeBackgroundPassResult {
  itemsInspected: number;
  itemsCompleted: number;
  itemsUnchanged: number;
  retriesScheduled: number;
  proposalsCreated: number;
  gapsResolved: number;
  contradictionsSurfaced: number;
  projectionsReconciled: { graph: number; vector: number };
  escalationsCreated: number;
  modelCallsUsed: number;
  failures: Array<{ workId?: string; kind: string; reason: string }>;
  degradations: Array<{ capability: string; reason: string }>;
}

const DEFAULT_LIMITS: KnowledgeBackgroundLimits = {
  maxItems: 20,
  maxProposalsPerExperience: 8,
  maxRetries: 3,
  retryDelayMs: 60_000,
  maxLineageDepth: 8,
  maxContradictionInspections: 20,
  maxProjectionItems: 100,
  maxModelCalls: 0,
};

function limits(input?: Partial<KnowledgeBackgroundLimits>): KnowledgeBackgroundLimits {
  const bounded = (value: number | undefined, fallback: number, max: number, min = 0) =>
    Math.min(Math.max(Math.floor(value ?? fallback), min), max);
  return {
    maxItems: bounded(input?.maxItems, DEFAULT_LIMITS.maxItems, 1_000, 1),
    maxProposalsPerExperience: bounded(input?.maxProposalsPerExperience, DEFAULT_LIMITS.maxProposalsPerExperience, 50, 1),
    maxRetries: bounded(input?.maxRetries, DEFAULT_LIMITS.maxRetries, 20, 1),
    retryDelayMs: bounded(input?.retryDelayMs, DEFAULT_LIMITS.retryDelayMs, 86_400_000),
    maxLineageDepth: bounded(input?.maxLineageDepth, DEFAULT_LIMITS.maxLineageDepth, 20, 1),
    maxContradictionInspections: bounded(input?.maxContradictionInspections, DEFAULT_LIMITS.maxContradictionInspections, 100, 1),
    maxProjectionItems: bounded(input?.maxProjectionItems, DEFAULT_LIMITS.maxProjectionItems, 1_000, 1),
    maxModelCalls: bounded(input?.maxModelCalls, DEFAULT_LIMITS.maxModelCalls, 10),
  };
}

function emptyResult(): KnowledgeBackgroundPassResult {
  return {
    itemsInspected: 0,
    itemsCompleted: 0,
    itemsUnchanged: 0,
    retriesScheduled: 0,
    proposalsCreated: 0,
    gapsResolved: 0,
    contradictionsSurfaced: 0,
    projectionsReconciled: { graph: 0, vector: 0 },
    escalationsCreated: 0,
    modelCallsUsed: 0,
    failures: [],
    degradations: [],
  };
}

function sourceType(value?: string): "conversation" | "file" | "project" | "manual" {
  const normalized = value?.toLowerCase();
  if (normalized === "file") return "file";
  if (normalized === "project") return "project";
  if (["chat", "voice", "conversation"].includes(normalized ?? "")) return "conversation";
  return "manual";
}

async function consolidateExperience(input: {
  work: KnowledgeBackgroundWork;
  store: CanonicalKnowledgeRepository;
  experiences: BackgroundExperienceSource;
  persistence: BackgroundWorkPersistence;
  limits: KnowledgeBackgroundLimits;
  result: KnowledgeBackgroundPassResult;
}): Promise<void> {
  const experienceId = input.work.sourceExperienceId;
  if (!experienceId) throw new Error("semantic consolidation work has no source experience ID");
  if (await input.persistence.hasSemanticProposalsForExperience(experienceId)) {
    await input.persistence.complete(input.work.id, { outcome: "already_consolidated" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  const experience = await input.experiences.getExperience(experienceId);
  if (!experience) throw new Error(`durable experience ${experienceId} is unavailable`);
  if (!experience.content?.trim()) {
    if (experience.payloadRef) throw new Error(`experience ${experienceId} requires external payload inspection`);
    await input.persistence.complete(input.work.id, { outcome: "empty_source" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  if (isLowSubstanceUserMessage(experience.content, 20)) {
    await input.persistence.complete(input.work.id, { outcome: "low_substance" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  const extraction = conversationHeuristicExtract(experience.content);
  const proposalItems = rankAndCapItems(
    extractionToProposalItems(extraction),
    input.limits.maxProposalsPerExperience
  );
  if (!proposalItems.length) {
    await input.persistence.complete(input.work.id, { outcome: "no_conservative_extract" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  const eventId = await input.persistence.ensureEvent({
    work: input.work,
    sourceType: sourceType(experience.source?.type),
    sourceExperienceIds: [experience.id],
    transformation: {
      method: "background_heuristic_consolidation",
      representationScope: "bounded semantic proposals from one durable experience",
      informationLoss: {
        occurred: true,
        description: "Only conservative concepts, claims, and relations selected by the bounded heuristic are retained.",
      },
    },
  });
  const existing = await input.store.listProposals({ eventId, limit: 1_000 });
  const proposals = existing.length
    ? existing
    : await input.store.addProposals(eventId, proposalItems);
  await input.persistence.complete(input.work.id, {
    outcome: "proposals_created",
    eventId,
    proposalIds: proposals.map((proposal) => proposal.id),
  });
  input.result.itemsCompleted++;
  input.result.proposalsCreated += existing.length ? 0 : proposals.length;
}

async function retryRepresentationGap(input: {
  work: KnowledgeBackgroundWork;
  store: CanonicalKnowledgeRepository;
  persistence: BackgroundWorkPersistence;
  result: KnowledgeBackgroundPassResult;
}): Promise<void> {
  if (!input.work.targetProposalId) throw new Error("representation retry has no target proposal");
  const proposal = await input.store.getProposal(input.work.targetProposalId);
  if (!proposal || proposal.status !== "pending") {
    await input.persistence.complete(input.work.id, { outcome: proposal ? `gap_${proposal.status}` : "gap_missing" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  const gap = proposalToRepresentationGap(proposal);
  if (!gap) throw new Error(`proposal ${proposal.id} is not a representation gap`);
  const canonical = await input.store.resolveCanonical({ label: gap.unresolved });
  if (!canonical || canonical.status !== "accepted") {
    await input.persistence.wait(input.work.id, { outcome: "still_ambiguous" });
    input.result.itemsUnchanged++;
    return;
  }
  if (gap.candidates.length > 0 && !gap.candidates.some((candidate) => candidate.canonicalId === canonical.id)) {
    await input.persistence.escalate(input.work.id, {
      reason: "strong identity conflicts with preserved candidates",
      candidateIds: gap.candidates.map((candidate) => candidate.canonicalId),
      resolvedCanonicalId: canonical.id,
    });
    input.result.escalationsCreated++;
    return;
  }
  const sourceEvent = await input.store.getEvent(gap.eventId);
  const eventId = await input.persistence.ensureEvent({
    work: input.work,
    sourceType: sourceEvent?.sourceType ?? "manual",
    sourceExperienceIds: sourceEvent?.sourceExperienceIds ?? [],
    transformation: {
      method: "background_representation_retry",
      confidence: 1,
      representationScope: "contextual referent resolution from newly available canonical evidence",
      informationLoss: { occurred: false },
    },
  });
  await input.store.acceptProposal(gap.id, {
    humanClarificationRequired: false,
    resolution: {
      canonicalNodeId: canonical.id,
      method: "canonical_identity",
      confidence: 1,
      resolutionEventId: eventId,
    },
  });
  await input.persistence.complete(input.work.id, {
    outcome: "gap_resolved",
    canonicalNodeId: canonical.id,
    resolutionEventId: eventId,
  });
  input.result.itemsCompleted++;
  input.result.gapsResolved++;
}

async function reconsiderClaims(input: {
  work: KnowledgeBackgroundWork;
  store: CanonicalKnowledgeRepository;
  persistence: BackgroundWorkPersistence;
  limits: KnowledgeBackgroundLimits;
  result: KnowledgeBackgroundPassResult;
}): Promise<void> {
  const affected = new Map<string, KnowledgeNode>();
  if (input.work.sourceEventId) {
    const dependent = await input.store.findDependentClaims({
      sourceEventId: input.work.sourceEventId,
      maxDepth: input.limits.maxLineageDepth,
    });
    for (const item of dependent.slice(0, input.limits.maxContradictionInspections)) {
      affected.set(item.claim.id, item.claim);
    }
  }
  const candidateIds = [
    input.work.targetNodeId,
    typeof input.work.payload.fromNodeId === "string" ? input.work.payload.fromNodeId : undefined,
    typeof input.work.payload.toNodeId === "string" ? input.work.payload.toNodeId : undefined,
  ].filter((id): id is string => Boolean(id));
  for (const id of candidateIds.slice(0, input.limits.maxContradictionInspections)) {
    const node = await input.store.getNode(id);
    if (node?.type === "claim") affected.set(node.id, node);
  }
  if (!affected.size) {
    await input.persistence.complete(input.work.id, { outcome: "no_dependent_claims" });
    input.result.itemsCompleted++;
    input.result.itemsUnchanged++;
    return;
  }
  const affectedClaimIds = [...affected.keys()].slice(0, input.limits.maxContradictionInspections);
  await input.persistence.escalate(input.work.id, {
    reason: "bounded foreground or curator reconsideration required",
    affectedClaimIds,
    inspectionTruncated: affected.size > affectedClaimIds.length,
  });
  input.result.contradictionsSurfaced += affectedClaimIds.length;
  input.result.escalationsCreated++;
}

/**
 * Run one finite knowledge-owned pass and exit. Persistent rows determine all
 * remaining work; this function owns neither a daemon nor a scheduler.
 */
export async function runKnowledgeBackgroundPass(input: {
  pool: Pool;
  canonical: CanonicalKnowledgeRepository;
  experiences: BackgroundExperienceSource;
  graph?: GraphRepository;
  vector?: VectorRepository;
  embedder?: SemanticEmbeddingProvider;
  limits?: Partial<KnowledgeBackgroundLimits>;
  persistence?: BackgroundWorkPersistence;
}): Promise<KnowledgeBackgroundPassResult> {
  const selectedLimits = limits(input.limits);
  const persistence = input.persistence ?? createPostgresBackgroundWorkRepository(input.pool);
  const result = emptyResult();
  const executed = await persistence.withExclusivePass(async () => {
    const work = await persistence.listAvailable(selectedLimits.maxItems);
    for (const item of work) {
      result.itemsInspected++;
      try {
        if (item.kind === "semantic_consolidation") {
          await consolidateExperience({ work: item, store: input.canonical, experiences: input.experiences, persistence, limits: selectedLimits, result });
        } else if (item.kind === "representation_gap_retry") {
          await retryRepresentationGap({ work: item, store: input.canonical, persistence, result });
        } else {
          await reconsiderClaims({ work: item, store: input.canonical, persistence, limits: selectedLimits, result });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const outcome = await persistence.fail({
          id: item.id,
          error: reason,
          maxRetries: selectedLimits.maxRetries,
          retryDelayMs: selectedLimits.retryDelayMs,
        });
        if (outcome === "retry") result.retriesScheduled++;
        else result.escalationsCreated++;
        result.failures.push({ workId: item.id, kind: item.kind, reason });
      }
    }

    if (input.graph) {
      try {
        const graph = await processGraphProjectionOutbox({
          pool: input.pool,
          canonical: input.canonical,
          graph: input.graph,
          limit: selectedLimits.maxProjectionItems,
        });
        result.projectionsReconciled.graph += graph.processed;
        if (graph.failed) {
          const reason = `${graph.failed} projection job(s) failed and remain retryable`;
          result.failures.push({ kind: "graph_projection", reason });
          result.degradations.push({ capability: "graph_projection", reason });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failures.push({ kind: "graph_projection", reason });
        result.degradations.push({ capability: "graph_projection", reason });
      }
    }
    if (input.vector && input.embedder) {
      try {
        const vector = await processVectorProjectionOutbox({
          pool: input.pool,
          canonical: input.canonical,
          vector: input.vector,
          embedder: input.embedder,
          limit: selectedLimits.maxProjectionItems,
        });
        result.projectionsReconciled.vector += vector.processed;
        if (vector.failed) {
          const reason = `${vector.failed} projection job(s) failed and remain retryable`;
          result.failures.push({ kind: "vector_projection", reason });
          result.degradations.push({ capability: "vector_projection", reason });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        result.failures.push({ kind: "vector_projection", reason });
        result.degradations.push({ capability: "vector_projection", reason });
      }
    } else if (input.vector || input.embedder) {
      result.degradations.push({ capability: "vector_projection", reason: "vector repository and embedder must be supplied together" });
    }
    return result;
  });
  if (executed == null) {
    result.degradations.push({ capability: "background_pass", reason: "another finite pass currently owns the knowledge lock" });
  }
  return executed ?? result;
}

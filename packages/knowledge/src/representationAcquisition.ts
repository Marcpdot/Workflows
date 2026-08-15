import type {
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";
import { normalizeLabel } from "./identity.js";

export type RepresentationGapKind =
  | "identity"
  | "referent"
  | "unit"
  | "meaning"
  | "source"
  | "context";

export type RepresentationResolutionMethod =
  | "source_metadata"
  | "canonical_identity"
  | "world_model_context"
  | "tool_inspection"
  | "bounded_inference"
  | "human_clarification"
  | "prior_clarification";

export interface RepresentationCandidate {
  canonicalId: string;
  label: string;
  type: KnowledgeNodeType;
  description?: string;
  reason: "exact_label" | "structured_candidate" | "semantic_candidate";
  confidence?: number;
}

export interface RepresentationResolution {
  canonicalNodeId: string;
  method: RepresentationResolutionMethod;
  confidence: number;
  resolutionEventId?: string;
  clarificationExperienceId?: string;
  toolExperienceIds?: string[];
}

export interface RepresentationGap {
  id: string;
  eventId: string;
  unresolved: string;
  kind: RepresentationGapKind;
  candidates: RepresentationCandidate[];
  confidence?: number;
  ambiguity?: string;
  humanClarificationRequired: boolean;
  status: "unresolved" | "resolved" | "obsolete";
  sessionId?: string;
  contextKey: string;
  resolution?: RepresentationResolution;
  createdAt: number;
  resolvedAt?: number;
}

/** Structured source/caller facts. Similarity candidates remain candidates only. */
export interface RepresentationSourceMetadata {
  canonicalId?: string;
  stableIdentifier?: string;
  referentLabel?: string;
  identityType?: KnowledgeNodeType;
  contextCanonicalIds?: string[];
  contextKey?: string;
  contextTerms?: string[];
  sourceType?: string;
  sourceRef?: string;
  candidateCanonicalIds?: string[];
  candidateSignal?: "structured" | "semantic";
}

export interface RepresentationInspectionResult {
  metadata?: RepresentationSourceMetadata;
  sourceExperienceIds?: string[];
}

export interface RepresentationAcquisitionResult {
  status: "not_applicable" | "resolved" | "needs_clarification";
  gap?: RepresentationGap;
  canonical?: KnowledgeNode;
  method?: RepresentationResolutionMethod;
  question?: string;
  sourceEventId?: string;
  sourceExperienceIds: string[];
}

const UNIQUE = <T>(values: readonly T[]) => [...new Set(values)];

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? UNIQUE(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function proposalStatus(status: KnowledgeProposal["status"]): RepresentationGap["status"] {
  return status === "pending" ? "unresolved" : status === "accepted" ? "resolved" : "obsolete";
}

function candidate(value: unknown): RepresentationCandidate | null {
  const item = record(value);
  const canonicalId = typeof item.canonicalId === "string" ? item.canonicalId : "";
  const label = typeof item.label === "string" ? item.label : "";
  const type = typeof item.type === "string" ? item.type as KnowledgeNodeType : "concept";
  const reason = item.reason;
  if (!canonicalId || !label || !["exact_label", "structured_candidate", "semantic_candidate"].includes(String(reason))) {
    return null;
  }
  return {
    canonicalId,
    label,
    type,
    description: typeof item.description === "string" ? item.description : undefined,
    reason: reason as RepresentationCandidate["reason"],
    confidence: item.confidence == null ? undefined : Number(item.confidence),
  };
}

export function proposalToRepresentationGap(
  proposal: KnowledgeProposal
): RepresentationGap | null {
  if (proposal.kind !== "representation_gap") return null;
  const payload = proposal.payload;
  const resolutionValue = record(payload.resolution);
  const canonicalNodeId = typeof resolutionValue.canonicalNodeId === "string"
    ? resolutionValue.canonicalNodeId
    : "";
  const method = resolutionValue.method;
  const resolution = canonicalNodeId && typeof method === "string"
    ? {
        canonicalNodeId,
        method: method as RepresentationResolutionMethod,
        confidence: Number(resolutionValue.confidence ?? 0),
        resolutionEventId:
          typeof resolutionValue.resolutionEventId === "string"
            ? resolutionValue.resolutionEventId
            : undefined,
        clarificationExperienceId:
          typeof resolutionValue.clarificationExperienceId === "string"
            ? resolutionValue.clarificationExperienceId
            : undefined,
        toolExperienceIds: strings(resolutionValue.toolExperienceIds),
      }
    : undefined;
  return {
    id: proposal.id,
    eventId: proposal.eventId,
    unresolved: String(payload.unresolved ?? ""),
    kind: String(payload.uncertaintyKind ?? "referent") as RepresentationGapKind,
    candidates: Array.isArray(payload.candidates)
      ? payload.candidates.map(candidate).filter((item): item is RepresentationCandidate => item != null)
      : [],
    confidence: payload.confidence == null ? undefined : Number(payload.confidence),
    ambiguity: typeof payload.ambiguity === "string" ? payload.ambiguity : undefined,
    humanClarificationRequired: payload.humanClarificationRequired !== false,
    status: proposalStatus(proposal.status),
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    contextKey: String(payload.contextKey ?? ""),
    resolution,
    createdAt: proposal.createdAt,
    resolvedAt: proposal.resolvedAt,
  };
}

/** Small deterministic signal; it does not infer identity. */
export function detectPotentialReferentLabel(text: string): string | null {
  const matches = [...text.matchAll(/\b([A-Z][\p{L}\d_-]*(?:\s+[A-Z\d][\p{L}\d_-]*){1,3})\b/gu)];
  return matches.length === 1 ? matches[0]![1]!.trim() : null;
}

export function hasRepresentationAcquisitionSignal(
  text: string,
  metadata?: RepresentationSourceMetadata
): boolean {
  return Boolean(
    metadata?.canonicalId ||
    metadata?.stableIdentifier ||
    metadata?.referentLabel ||
    metadata?.candidateCanonicalIds?.length ||
    detectPotentialReferentLabel(text)
  );
}

function contextKey(
  unresolved: string,
  metadata: RepresentationSourceMetadata,
  workspaceId?: string
): string {
  if (metadata.contextKey?.trim()) return metadata.contextKey.trim();
  return [
    `workspace:${workspaceId ?? "none"}`,
    `source:${metadata.sourceType?.trim() || "unknown"}`,
    `referent:${normalizeLabel(unresolved)}`,
  ].join("|");
}

function sourceType(value?: string): "conversation" | "file" | "project" | "manual" {
  const normalized = value?.toLowerCase();
  if (normalized === "file") return "file";
  if (normalized === "project") return "project";
  if (["chat", "voice", "conversation"].includes(normalized ?? "")) return "conversation";
  return "manual";
}

async function nodesForIds(
  store: KnowledgeStore,
  ids: readonly string[],
  reason: RepresentationCandidate["reason"]
): Promise<RepresentationCandidate[]> {
  const output: RepresentationCandidate[] = [];
  for (const id of UNIQUE(ids).slice(0, 20)) {
    const node = await store.getNode(id);
    if (!node || node.status !== "accepted") continue;
    output.push({
      canonicalId: node.id,
      label: node.label,
      type: node.type,
      description: node.description,
      reason,
      confidence: reason === "semantic_candidate" ? undefined : 0.8,
    });
  }
  return output;
}

async function exactCandidates(
  store: KnowledgeStore,
  label: string,
  type?: KnowledgeNodeType
): Promise<RepresentationCandidate[]> {
  const normalized = normalizeLabel(label);
  if (!normalized) return [];
  const found = await store.findNodes({
    label,
    type,
    status: "accepted",
    limit: 50,
  });
  return found
    .filter((node) => normalizeLabel(node.label) === normalized)
    .map((node) => ({
      canonicalId: node.id,
      label: node.label,
      type: node.type,
      description: node.description,
      reason: "exact_label" as const,
      confidence: 0.9,
    }));
}

function mergeCandidates(...groups: RepresentationCandidate[][]): RepresentationCandidate[] {
  const byId = new Map<string, RepresentationCandidate>();
  for (const item of groups.flat()) {
    const prior = byId.get(item.canonicalId);
    if (!prior || prior.reason === "semantic_candidate") byId.set(item.canonicalId, item);
  }
  return [...byId.values()].slice(0, 20);
}

async function resolveStrongMetadata(
  store: KnowledgeStore,
  metadata: RepresentationSourceMetadata
): Promise<KnowledgeNode | null> {
  if (metadata.canonicalId) {
    const node = await store.getNode(metadata.canonicalId);
    if (node?.status === "accepted") return node;
  }
  if (metadata.stableIdentifier) {
    const node = await store.resolveCanonical({
      label: metadata.stableIdentifier,
      type: metadata.identityType,
    });
    if (node?.status === "accepted") return node;
  }
  return null;
}

async function resolveFromRelations(
  store: KnowledgeStore,
  candidates: RepresentationCandidate[],
  contextCanonicalIds: readonly string[]
): Promise<KnowledgeNode | null> {
  const contextIds = new Set(contextCanonicalIds);
  if (!candidates.length || !contextIds.size) return null;
  const connected: KnowledgeNode[] = [];
  for (const item of candidates.slice(0, 10)) {
    const neighborhood = await store.getNeighborhood(item.canonicalId, {
      hops: 1,
      status: "accepted",
      nodeLimit: 50,
      edgeLimit: 100,
    });
    if (neighborhood.nodes.some((node) => contextIds.has(node.id))) {
      const node = await store.getNode(item.canonicalId);
      if (node) connected.push(node);
    }
  }
  return connected.length === 1 ? connected[0]! : null;
}

function resolveBoundedInference(
  candidates: RepresentationCandidate[],
  contextTerms: readonly string[]
): RepresentationCandidate | null {
  const terms = UNIQUE(contextTerms.map(normalizeLabel).filter((term) => term.length >= 2));
  if (!terms.length) return null;
  const matched = candidates.filter((item) => {
    const text = normalizeLabel(`${item.label} ${item.description ?? ""}`);
    return terms.every((term) => text.includes(term));
  });
  return matched.length === 1 ? matched[0]! : null;
}

async function reusableResolution(
  store: KnowledgeStore,
  unresolved: string,
  key: string
): Promise<RepresentationGap | null> {
  const proposals = await store.listProposals({
    status: "accepted",
    kind: "representation_gap",
    newestFirst: true,
    limit: 100,
  });
  const matching = proposals
    .map(proposalToRepresentationGap)
    .filter((gap): gap is RepresentationGap =>
      gap != null &&
      gap.contextKey === key &&
      normalizeLabel(gap.unresolved) === normalizeLabel(unresolved) &&
      gap.resolution != null
    );
  const targets = UNIQUE(matching.map((gap) => gap.resolution!.canonicalNodeId));
  return targets.length === 1 ? matching[0]! : null;
}

function candidatePhrase(item: RepresentationCandidate, duplicateLabel: boolean): string {
  if (item.description?.trim()) return `${item.label} (${item.description.trim()})`;
  return duplicateLabel ? `${item.label} with the separately recorded identity` : item.label;
}

export function clarificationQuestion(gap: Pick<RepresentationGap, "unresolved" | "candidates">): string {
  if (!gap.candidates.length) {
    return `What does “${gap.unresolved}” refer to in this context?`;
  }
  const labels = gap.candidates.map((item) => normalizeLabel(item.label));
  const duplicateLabel = new Set(labels).size !== labels.length;
  const choices = gap.candidates.slice(0, 3).map((item) => candidatePhrase(item, duplicateLabel));
  if (choices.length === 1) {
    return `Do you mean ${choices[0]}?`;
  }
  return `Do you mean ${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}?`;
}

async function persistGap(input: {
  store: KnowledgeStore;
  unresolved: string;
  kind: RepresentationGapKind;
  candidates: RepresentationCandidate[];
  confidence?: number;
  ambiguity?: string;
  sessionId?: string;
  workspaceId?: string;
  metadata: RepresentationSourceMetadata;
  sourceExperienceIds: string[];
  resolution?: Omit<RepresentationResolution, "resolutionEventId">;
}): Promise<RepresentationGap> {
  const event = await input.store.createEvent({
    sourceType: sourceType(input.metadata.sourceType),
    sourceRef:
      input.metadata.sourceRef?.trim() ||
      `representation:${input.sessionId ?? "unscoped"}:${input.sourceExperienceIds[0] ?? "no-experience"}`,
    sourceExperienceIds: input.sourceExperienceIds,
    transformation: {
      method: "representation_acquisition",
      confidence: input.resolution?.confidence ?? input.confidence,
      representationScope: "contextual referent resolution",
      informationLoss: { occurred: false },
    },
  });
  const payload: Record<string, unknown> = {
    unresolved: input.unresolved,
    normalizedUnresolved: normalizeLabel(input.unresolved),
    uncertaintyKind: input.kind,
    candidates: input.candidates,
    confidence: input.confidence,
    ambiguity: input.ambiguity,
    humanClarificationRequired: input.resolution == null,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    contextKey: contextKey(input.unresolved, input.metadata, input.workspaceId),
  };
  const proposal = (await input.store.addProposals(event.id, [{
    kind: "representation_gap",
    payload,
  }]))[0]!;
  if (input.resolution) {
    await input.store.acceptProposal(proposal.id, {
      humanClarificationRequired: false,
      resolution: {
        ...input.resolution,
        resolutionEventId: event.id,
      },
    });
    const accepted = (await input.store.listProposals({
      status: "accepted",
      kind: "representation_gap",
      newestFirst: true,
      limit: 100,
    })).find((item) => item.id === proposal.id);
    return proposalToRepresentationGap(accepted!)!;
  }
  return proposalToRepresentationGap(proposal)!;
}

export async function acquireRepresentation(input: {
  store: KnowledgeStore;
  content: string;
  sourceExperienceId: string;
  sessionId?: string;
  workspaceId?: string;
  metadata?: RepresentationSourceMetadata;
  inspect?: () => Promise<RepresentationInspectionResult>;
}): Promise<RepresentationAcquisitionResult> {
  let metadata: RepresentationSourceMetadata = { ...(input.metadata ?? {}) };
  const detected = detectPotentialReferentLabel(input.content);
  const unresolved =
    metadata.referentLabel?.trim() ||
    detected ||
    metadata.stableIdentifier?.trim() ||
    "";
  if (!unresolved && !metadata.canonicalId) {
    return { status: "not_applicable", sourceExperienceIds: [input.sourceExperienceId] };
  }
  const key = contextKey(unresolved, metadata, input.workspaceId);
  const sourceExperienceIds = [input.sourceExperienceId];

  let resolved = await resolveStrongMetadata(input.store, metadata);
  if (resolved) {
    const gap = await persistGap({
      store: input.store,
      unresolved: unresolved || resolved.label,
      kind: "identity",
      candidates: [{
        canonicalId: resolved.id,
        label: resolved.label,
        type: resolved.type,
        description: resolved.description,
        reason: "structured_candidate",
        confidence: 1,
      }],
      confidence: 1,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      metadata,
      sourceExperienceIds,
      resolution: {
        canonicalNodeId: resolved.id,
        method: "source_metadata",
        confidence: 1,
      },
    });
    return { status: "resolved", gap, canonical: resolved, method: "source_metadata", sourceEventId: gap.eventId, sourceExperienceIds };
  }

  const candidateReason = metadata.candidateSignal === "semantic"
    ? "semantic_candidate"
    : "structured_candidate";
  let candidates = mergeCandidates(
    unresolved ? await exactCandidates(input.store, unresolved, metadata.identityType) : [],
    await nodesForIds(input.store, metadata.candidateCanonicalIds ?? [], candidateReason)
  );

  if (unresolved) {
    const prior = await reusableResolution(input.store, unresolved, key);
    if (prior?.resolution) {
      const canonical = await input.store.getNode(prior.resolution.canonicalNodeId);
      const remainsPlausible =
        candidates.length === 0 ||
        candidates.some((item) => item.canonicalId === canonical?.id);
      if (canonical?.status === "accepted" && remainsPlausible) {
        return {
          status: "resolved",
          gap: prior,
          canonical,
          method: "prior_clarification",
          sourceEventId: prior.resolution.resolutionEventId ?? prior.eventId,
          sourceExperienceIds,
        };
      }
    }
  }

  const exactOnly = candidates.filter((item) => item.reason === "exact_label");
  if (exactOnly.length === 1 && candidates.length === 1) {
    const canonical = await input.store.getNode(exactOnly[0]!.canonicalId);
    return {
      status: "resolved",
      canonical: canonical ?? undefined,
      method: "canonical_identity",
      sourceExperienceIds,
    };
  }

  resolved = await resolveFromRelations(
    input.store,
    candidates,
    metadata.contextCanonicalIds ?? []
  );
  if (resolved) {
    const gap = await persistGap({
      store: input.store,
      unresolved,
      kind: "context",
      candidates,
      confidence: 0.95,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      metadata,
      sourceExperienceIds,
      resolution: {
        canonicalNodeId: resolved.id,
        method: "world_model_context",
        confidence: 0.95,
      },
    });
    return { status: "resolved", gap, canonical: resolved, method: "world_model_context", sourceEventId: gap.eventId, sourceExperienceIds };
  }

  if (input.inspect) {
    const inspection = await input.inspect();
    sourceExperienceIds.push(...(inspection.sourceExperienceIds ?? []));
    metadata = { ...metadata, ...(inspection.metadata ?? {}) };
    resolved = await resolveStrongMetadata(input.store, metadata);
    if (resolved) {
      const gap = await persistGap({
        store: input.store,
        unresolved: unresolved || resolved.label,
        kind: "identity",
        candidates: mergeCandidates(candidates, [{
          canonicalId: resolved.id,
          label: resolved.label,
          type: resolved.type,
          description: resolved.description,
          reason: "structured_candidate",
          confidence: 1,
        }]),
        confidence: 1,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        metadata,
        sourceExperienceIds: UNIQUE(sourceExperienceIds),
        resolution: {
          canonicalNodeId: resolved.id,
          method: "tool_inspection",
          confidence: 1,
          toolExperienceIds: sourceExperienceIds.slice(1),
        },
      });
      return { status: "resolved", gap, canonical: resolved, method: "tool_inspection", sourceEventId: gap.eventId, sourceExperienceIds: UNIQUE(sourceExperienceIds) };
    }
    candidates = mergeCandidates(
      candidates,
      metadata.referentLabel
        ? await exactCandidates(input.store, metadata.referentLabel, metadata.identityType)
        : [],
      await nodesForIds(input.store, metadata.candidateCanonicalIds ?? [], metadata.candidateSignal === "semantic" ? "semantic_candidate" : "structured_candidate")
    );
  }

  const inferred = resolveBoundedInference(candidates, metadata.contextTerms ?? []);
  if (inferred) {
    const canonical = await input.store.getNode(inferred.canonicalId);
    if (canonical) {
      const gap = await persistGap({
        store: input.store,
        unresolved,
        kind: "context",
        candidates,
        confidence: 0.7,
        ambiguity: "bounded contextual inference; canonical identity was not merged or aliased",
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        metadata,
        sourceExperienceIds: UNIQUE(sourceExperienceIds),
        resolution: {
          canonicalNodeId: canonical.id,
          method: "bounded_inference",
          confidence: 0.7,
          toolExperienceIds: sourceExperienceIds.slice(1),
        },
      });
      return { status: "resolved", gap, canonical, method: "bounded_inference", sourceEventId: gap.eventId, sourceExperienceIds: UNIQUE(sourceExperienceIds) };
    }
  }

  // An unstructured new label can continue through normal proposal capture. A
  // gap is material only when structured metadata requests resolution or more
  // than one canonical candidate remains plausible.
  const material = Boolean(input.metadata) || candidates.length > 1;
  if (!material) {
    return { status: "not_applicable", sourceExperienceIds: UNIQUE(sourceExperienceIds) };
  }
  const gap = await persistGap({
    store: input.store,
    unresolved: unresolved || "the supplied referent",
    kind: "identity",
    candidates,
    confidence: candidates.length === 1 && candidates[0]?.reason === "semantic_candidate" ? undefined : 0,
    ambiguity:
      candidates.length > 1
        ? `${candidates.length} canonical candidates remain plausible`
        : "no strong canonical identifier or alias resolved the referent",
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    metadata,
    sourceExperienceIds: UNIQUE(sourceExperienceIds),
  });
  return {
    status: "needs_clarification",
    gap,
    question: clarificationQuestion(gap),
    sourceEventId: gap.eventId,
    sourceExperienceIds: UNIQUE(sourceExperienceIds),
  };
}

export async function findPendingRepresentationGap(
  store: KnowledgeStore,
  input: { sessionId?: string; gapId?: string }
): Promise<RepresentationGap | null> {
  if (!input.sessionId && !input.gapId) return null;
  const proposals = await store.listProposals({
    status: "pending",
    kind: "representation_gap",
    newestFirst: true,
    limit: 50,
  });
  for (const proposal of proposals) {
    if (input.gapId && proposal.id !== input.gapId) continue;
    const gap = proposalToRepresentationGap(proposal);
    if (!gap) continue;
    if (input.sessionId && gap.sessionId !== input.sessionId) continue;
    return gap;
  }
  return null;
}

function clarificationCandidate(
  gap: RepresentationGap,
  answer: string,
  canonicalId?: string
): RepresentationCandidate | null {
  if (canonicalId) {
    return gap.candidates.find((item) => item.canonicalId === canonicalId) ?? null;
  }
  const normalized = normalizeLabel(answer);
  const labelCounts = new Map<string, number>();
  for (const item of gap.candidates) {
    const key = normalizeLabel(item.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }
  const scored = gap.candidates.map((item) => {
    const label = normalizeLabel(item.label);
    const description = normalizeLabel(item.description ?? "");
    let score = 0;
    if (label && labelCounts.get(label) === 1 && normalized.includes(label)) score += 10;
    if (description && normalized.includes(description)) score += 20;
    const distinctive = description.split(/[^\p{L}\d]+/u).filter((token) => token.length >= 3 || /\d/.test(token));
    score += distinctive.filter((token) => normalized.includes(token)).length;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score <= 0 || scored[0].score === scored[1]?.score) return null;
  return scored[0].item;
}

export async function resolveRepresentationClarification(input: {
  store: KnowledgeStore;
  gap: RepresentationGap;
  answer: string;
  clarificationExperienceId: string;
  canonicalId?: string;
  sourceType?: string;
}): Promise<RepresentationAcquisitionResult> {
  let selected = clarificationCandidate(input.gap, input.answer, input.canonicalId);
  if (!selected && input.canonicalId && input.gap.candidates.length === 0) {
    const node = await input.store.getNode(input.canonicalId);
    if (node?.status === "accepted") {
      selected = {
        canonicalId: node.id,
        label: node.label,
        type: node.type,
        description: node.description,
        reason: "structured_candidate",
        confidence: 1,
      };
    }
  }
  if (!selected) {
    return {
      status: "needs_clarification",
      gap: input.gap,
      question: clarificationQuestion(input.gap),
      sourceExperienceIds: [input.clarificationExperienceId],
    };
  }
  const canonical = await input.store.getNode(selected.canonicalId);
  if (!canonical || canonical.status !== "accepted") {
    throw new Error("clarification selected an unavailable canonical identity");
  }
  const event = await input.store.createEvent({
    sourceType: sourceType(input.sourceType),
    sourceRef: `representation-clarification:${input.gap.id}`,
    sourceExperienceIds: [input.clarificationExperienceId],
    transformation: {
      method: "human_clarification",
      confidence: 1,
      representationScope: "contextual referent resolution",
      informationLoss: { occurred: false },
    },
  });
  await input.store.acceptProposal(input.gap.id, {
    humanClarificationRequired: false,
    resolution: {
      canonicalNodeId: canonical.id,
      method: "human_clarification",
      confidence: 1,
      resolutionEventId: event.id,
      clarificationExperienceId: input.clarificationExperienceId,
    } satisfies RepresentationResolution,
  });
  const accepted = (await input.store.listProposals({
    status: "accepted",
    kind: "representation_gap",
    newestFirst: true,
    limit: 100,
  })).find((item) => item.id === input.gap.id);
  const gap = proposalToRepresentationGap(accepted!)!;
  return {
    status: "resolved",
    gap,
    canonical,
    method: "human_clarification",
    sourceEventId: event.id,
    sourceExperienceIds: [input.clarificationExperienceId],
  };
}

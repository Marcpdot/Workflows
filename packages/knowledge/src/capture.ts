/**
 * Continuous / explicit conversation capture → pending proposals only.
 * Conversation-optimised extract, conservative identity handling and ranking.
 */

import {
  conversationHeuristicExtract,
  isLowSubstanceUserMessage,
  rankAndCapItems,
} from "./conversationExtract.js";
import { extractionToProposalItems } from "./extract.js";
import { formatChatSegment } from "./ingest.js";
import { normalizeLabel } from "./identity.js";
import { hashInput } from "./knowledge.js";
import {
  extractStructuredConversation,
  normalizeStructuredCapture,
} from "./structuredCapture.js";
import type {
  KnowledgeEvent,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";

export interface KnowledgeProposalSummary {
  id: string;
  kind: KnowledgeProposal["kind"];
  label: string;
  relation?: string;
  confidence?: number;
  sourceRef?: string;
  createdAt: number;
  /** limitKind property when present on claim/concept description */
  limitKind?: string;
}

export interface CaptureConversationInput {
  store: KnowledgeStore;
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  force?: boolean;
  minUserMessageLength?: number;
  maxProposalsPerTurn?: number;
  maxMessages?: number;
  workspaceId?: string | null;
  projectLabel?: string;
  /** Optional turn id for provenance */
  turnId?: string;
  /** Exact durable source experiences represented by this conversation segment. */
  experienceIds?: string[];
  /**
   * Rate-limit: skip auto-capture if last extract was this many ms ago (unless force).
   * Default 0 = no time backoff (substance heuristic still applies).
   */
  minIntervalMs?: number;
  lastExtractAt?: number;
  /** Primary quality path. Omit to use degraded heuristic extraction. */
  complete?: (messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>) => Promise<string>;
  /** Persist the exact extraction-model output before proposals use it. */
  onModelOutput?: (output: string) => Promise<string | void>;
  /** Model identifier recorded on the provenance event. */
  model?: string;
}

export interface CaptureConversationResult {
  eventId: string;
  proposals: KnowledgeProposal[];
  summaries: KnowledgeProposalSummary[];
  skippedDuplicateNodes: number;
  droppedQualityItems: number;
  mode: "heuristic" | "model" | "skipped";
  reason?: string;
  sourceRef: string;
  sourceExperienceIds: string[];
}

export function conversationSourceRef(
  sessionId: string,
  turnId?: string,
  experienceIds: string[] = []
): string {
  const base = `conversation:${sessionId}`;
  const parts: string[] = [];
  if (turnId) parts.push(`turn=${encodeURIComponent(turnId)}`);
  for (const id of [...new Set(experienceIds.map((value) => value.trim()))]) {
    if (id) parts.push(`experience=${encodeURIComponent(id)}`);
  }
  return parts.length > 0 ? `${base}#${parts.join("&")}` : base;
}

/** Exact durable experience ids embedded in a conversation source reference. */
export function conversationExperienceIds(sourceRef: string): string[] {
  const fragment = sourceRef.split("#", 2)[1];
  if (!fragment) return [];
  const ids: string[] = [];
  for (const part of fragment.split("&")) {
    const [key, value = ""] = part.split("=", 2);
    if (key === "experience" && value) {
      try {
        ids.push(decodeURIComponent(value));
      } catch {
        // Ignore malformed legacy/external fragments rather than hiding the event.
      }
    }
  }
  return [...new Set(ids)];
}

export function proposalToSummary(
  p: KnowledgeProposal,
  sourceRef?: string
): KnowledgeProposalSummary {
  const payload = p.payload ?? {};
  let label = "";
  let relation: string | undefined;
  let confidence: number | undefined;
  let limitKind: string | undefined;
  if (p.kind === "node") {
    label = String(payload.label ?? payload.type ?? p.id);
    const desc = String(payload.description ?? "");
    const m = desc.match(/limitKind=([a-z]+)/i);
    if (m) limitKind = m[1];
  } else if (p.kind === "edge") {
    const from = String(payload.from ?? payload.fromLabel ?? "?");
    const to = String(payload.to ?? payload.toLabel ?? "?");
    relation = String(payload.relation ?? "about");
    label = `${from} -[${relation}]-> ${to}`;
  } else if (p.kind === "evidence") {
    label = String(payload.targetLabel ?? payload.claimLabel ?? payload.claim ?? "evidence");
  } else if (p.kind === "supersede") {
    label = `${String(payload.newClaimLabel ?? payload.newClaimId ?? "new claim")} supersedes ${String(payload.oldClaimLabel ?? payload.oldClaimId ?? "old claim")}`;
    relation = "supersedes";
  } else {
    label = String(payload.targetLabel ?? payload.targetId ?? "observation");
  }
  if (p.kind === "node") {
    const desc = String(payload.description ?? "");
    const m = desc.match(/limitKind=([a-z]+)/i);
    if (m) limitKind = m[1];
  }
  if (payload.confidence != null && Number.isFinite(Number(payload.confidence))) {
    confidence = Number(payload.confidence);
  }
  return {
    id: p.id,
    kind: p.kind,
    label,
    relation,
    confidence,
    sourceRef,
    createdAt: p.createdAt,
    limitKind,
  };
}

/**
 * List pending proposals whose event sourceRef is for this session.
 * Requires store.getEvent (M11 store).
 */
export async function listPendingForSession(
  store: KnowledgeStore,
  sessionId: string
): Promise<KnowledgeProposalSummary[]> {
  const pending = await store.listProposals({ status: "pending" });
  const prefix = `conversation:${sessionId}`;
  const out: KnowledgeProposalSummary[] = [];
  for (const p of pending) {
    let sourceRef: string | undefined;
    if (typeof store.getEvent === "function") {
      const ev = await store.getEvent(p.eventId);
      sourceRef = ev?.sourceRef;
    } else {
      sourceRef = undefined;
    }
    if (sourceRef && sourceRef.startsWith(prefix)) {
      out.push(proposalToSummary(p, sourceRef));
    }
  }
  // Newest first for the panel
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

async function filterAgainstAcceptedAndPending(
  store: KnowledgeStore,
  items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }>
): Promise<{
  items: typeof items;
  skipped: number;
}> {
  const pending = await store.listProposals({ status: "pending" });
  const pendingCanonicalIds = new Set<string>();
  for (const p of pending) {
    if (p.kind === "node") {
      const canonicalId = String(p.payload.canonicalId ?? "").trim();
      if (canonicalId) pendingCanonicalIds.add(canonicalId);
    }
  }

  const out: typeof items = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind === "node") {
      const label = String(item.payload.label ?? "").trim();
      if (!label) {
        skipped++;
        continue;
      }
      const canonicalId = String(item.payload.canonicalId ?? "").trim();
      if (canonicalId && pendingCanonicalIds.has(canonicalId)) { skipped++; continue; }
      if (canonicalId) pendingCanonicalIds.add(canonicalId);
      out.push(item);
      continue;
    }
    if (item.kind === "edge") {
      const rel = String(item.payload.relation ?? "about").toLowerCase();
      const fromNode = await store.resolveCanonical({
        label: String(item.payload.from ?? ""),
      });
      const toNode = await store.resolveCanonical({
        label: String(item.payload.to ?? ""),
      });
      if (fromNode && toNode) {
        const neighborhood = await store.getNeighborhood(fromNode.id, {
          hops: 1,
          status: "accepted",
        });
        if (
          neighborhood.edges.some(
            (edge) =>
              edge.fromNodeId === fromNode.id &&
              edge.toNodeId === toNode.id &&
              edge.relation.toLowerCase() === rel
          )
        ) {
          skipped++;
          continue;
        }
      }
      out.push(item);
      continue;
    }
    out.push(item);
  }
  return { items: out, skipped };
}

async function filterResolvableEdges(
  store: KnowledgeStore,
  items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }>
): Promise<{ items: typeof items; dropped: number }> {
  const proposedLabels = new Set(
    items
      .filter((item) => item.kind === "node")
      .map((item) => normalizeLabel(String(item.payload.label ?? "")))
      .filter(Boolean)
  );
  const known = new Map<string, boolean>();
  const endpointExists = async (label: string): Promise<boolean> => {
    const key = normalizeLabel(label);
    if (proposedLabels.has(key)) return true;
    if (known.has(key)) return known.get(key)!;
    const node = await store.resolveCanonical({ label });
    const exists = node != null || (await store.findNodes({
      label,
      status: "accepted",
      limit: 2,
    })).length > 0;
    known.set(key, exists);
    return exists;
  };

  const output: typeof items = [];
  let dropped = 0;
  for (const item of items) {
    if (item.kind === "supersede") {
      const oldLabel = String(item.payload.oldClaimLabel ?? "");
      const newLabel = String(item.payload.newClaimLabel ?? "");
      if (!(await endpointExists(oldLabel)) || !(await endpointExists(newLabel))) {
        dropped++;
        continue;
      }
      output.push(item);
      continue;
    }
    if (item.kind !== "edge") {
      output.push(item);
      continue;
    }
    const from = String(item.payload.from ?? "");
    const to = String(item.payload.to ?? "");
    if (!(await endpointExists(from)) || !(await endpointExists(to))) {
      dropped++;
      continue;
    }
    output.push(item);
  }
  return { items: output, dropped };
}

/**
 * Extract pending proposals from a conversation segment.
 * Never accepts. Caps + ranks; dedupes against accepted and pending.
 */
export async function captureConversationSegment(
  input: CaptureConversationInput
): Promise<CaptureConversationResult> {
  const maxProposals =
    input.maxProposalsPerTurn && input.maxProposalsPerTurn > 0
      ? Math.floor(input.maxProposalsPerTurn)
      : 8;
  const minLen =
    input.minUserMessageLength != null && input.minUserMessageLength >= 0
      ? Math.floor(input.minUserMessageLength)
      : 40;

  const sourceExperienceIds = [
    ...new Set((input.experienceIds ?? []).map((value) => value.trim())),
  ].filter(Boolean);
  let sourceRef = conversationSourceRef(
    input.sessionId,
    input.turnId,
    sourceExperienceIds
  );

  if (
    !input.force &&
    input.minIntervalMs &&
    input.minIntervalMs > 0 &&
    input.lastExtractAt &&
    Date.now() - input.lastExtractAt < input.minIntervalMs
  ) {
    return {
      eventId: "",
      proposals: [],
      summaries: [],
      skippedDuplicateNodes: 0,
      droppedQualityItems: 0,
      mode: "skipped",
      reason: `rate-limit: last extract ${Date.now() - input.lastExtractAt}ms ago`,
      sourceRef,
      sourceExperienceIds,
    };
  }

  const lastUser = [...input.messages]
    .reverse()
    .find((m) => m.role === "user");
  const userText = lastUser?.content?.trim() ?? "";
  if (
    !input.force &&
    isLowSubstanceUserMessage(userText, minLen)
  ) {
    return {
      eventId: "",
      proposals: [],
      summaries: [],
      skippedDuplicateNodes: 0,
      droppedQualityItems: 0,
      mode: "skipped",
      reason: `low-substance user message (len=${userText.length})`,
      sourceRef,
      sourceExperienceIds,
    };
  }

  const segment = formatChatSegment(
    input.messages,
    input.maxMessages ?? 12
  );
  if (!segment.trim()) {
    return {
      eventId: "",
      proposals: [],
      summaries: [],
      skippedDuplicateNodes: 0,
      droppedQualityItems: 0,
      mode: "skipped",
      reason: "empty segment",
      sourceRef,
      sourceExperienceIds,
    };
  }

  let mode: "heuristic" | "model" = "heuristic";
  let modelError: string | undefined;
  let droppedQualityItems = 0;
  let extraction;
  if (input.complete) {
    try {
      const structured = await extractStructuredConversation({
        segment,
        complete: input.complete,
      });
      const outputExperienceId = await input.onModelOutput?.(structured.raw);
      if (outputExperienceId && !sourceExperienceIds.includes(outputExperienceId)) {
        sourceExperienceIds.push(outputExperienceId);
        sourceRef = conversationSourceRef(
          input.sessionId,
          input.turnId,
          sourceExperienceIds
        );
      }
      if (structured.ok && structured.extraction) {
        extraction = structured.extraction;
        droppedQualityItems += structured.dropped;
        mode = "model";
      } else {
        modelError = structured.error ?? "structured capture failed";
      }
    } catch (err) {
      modelError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!extraction) {
    const normalized = normalizeStructuredCapture(
      conversationHeuristicExtract(segment)
    );
    extraction = normalized.extraction;
    droppedQualityItems += normalized.dropped;
  }
  let items = extractionToProposalItems(extraction);

  const resolvable = await filterResolvableEdges(input.store, items);
  items = resolvable.items;
  droppedQualityItems += resolvable.dropped;

  if (input.workspaceId !== undefined) {
    items = items.map((item) => {
      if (item.kind !== "node") return item;
      if (item.payload.workspaceId !== undefined) return item;
      return {
        ...item,
        payload: { ...item.payload, workspaceId: input.workspaceId },
      };
    });
  }

  const filtered = await filterAgainstAcceptedAndPending(input.store, items);
  items = rankAndCapItems(filtered.items, maxProposals);

  if (items.length === 0) {
    return {
      eventId: "",
      proposals: [],
      summaries: [],
      skippedDuplicateNodes: filtered.skipped,
      droppedQualityItems,
      mode,
      reason:
        filtered.skipped > 0
          ? "no proposals after extract/dedupe"
          : modelError
            ? `model fallback produced no structural extract: ${modelError}`
            : "no structural extract",
      sourceRef,
      sourceExperienceIds,
    };
  }

  const event = await input.store.createEvent({
    sourceType: "conversation",
    sourceRef,
    sourceContent: sourceExperienceIds.length === 0 ? segment : undefined,
    sourceExperienceIds,
    model: mode === "model" ? input.model ?? "structured-capture" : "conversation-heuristic",
    inputHash: hashInput(segment),
    transformation: {
      method: mode === "model" ? "conversation_structured_extraction" : "conversation_heuristic_extraction",
      model: mode === "model" ? input.model ?? "structured-capture" : "conversation-heuristic",
      representationScope: "durable concepts, claims, relations, assumptions, and evidence",
      informationLoss: {
        occurred: true,
        description: "Process talk, questions, repetition, and source phrasing outside selected graph items are omitted.",
      },
    },
  });
  const proposals = await input.store.addProposals(event.id, items);

  return {
    eventId: event.id,
    proposals,
    summaries: proposals.map((p) => proposalToSummary(p, sourceRef)),
    skippedDuplicateNodes: filtered.skipped,
    droppedQualityItems,
    mode,
    reason: modelError ? `model fallback: ${modelError}` : undefined,
    sourceRef,
    sourceExperienceIds,
  };
}

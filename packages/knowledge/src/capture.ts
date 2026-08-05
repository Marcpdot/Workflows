/**
 * Continuous / explicit conversation capture → pending proposals only.
 * Iteration: conversation-optimised extract, pending+accepted dedupe, ranking.
 */

import {
  conversationHeuristicExtract,
  isLowSubstanceUserMessage,
  rankAndCapItems,
} from "./conversationExtract.js";
import { extractionToProposalItems } from "./extract.js";
import { formatChatSegment } from "./ingest.js";
import { labelsMatch, normalizeLabel } from "./identity.js";
import { hashInput } from "./knowledge.js";
import {
  extractStructuredConversation,
  normalizeStructuredCapture,
} from "./structuredCapture.js";
import type {
  KnowledgeEvent,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";

export interface KnowledgeProposalSummary {
  id: string;
  kind: "node" | "edge" | "evidence";
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
}

export function conversationSourceRef(
  sessionId: string,
  turnId?: string
): string {
  const base = `conversation:${sessionId}`;
  return turnId ? `${base}#turn=${turnId}` : base;
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
  } else {
    label = String(payload.claimLabel ?? payload.claim ?? "evidence");
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
  const pendingNodeKeys = new Set<string>();
  const pendingEdgeKeys = new Set<string>();
  for (const p of pending) {
    if (p.kind === "node") {
      const t = String(p.payload.type ?? "concept");
      const l = normalizeLabel(String(p.payload.label ?? ""));
      if (l) pendingNodeKeys.add(`${t}:${l}`);
    } else if (p.kind === "edge") {
      const from = normalizeLabel(String(p.payload.from ?? ""));
      const to = normalizeLabel(String(p.payload.to ?? ""));
      const rel = String(p.payload.relation ?? "about").toLowerCase();
      pendingEdgeKeys.add(`${from}|${rel}|${to}`);
    }
  }

  const out: typeof items = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind === "node") {
      const type = String(item.payload.type ?? "concept") as KnowledgeNodeType;
      const label = String(item.payload.label ?? "").trim();
      if (!label) {
        skipped++;
        continue;
      }
      const key = `${type}:${normalizeLabel(label)}`;
      if (pendingNodeKeys.has(key)) {
        skipped++;
        continue;
      }
      const canon = await store.resolveCanonical({ label, type });
      if (canon && (canon.type === type || !type)) {
        skipped++;
        continue;
      }
      const hits = await store.findNodes({
        type,
        label,
        status: "accepted",
        limit: 8,
      });
      if (hits.some((n) => n.type === type && labelsMatch(n.label, label))) {
        skipped++;
        continue;
      }
      pendingNodeKeys.add(key);
      out.push(item);
      continue;
    }
    if (item.kind === "edge") {
      const from = normalizeLabel(String(item.payload.from ?? ""));
      const to = normalizeLabel(String(item.payload.to ?? ""));
      const rel = String(item.payload.relation ?? "about").toLowerCase();
      const ek = `${from}|${rel}|${to}`;
      if (pendingEdgeKeys.has(ek)) {
        skipped++;
        continue;
      }
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
      pendingEdgeKeys.add(ek);
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
    const exists = node != null;
    known.set(key, exists);
    return exists;
  };

  const output: typeof items = [];
  let dropped = 0;
  for (const item of items) {
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

  const sourceRef = conversationSourceRef(input.sessionId, input.turnId);

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
    };
  }

  const event = await input.store.createEvent({
    sourceType: "conversation",
    sourceRef,
    model: mode === "model" ? input.model ?? "structured-capture" : "conversation-heuristic",
    inputHash: hashInput(segment),
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
  };
}


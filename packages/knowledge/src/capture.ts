/**
 * Continuous / explicit conversation capture → pending proposals only.
 * Used by interaction-mode design (active session extract + /capture).
 */

import { formatChatSegment, ingestText } from "./ingest.js";
import type {
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
}

export interface CaptureConversationInput {
  store: KnowledgeStore;
  /** Recent messages including current user+assistant when available */
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  /** Force capture even if user message is short */
  force?: boolean;
  minUserMessageLength?: number;
  maxProposalsPerTurn?: number;
  maxMessages?: number;
  workspaceId?: string | null;
  projectLabel?: string;
}

export interface CaptureConversationResult {
  eventId: string;
  proposals: KnowledgeProposal[];
  summaries: KnowledgeProposalSummary[];
  skippedDuplicateNodes: number;
  mode: "heuristic" | "model" | "skipped";
  reason?: string;
  sourceRef: string;
}

export function proposalToSummary(
  p: KnowledgeProposal,
  sourceRef?: string
): KnowledgeProposalSummary {
  const payload = p.payload ?? {};
  let label = "";
  let relation: string | undefined;
  let confidence: number | undefined;
  if (p.kind === "node") {
    label = String(payload.label ?? payload.type ?? p.id);
  } else if (p.kind === "edge") {
    const from = String(payload.from ?? payload.fromLabel ?? "?");
    const to = String(payload.to ?? payload.toLabel ?? "?");
    relation = String(payload.relation ?? "about");
    label = `${from} -[${relation}]-> ${to}`;
  } else {
    label = String(payload.claimLabel ?? payload.claim ?? "evidence");
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
  };
}

/**
 * Extract pending proposals from a conversation segment.
 * Never accepts. Caps proposal count. Light node dedupe via ingest.
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

  const lastUser = [...input.messages]
    .reverse()
    .find((m) => m.role === "user");
  const userText = lastUser?.content?.trim() ?? "";
  if (!input.force && userText.length < minLen) {
    return {
      eventId: "",
      proposals: [],
      summaries: [],
      skippedDuplicateNodes: 0,
      mode: "skipped",
      reason: `user message length ${userText.length} < min ${minLen}`,
      sourceRef: `conversation:${input.sessionId}`,
    };
  }

  const segment = formatChatSegment(
    input.messages,
    input.maxMessages ?? 12
  );
  const sourceRef = `conversation:${input.sessionId}`;
  const ingested = await ingestText(input.store, {
    text: segment,
    sourceType: "conversation",
    sourceRef,
    workspaceId: input.workspaceId,
    projectLabel: input.projectLabel,
    minChars: input.force ? 1 : Math.min(minLen, 20),
    dedupeNodes: true,
  });

  let proposals = ingested.proposals;
  if (proposals.length > maxProposals) {
    // Keep earliest proposals up to cap (still all pending in DB — reject overflow?)
    // Prefer: only add capped set. ingest already wrote all — trim by rejecting extras?
    // Simpler for shell: leave all pending but only return first N as "this turn" summaries.
    // Design: hard cap per turn — reject surplus proposals so queue stays clean.
    const overflow = proposals.slice(maxProposals);
    for (const p of overflow) {
      try {
        await input.store.rejectProposal(p.id);
      } catch {
        /* ignore */
      }
    }
    proposals = proposals.slice(0, maxProposals);
  }

  return {
    eventId: ingested.eventId,
    proposals,
    summaries: proposals.map((p) => proposalToSummary(p, sourceRef)),
    skippedDuplicateNodes: ingested.skippedDuplicateNodes,
    mode: ingested.mode,
    reason: ingested.reason,
    sourceRef,
  };
}

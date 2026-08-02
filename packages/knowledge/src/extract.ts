/**
 * Extraction helpers: structured ExtractionResult → proposal payloads.
 * Optional live-model path uses packages/structured.
 */

import {
  completeStructured,
  parseStructured,
  type JsonSchema,
} from "@workflows/structured";
import type {
  ExtractionResult,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";
import { hashInput } from "./knowledge.js";

export const EXTRACTION_SCHEMA: JsonSchema = {
  type: "object",
  required: ["concepts", "claims", "relations"],
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "relation", "to"],
        properties: {
          from: { type: "string" },
          relation: { type: "string" },
          to: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        required: ["claimLabel", "excerpt", "stance"],
        properties: {
          claimLabel: { type: "string" },
          excerpt: { type: "string" },
          stance: { type: "string" },
        },
      },
    },
  },
};

/** Pure: turn ExtractionResult into proposal items (no DB). */
export function extractionToProposalItems(
  result: ExtractionResult
): Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }> {
  const items: Array<{
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
  }> = [];

  for (const c of result.concepts ?? []) {
    if (!c.label?.trim()) continue;
    items.push({
      kind: "node",
      payload: {
        type: "concept",
        label: c.label.trim(),
        description: c.description,
      },
    });
  }
  for (const c of result.claims ?? []) {
    if (!c.label?.trim()) continue;
    items.push({
      kind: "node",
      payload: {
        type: "claim",
        label: c.label.trim(),
        description: c.description,
        confidence: c.confidence,
      },
    });
  }
  for (const r of result.relations ?? []) {
    if (!r.from?.trim() || !r.to?.trim()) continue;
    items.push({
      kind: "edge",
      payload: {
        from: r.from.trim(),
        to: r.to.trim(),
        relation: r.relation?.trim() || "about",
        confidence: r.confidence,
      },
    });
  }
  for (const e of result.evidence ?? []) {
    if (!e.claimLabel?.trim()) continue;
    items.push({
      kind: "evidence",
      payload: {
        claimLabel: e.claimLabel.trim(),
        excerpt: e.excerpt,
        stance: e.stance ?? "mentions",
      },
    });
  }
  return items;
}

/**
 * Apply a fixed ExtractionResult (fixture path — no live model).
 */
export async function applyExtractionResult(
  store: KnowledgeStore,
  result: ExtractionResult,
  meta: {
    sourceType: "conversation" | "file" | "project" | "manual";
    sourceRef: string;
    model?: string;
    rawText?: string;
  }
): Promise<{ eventId: string; proposals: KnowledgeProposal[] }> {
  const event = await store.createEvent({
    sourceType: meta.sourceType,
    sourceRef: meta.sourceRef,
    model: meta.model,
    inputHash: meta.rawText ? hashInput(meta.rawText) : undefined,
  });
  const items = extractionToProposalItems(result);
  const proposals = await store.addProposals(event.id, items);
  return { eventId: event.id, proposals };
}

/**
 * Live extraction via completeStructured (optional; needs a complete() fn).
 */
export async function runExtraction(options: {
  store: KnowledgeStore;
  text: string;
  sourceType: "conversation" | "file" | "project" | "manual";
  sourceRef: string;
  model?: string;
  complete: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>;
}): Promise<{
  eventId: string;
  proposals: KnowledgeProposal[];
  raw: string;
  ok: boolean;
  error?: string;
}> {
  const structured = await completeStructured<ExtractionResult>({
    complete: options.complete,
    messages: [
      {
        role: "system",
        content:
          "Extract a semantic knowledge graph fragment as JSON only. " +
          'Shape: {"concepts":[{"label","description?"}],"claims":[{"label","description?","confidence?"}],' +
          '"relations":[{"from","relation","to","confidence?"}],' +
          '"evidence":[{"claimLabel","excerpt","stance"}]}. ' +
          "Use short labels. Prefer typed relations: requires, limits, causes, increases, reduces, about.",
      },
      {
        role: "user",
        content: `Extract concepts, claims, and relations from:\n\n${options.text}`,
      },
    ],
    parse: (raw) => parseStructured<ExtractionResult>(raw, EXTRACTION_SCHEMA),
    maxAttempts: 2,
  });

  if (!structured.ok || !structured.value) {
    return {
      eventId: "",
      proposals: [],
      raw: structured.raw,
      ok: false,
      error: structured.error,
    };
  }

  const applied = await applyExtractionResult(
    options.store,
    structured.value,
    {
      sourceType: options.sourceType,
      sourceRef: options.sourceRef,
      model: options.model,
      rawText: options.text,
    }
  );
  return {
    eventId: applied.eventId,
    proposals: applied.proposals,
    raw: structured.raw,
    ok: true,
  };
}

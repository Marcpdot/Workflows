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

function extractedEpistemicStatus(claim: ExtractionResult["claims"][number]): ExtractionResult["claims"][number]["epistemicStatus"] {
  const text = `${claim.label} ${claim.description ?? ""}`;
  if (/\b(assum(?:e|es|ed|ing|ption)|foruts(?:att|etter)|antar)\b/i.test(text)) return "assumed";
  if (/\b(suspect(?:s|ed|ing)?|hypothes(?:is|ize[sd]?|izing)?|maybe|might|may|perhaps|possibly|possible|mistenker|kanskje|muligens|kan hende)\b/i.test(text)) return "hypothesized";
  if (claim.epistemicStatus === "established") return "supported";
  return claim.epistemicStatus ?? "inferred";
}

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
          epistemicStatus: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          uncertainty: { type: "string" },
          derivationMethod: { type: "string" },
          representationScope: { type: "string" },
          informationLoss: {
            type: "object",
            properties: {
              occurred: { type: "boolean" },
              description: { type: "string" },
            },
          },
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
        epistemicStatus: "unknown",
        observationKind: "derived_from",
        derivation: {
          method: "semantic_extraction",
          representationScope: "canonical concept label and description",
          informationLoss: {
            occurred: true,
            description: "Source wording and context are not fully represented by a normalized concept.",
          },
        },
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
        epistemicStatus: extractedEpistemicStatus(c),
        observationKind: "derived_from",
        derivation: {
          method: c.derivationMethod ?? "semantic_extraction",
          assumptions: c.assumptions,
          confidence: c.confidence,
          uncertainty: c.uncertainty,
          representationScope: c.representationScope ?? "canonical claim semantics",
          informationLoss: c.informationLoss ?? {
            occurred: true,
            description: "Source wording and context are not fully represented by a normalized claim.",
          },
        },
      },
    });
  }
  for (const r of result.relations ?? []) {
    if (!r.from?.trim() || !r.to?.trim()) continue;
    if (r.relation?.trim().toLowerCase() === "supersedes") {
      items.push({
        kind: "supersede",
        payload: {
          newClaimLabel: r.from.trim(),
          oldClaimLabel: r.to.trim(),
          markOldDisputed: true,
        },
      });
      continue;
    }
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
    sourceExperienceIds?: string[];
    transformationMethod?: string;
  }
): Promise<{ eventId: string; proposals: KnowledgeProposal[] }> {
  const sourceExperienceIds = [
    ...new Set((meta.sourceExperienceIds ?? []).map((value) => value.trim())),
  ].filter(Boolean);
  const event = await store.createEvent({
    sourceType: meta.sourceType,
    sourceRef: meta.sourceRef,
    sourceContent: sourceExperienceIds.length ? undefined : meta.rawText,
    sourceExperienceIds,
    model: meta.model,
    inputHash: meta.rawText ? hashInput(meta.rawText) : undefined,
    transformation: {
      method: meta.transformationMethod ?? "structured_extraction",
      model: meta.model,
      representationScope: "semantic graph fragment",
      informationLoss: {
        occurred: true,
        description: "Extraction retains selected concepts, claims, relations, and evidence rather than the full source context.",
      },
    },
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
          'Shape: {"concepts":[{"label","description?"}],"claims":[{"label","description?","confidence?","epistemicStatus?","assumptions?","uncertainty?"}],' +
          '"relations":[{"from","relation","to","confidence?"}],' +
          '"evidence":[{"claimLabel","excerpt","stance"}]}. ' +
          "Use short labels. Prefer typed relations: requires, limits, causes, increases, reduces, about. " +
          "Lifecycle acceptance is not epistemic certainty: use observed, supported, inferred, hypothesized, assumed, or unknown; never mark model extraction established.",
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

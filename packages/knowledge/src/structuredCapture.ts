import {
  completeStructured,
  parseStructured,
  type JsonSchema,
} from "@workflows/structured";
import { normalizeLabel } from "./identity.js";
import type { ExtractionResult, KnowledgeRelation } from "./types.js";

const RELATIONS: KnowledgeRelation[] = [
  "requires",
  "limits",
  "causes",
  "increases",
  "reduces",
  "measures",
  "controls",
  "supports",
  "contradicts",
  "used_in",
  "part_of",
  "about",
  "same_as",
  "alias_of",
  "supersedes",
];

const RELATION_ALIASES: Record<string, KnowledgeRelation> = {
  cause: "causes",
  caused_by: "causes",
  creates: "causes",
  generates: "causes",
  produces: "causes",
  constrain: "limits",
  constrains: "limits",
  limited_by: "limits",
  needs: "requires",
  depends_on: "requires",
  raises: "increases",
  lowers: "reduces",
  decreases: "reduces",
  supports_claim: "supports",
  contradicts_claim: "contradicts",
  used_in_project: "used_in",
  partof: "part_of",
  related_to: "about",
};

const QUESTION_START =
  /^(how|what|why|when|where|who|can|could|would|should|is|are|do|does|did|hvordan|hva|hvorfor|når|hvor|kan|kunne|ville|bør|er)\b/i;
const PROCESS_NOISE =
  /^(ok(?:ay)?|thanks?|thank you|yes|no|sure|hi|hello|hei|ja|nei|hmm|right|got it|let'?s continue)[.!]?$/i;
const RELATION_MARKUP = /-\s*\[[^\]]+\]\s*->|->|→/;

export const STRUCTURED_CAPTURE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["concepts", "claims", "relations"],
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          confidence: { type: "number" },
          epistemicStatus: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          uncertainty: { type: "string" },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "relation", "to"],
        properties: {
          from: { type: "string" },
          relation: { type: "string" },
          to: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
    },
    openQuestions: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export interface NormalizedCapture {
  extraction: ExtractionResult;
  dropped: number;
}

function normalizedEpistemicStatus(item: ExtractionResult["claims"][number]): ExtractionResult["claims"][number]["epistemicStatus"] {
  const text = `${item.label} ${item.description ?? ""}`;
  if (/\b(assum(?:e|es|ed|ing|ption)|foruts(?:att|etter)|antar)\b/i.test(text)) return "assumed";
  if (/\b(suspect(?:s|ed|ing)?|hypothes(?:is|ize[sd]?|izing)?|maybe|might|may|perhaps|possibly|possible|mistenker|kanskje|muligens|kan hende)\b/i.test(text)) return "hypothesized";
  const supplied = item.epistemicStatus;
  if (supplied === "established") return "supported";
  if (["observed", "supported", "inferred", "hypothesized", "assumed", "unknown"].includes(String(supplied))) return supplied;
  return "inferred";
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/^(user|assistant|system):\s*/i, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function hasStutter(value: string): boolean {
  const words = value.toLowerCase().split(/\s+/);
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 3) return true;
  }
  return false;
}

function isQuestion(value: string): boolean {
  const text = value.trim();
  return text.endsWith("?") || QUESTION_START.test(text);
}

function validConceptLabel(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 120 &&
    !PROCESS_NOISE.test(value) &&
    !isQuestion(value) &&
    !RELATION_MARKUP.test(value) &&
    !hasStutter(value)
  );
}

function validClaimLabel(value: string): boolean {
  const words = value.split(/\s+/).filter(Boolean);
  return (
    value.length >= 12 &&
    words.length >= 3 &&
    !PROCESS_NOISE.test(value) &&
    !isQuestion(value) &&
    !RELATION_MARKUP.test(value) &&
    !hasStutter(value)
  );
}

function canonicalRelation(value: string): KnowledgeRelation | undefined {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (RELATIONS.includes(key as KnowledgeRelation)) {
    return key as KnowledgeRelation;
  }
  return RELATION_ALIASES[key];
}

/** Pure quality boundary used for both model output and degraded heuristic output. */
export function normalizeStructuredCapture(
  raw: ExtractionResult
): NormalizedCapture {
  let dropped = 0;
  const concepts: ExtractionResult["concepts"] = [];
  const claims: ExtractionResult["claims"] = [];
  const relations: ExtractionResult["relations"] = [];
  const labels = new Set<string>();

  for (const item of raw.concepts ?? []) {
    const label = cleanText(item.label ?? "", 120);
    if (!validConceptLabel(label)) {
      dropped++;
      continue;
    }
    const key = normalizeLabel(label);
    if (labels.has(key)) {
      dropped++;
      continue;
    }
    labels.add(key);
    concepts.push({
      label,
      description: item.description
        ? cleanText(item.description, 500)
        : undefined,
    });
  }

  for (const item of raw.claims ?? []) {
    const label = cleanText(item.label ?? "", 240);
    if (!validClaimLabel(label)) {
      dropped++;
      continue;
    }
    const key = normalizeLabel(label);
    if (labels.has(key)) {
      dropped++;
      continue;
    }
    labels.add(key);
    claims.push({
      label,
      description: item.description
        ? cleanText(item.description, 600)
        : undefined,
      confidence: item.confidence,
      epistemicStatus: normalizedEpistemicStatus(item),
      assumptions: item.assumptions?.map((value) => cleanText(value, 240)).filter(Boolean),
      uncertainty: item.uncertainty ? cleanText(item.uncertainty, 500) : undefined,
    });
  }

  for (const assumption of raw.assumptions ?? []) {
    const label = cleanText(assumption, 240);
    const key = normalizeLabel(label);
    if (!validClaimLabel(label) || labels.has(key)) {
      dropped++;
      continue;
    }
    labels.add(key);
    claims.push({
      label,
      description: "Explicit assumption from source.",
      confidence: 0.6,
      epistemicStatus: "assumed",
      derivationMethod: "assumption_extraction",
    });
  }

  for (const item of raw.relations ?? []) {
    const from = cleanText(item.from ?? "", 120);
    const to = cleanText(item.to ?? "", 120);
    const relation = canonicalRelation(item.relation ?? "");
    if (
      !validConceptLabel(from) ||
      !validConceptLabel(to) ||
      normalizeLabel(from) === normalizeLabel(to) ||
      !relation
    ) {
      dropped++;
      continue;
    }
    relations.push({ from, relation, to, confidence: item.confidence });
  }

  // Open questions are intentionally omitted from default continuous capture.
  dropped += raw.openQuestions?.length ?? 0;
  return { extraction: { concepts, claims, relations }, dropped };
}

export async function extractStructuredConversation(options: {
  segment: string;
  complete: (messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>) => Promise<string>;
}): Promise<{
  ok: boolean;
  extraction?: ExtractionResult;
  dropped: number;
  raw: string;
  error?: string;
}> {
  const result = await completeStructured<ExtractionResult>({
    complete: options.complete,
    messages: [
      {
        role: "system",
        content:
          "Extract durable knowledge from the conversation as strict JSON only. " +
          "Return concepts, declarative claims, and typed relations. Omit greetings, process talk, " +
          "question fragments, repetition, and unsupported inferences. Relation endpoints must be " +
          "clean concept or claim labels. Allowed relations: " +
          `${RELATIONS.join(", ")}. ` +
          'Shape: {"concepts":[{"label":"...","description":"..."}],"claims":' +
          '[{"label":"...","description":"...","confidence":0.0,"epistemicStatus":"inferred","assumptions":["..."],"uncertainty":"..."}],"relations":' +
          '[{"from":"...","relation":"causes","to":"...","confidence":0.0}],' +
          '"assumptions":["..."],"openQuestions":["..."]}. ' +
          "Use limitKind=fundamental|technological|industrial|economic|regulatory in a description " +
          "only when the conversation explicitly supports it. Put explicit assumptions in assumptions " +
          "and questions in openQuestions; questions are not graph proposals. Epistemic status is " +
          "independent of acceptance. Use hypothesized for suspicions/possibilities, assumed for assumptions, " +
          "and inferred for model synthesis; extraction alone must never emit established. " +
          "When the source explicitly corrects an earlier claim, emit the corrected claim and a supersedes " +
          "relation from the corrected claim label to the exact earlier claim label; do not erase either claim.",
      },
      {
        role: "user",
        content: `Extract structured knowledge from this conversation:\n\n${options.segment}`,
      },
    ],
    parse: (raw) =>
      parseStructured<ExtractionResult>(raw, STRUCTURED_CAPTURE_SCHEMA),
    maxAttempts: 2,
    repairHint: "Return only JSON matching the requested schema and canonical relations.",
  });

  if (!result.ok || !result.value) {
    return {
      ok: false,
      dropped: 0,
      raw: result.raw,
      error: result.error,
    };
  }
  const normalized = normalizeStructuredCapture(result.value);
  return {
    ok: true,
    extraction: normalized.extraction,
    dropped: normalized.dropped,
    raw: result.raw,
  };
}

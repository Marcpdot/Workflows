/**
 * Milestone 16 — First-principles analysis workflow on the general knowledge layer.
 * Produces pending proposals only (accept-gate unchanged). Not the sole purpose of knowledge.
 */

import {
  completeStructured,
  parseStructured,
  type JsonSchema,
} from "@workflows/structured";
import { hashInput } from "./knowledge.js";
import { extractionToProposalItems } from "./extract.js";
import type {
  ExtractionResult,
  KnowledgeProposal,
  KnowledgeStore,
} from "./types.js";

/** Ordered analysis steps (template documentation + prompt). */
export const FIRST_PRINCIPLES_STEPS = [
  "Goal / what the system must do",
  "Relevant physical (or domain) laws & invariants",
  "Absolute limits vs contingent limits",
  "Subsystems & bottlenecks",
  "Scaling consequences",
  "Next bottleneck / experiment",
] as const;

export interface FirstPrinciplesResult {
  goal: string;
  laws: Array<{ label: string; description?: string }>;
  limits: Array<{
    label: string;
    kind: "absolute" | "contingent";
    description?: string;
  }>;
  bottlenecks: Array<{ label: string; description?: string }>;
  relations: Array<{ from: string; relation: string; to: string }>;
  nextActions: Array<{ label: string; description?: string }>;
}

export const FIRST_PRINCIPLES_SCHEMA: JsonSchema = {
  type: "object",
  required: ["goal", "laws", "limits", "bottlenecks", "relations", "nextActions"],
  properties: {
    goal: { type: "string" },
    laws: {
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
    limits: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "kind"],
        properties: {
          label: { type: "string" },
          kind: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    bottlenecks: {
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
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "relation", "to"],
        properties: {
          from: { type: "string" },
          relation: { type: "string" },
          to: { type: "string" },
        },
      },
    },
    nextActions: {
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
  },
};

export interface RunFirstPrinciplesInput {
  store: KnowledgeStore;
  topic: string;
  goal?: string;
  /** M13: ensure project + propose used_in edges from key nodes (still proposals/edges only) */
  projectLabel?: string;
  workspaceId?: string | null;
  /** Live model path; omit for offline fixture shell */
  complete?: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ) => Promise<string>;
  model?: string;
  sourceRef?: string;
  /** Inject fixed result (smoke); skips model + fixture heuristic */
  fixture?: FirstPrinciplesResult;
}

export interface RunFirstPrinciplesOutput {
  analysis: FirstPrinciplesResult;
  eventId: string;
  proposals: KnowledgeProposal[];
  mode: "fixture" | "model" | "heuristic";
  projectId?: string;
  sourceRef: string;
}

/**
 * Offline shell analysis for a topic — stable shape, no live model.
 */
export function heuristicFirstPrinciples(
  topic: string,
  goal?: string
): FirstPrinciplesResult {
  const t = topic.trim() || "system";
  const g = goal?.trim() || `Characterize and improve ${t} from first principles`;
  const law = `conservation / invariants for ${t}`;
  const abs = `absolute limit of ${t}`;
  const cont = `contingent limit of ${t}`;
  const bottleneck = `primary bottleneck in ${t}`;
  const scale = `scaling of ${t}`;
  const next = `measure ${bottleneck}`;

  return {
    goal: g,
    laws: [
      {
        label: law,
        description: `Domain laws and invariants that constrain ${t}`,
      },
    ],
    limits: [
      {
        label: abs,
        kind: "absolute",
        description: "Cannot be violated without changing physics/domain axioms",
      },
      {
        label: cont,
        kind: "contingent",
        description: "Depends on current design, materials, or process choices",
      },
    ],
    bottlenecks: [
      {
        label: bottleneck,
        description: `Dominant constraint on performance of ${t}`,
      },
      {
        label: scale,
        description: "How the bottleneck behaves when the system is scaled",
      },
    ],
    relations: [
      { from: law, relation: "requires", to: t },
      { from: abs, relation: "limits", to: t },
      { from: cont, relation: "limits", to: t },
      { from: bottleneck, relation: "limits", to: t },
      { from: bottleneck, relation: "causes", to: cont },
      { from: scale, relation: "increases", to: bottleneck },
      { from: next, relation: "about", to: bottleneck },
    ],
    nextActions: [
      {
        label: next,
        description: "Next experiment or measurement to test the bottleneck hypothesis",
      },
    ],
  };
}

/** Map FP analysis → ExtractionResult (concepts/claims/edges). */
export function firstPrinciplesToExtraction(
  analysis: FirstPrinciplesResult,
  topic: string
): ExtractionResult {
  const t = topic.trim() || "system";
  const concepts: ExtractionResult["concepts"] = [
    { label: t, description: "FP analysis topic / system under study" },
  ];
  const claims: ExtractionResult["claims"] = [];
  const relations: ExtractionResult["relations"] = [];

  if (analysis.goal?.trim()) {
    claims.push({
      label: analysis.goal.trim(),
      description: "FP goal",
    });
    relations.push({
      from: analysis.goal.trim(),
      relation: "about",
      to: t,
    });
  }

  for (const law of analysis.laws ?? []) {
    if (!law.label?.trim()) continue;
    concepts.push({
      label: law.label.trim(),
      description: law.description ?? "domain law / invariant",
    });
  }

  for (const lim of analysis.limits ?? []) {
    if (!lim.label?.trim()) continue;
    const kind = lim.kind === "absolute" ? "absolute" : "contingent";
    concepts.push({
      label: lim.label.trim(),
      description: lim.description ?? `${kind} limit`,
    });
    claims.push({
      label: `${lim.label.trim()} is a ${kind} limit`,
      description: lim.description,
    });
  }

  for (const b of analysis.bottlenecks ?? []) {
    if (!b.label?.trim()) continue;
    concepts.push({
      label: b.label.trim(),
      description: b.description ?? "bottleneck / subsystem constraint",
    });
    claims.push({
      label: `${b.label.trim()} is a bottleneck`,
      description: b.description,
    });
  }

  for (const a of analysis.nextActions ?? []) {
    if (!a.label?.trim()) continue;
    concepts.push({
      label: a.label.trim(),
      description: a.description ?? "next experiment / action",
    });
  }

  for (const r of analysis.relations ?? []) {
    if (!r.from?.trim() || !r.to?.trim()) continue;
    const rel = (r.relation?.trim() || "about").toLowerCase();
    const allowed = new Set([
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
    ]);
    relations.push({
      from: r.from.trim(),
      relation: allowed.has(rel) ? rel : "about",
      to: r.to.trim(),
    });
  }

  return { concepts, claims, relations };
}

/**
 * Apply FP analysis as one event + pending proposals.
 * Optional project: ensure project node + edge proposals used_in from bottlenecks/claims labels.
 */
export async function runFirstPrinciplesAnalysis(
  input: RunFirstPrinciplesInput
): Promise<RunFirstPrinciplesOutput> {
  const topic = input.topic?.trim();
  if (!topic) {
    throw new Error("runFirstPrinciplesAnalysis: topic is required");
  }

  let analysis: FirstPrinciplesResult;
  let mode: RunFirstPrinciplesOutput["mode"];

  if (input.fixture) {
    analysis = input.fixture;
    mode = "fixture";
  } else if (input.complete) {
    const structured = await completeStructured<FirstPrinciplesResult>({
      complete: input.complete,
      messages: [
        {
          role: "system",
          content:
            "You perform first-principles analysis. Reply with JSON only matching the schema. " +
            "Steps: " +
            FIRST_PRINCIPLES_STEPS.join("; ") +
            ". Use short labels. Prefer relations: requires, limits, causes, increases, reduces. " +
            'limits.kind must be "absolute" or "contingent".',
        },
        {
          role: "user",
          content:
            `Topic: ${topic}\n` +
            (input.goal ? `Goal hint: ${input.goal}\n` : "") +
            "Produce a first-principles analysis JSON with goal, laws, limits, bottlenecks, relations, nextActions.",
        },
      ],
      parse: (raw) =>
        parseStructured<FirstPrinciplesResult>(raw, FIRST_PRINCIPLES_SCHEMA),
      maxAttempts: 2,
    });
    if (structured.ok && structured.value) {
      analysis = normalizeAnalysis(structured.value);
      mode = "model";
    } else {
      analysis = heuristicFirstPrinciples(topic, input.goal);
      mode = "heuristic";
    }
  } else {
    analysis = heuristicFirstPrinciples(topic, input.goal);
    mode = "heuristic";
  }

  let projectId: string | undefined;
  const projectLabel = input.projectLabel?.trim();
  if (projectLabel) {
    const project = await input.store.ensureProject({
      label: projectLabel,
      createAccepted: true,
      workspaceId: input.workspaceId,
    });
    projectId = project.id;
  }

  const extraction = firstPrinciplesToExtraction(analysis, topic);

  // Propose project links (used_in) for bottlenecks + topic — still pending until accept
  if (projectLabel) {
    extraction.relations = [
      ...(extraction.relations ?? []),
      { from: topic, relation: "used_in", to: projectLabel },
      ...analysis.bottlenecks
        .filter((b) => b.label?.trim())
        .map((b) => ({
          from: b.label.trim(),
          relation: "used_in",
          to: projectLabel,
        })),
    ];
  }

  let items = extractionToProposalItems(extraction);
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

  const sourceRef =
    input.sourceRef?.trim() ||
    (projectLabel
      ? `fp:${topic}#project=${projectLabel}`
      : `fp:${topic}`);

  const event = await input.store.createEvent({
    sourceType: "manual",
    sourceRef,
    model:
      input.model ??
      (mode === "model" ? "fp-model" : mode === "fixture" ? "fp-fixture" : "fp-heuristic"),
    inputHash: hashInput(`${topic}\n${analysis.goal}`),
  });
  const proposals = await input.store.addProposals(event.id, items);

  return {
    analysis,
    eventId: event.id,
    proposals,
    mode,
    projectId,
    sourceRef,
  };
}

function normalizeAnalysis(raw: FirstPrinciplesResult): FirstPrinciplesResult {
  return {
    goal: String(raw.goal ?? "").trim() || "unspecified goal",
    laws: Array.isArray(raw.laws) ? raw.laws : [],
    limits: (Array.isArray(raw.limits) ? raw.limits : []).map((l) => ({
      label: String(l.label ?? "").trim(),
      kind: l.kind === "absolute" ? "absolute" : "contingent",
      description: l.description,
    })),
    bottlenecks: Array.isArray(raw.bottlenecks) ? raw.bottlenecks : [],
    relations: Array.isArray(raw.relations) ? raw.relations : [],
    nextActions: Array.isArray(raw.nextActions) ? raw.nextActions : [],
  };
}

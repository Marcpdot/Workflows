/** Offline WP3 acceptance smoke: selective, bounded, observable activation. */

import { resolve } from "node:path";
import { emitCcEvaluationResult } from "@workflows/eval";
import type {
  ClaimLineage,
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeNode,
  KnowledgeStore,
} from "@workflows/knowledge";
import {
  activateInitialCapabilities,
  createCognitiveOperationContext,
  createRuntimeCapabilities,
  isCapabilityActive,
} from "../src/capabilityActivation.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { ModelClient, OrchestratorConfig } from "../src/types.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const evaluationStarted = performance.now();
const evaluationActivationCounts = {
  selected: 0,
  skipped: 0,
  degraded: 0,
  expansions: 0,
};

function decision(
  result: Awaited<ReturnType<Orchestrator["handle"]>>,
  capabilityId: string,
  state?: string
) {
  return result.activation?.decisions.find(
    (value) =>
      value.capabilityId === capabilityId && (state == null || value.state === state)
  );
}

function includeActivation(
  result: Awaited<ReturnType<Orchestrator["handle"]>>
): void {
  for (const item of result.activation?.decisions ?? []) {
    if (item.state === "selected") evaluationActivationCounts.selected++;
    if (item.state === "skipped") evaluationActivationCounts.skipped++;
    if (item.state === "degraded") evaluationActivationCounts.degraded++;
  }
  evaluationActivationCounts.expansions +=
    result.activation?.expansions.length ?? 0;
}

const baseConfig = (): OrchestratorConfig => ({
  ollamaBin: "ollama",
  ollamaModel: "fixture-local",
  xaiApiKey: "fixture",
  xaiBaseUrl: "https://example.invalid",
  grokModel: "fixture-frontier",
  systemPrompt: "Test assistant.",
  compression: {
    threshold: 20,
    keepRecent: 8,
    maxSummaryChars: 1_500,
    disabled: false,
  },
  retrieval: {
    limit: 4,
    maxChars: 1_000,
    maxChunkChars: 400,
    contextDir: resolve(process.cwd(), "../../context"),
    disabled: true,
  },
  workspaceRoot: process.cwd(),
  toolsEnabled: false,
  toolsMaxSteps: 3,
});

const modelRequests: string[][] = [];
const model: ModelClient = {
  provider: "local",
  async complete(request) {
    modelRequests.push(request.messages.map((message) => message.content));
    return {
      content: "bounded fixture response",
      model: "fixture-local",
      provider: "local",
    };
  },
};

// A + E: simple input selects only the deterministic mechanism and chosen model.
const simpleContext = activateInitialCapabilities(
  createCognitiveOperationContext({
    currentInput: "Hello blue-orchid-739",
    capabilities: createRuntimeCapabilities({
      historyCount: 0,
      compressionThreshold: 20,
      compressionAvailable: true,
      retrievalAvailable: true,
      knowledgeAvailable: true,
      longTermMemoryAvailable: true,
      toolsAvailable: true,
      selectedModel: "local",
    }),
  })
);
assert(isCapabilityActive(simpleContext, "deterministic_processing"), "deterministic selected");
assert(isCapabilityActive(simpleContext, "local_model"), "chosen model selected");
assert(!isCapabilityActive(simpleContext, "knowledge_retrieval"), "simple skips knowledge");
assert(!isCapabilityActive(simpleContext, "long_term_memory"), "simple skips LTM");
assert(!isCapabilityActive(simpleContext, "tools"), "simple skips tools");
assert(
  simpleContext.trace.decisions.find(
    (value) => value.capabilityId === "knowledge_retrieval"
  )?.reason.includes("no canonical-knowledge signal"),
  "skip reason is inspectable"
);
assert(simpleContext.trace.limits.maxExpansions > 0, "HOW MUCH limits are recorded");
assert(
  !JSON.stringify(simpleContext.trace).includes("blue-orchid-739"),
  "trace does not log private input content"
);
for (const item of simpleContext.trace.decisions) {
  if (item.state === "selected") evaluationActivationCounts.selected++;
  if (item.state === "skipped") evaluationActivationCounts.skipped++;
  if (item.state === "degraded") evaluationActivationCounts.degraded++;
}

const now = Date.now();
const alpha: KnowledgeNode = {
  id: "claim-alpha",
  type: "claim",
  label: "Alpha is stable",
  status: "accepted",
  epistemicStatus: "supported",
  confidence: 0.7,
  createdAt: now,
  updatedAt: now,
};
const beta: KnowledgeNode = {
  id: "claim-beta",
  type: "claim",
  label: "Alpha is unstable",
  status: "accepted",
  epistemicStatus: "hypothesized",
  confidence: 0.4,
  createdAt: now,
  updatedAt: now,
};
const contradiction: KnowledgeEdge = {
  id: "edge-contradiction",
  fromNodeId: alpha.id,
  relation: "contradicts",
  toNodeId: beta.id,
  status: "accepted",
  createdAt: now,
};
const sourceEvent: KnowledgeEvent = {
  id: "event-alpha",
  sourceType: "conversation",
  sourceRef: "conversation:fixture",
  sourceExperienceIds: ["experience-user-alpha"],
  transformation: { method: "conversation_extract", model: "fixture-extractor" },
  createdAt: now,
};
const lineage: ClaimLineage = {
  claim: alpha,
  derivations: [
    {
      id: "derivation-alpha",
      targetNodeId: alpha.id,
      sourceEventId: sourceEvent.id,
      method: "conversation_extract",
      model: "fixture-extractor",
      depth: 0,
      createdAt: now,
    },
  ],
  sourceNodes: [],
  sourceEvents: [sourceEvent],
  evidence: [],
  maxDepth: 4,
  truncated: false,
};

let lineageReads = 0;
const knowledge = {
  async findNodes(query: { type?: string; label?: string }) {
    if (query.type === "project") return [];
    return query.label?.toLowerCase() === "alpha" ? [alpha] : [];
  },
  async getNeighborhood() {
    return {
      nodes: [alpha, beta],
      edges: [contradiction],
      truncated: false,
      complete: true,
      truncation: { nodes: false, edges: false },
      limits: { nodes: 50, edges: 100 },
    };
  },
  async getClaimLineage() {
    lineageReads++;
    return lineage;
  },
  async listProposals() {
    return [];
  },
} as unknown as KnowledgeStore;

const knowledgeConfig = baseConfig();
knowledgeConfig.knowledge = knowledge;
knowledgeConfig.knowledgeSettings = {
  toolsEnabled: false,
  injectEnabled: true,
  injectMaxChars: 1_200,
  injectHops: 1,
  ingestAutoOnChat: false,
  ingestMinChars: 40,
  ingestMaxMessages: 12,
  captureEnabled: false,
  minCaptureIntervalMs: 8_000,
  captureModelTier: "heuristic",
};
const knowledgeOrchestrator = new Orchestrator(knowledgeConfig, {
  local: model,
  frontier: model,
});

try {
  // B: projectless knowledge + exact lineage/source-experience hydration.
  const sourced = await knowledgeOrchestrator.handle(
    "What do we know about Alpha and which sources support it?",
    { interactionMode: "neutral" }
  );
  includeActivation(sourced);
  assert(decision(sourced, "knowledge_retrieval", "selected"), "knowledge activated");
  assert(decision(sourced, "provenance_lineage", "selected"), "lineage activated");
  assert(
    sourced.activation?.representations.some(
      (value) =>
        value.kind === "source_experience_references" &&
        value.ids?.includes("experience-user-alpha")
    ),
    "source experience lineage remains auditable"
  );
  assert(
    modelRequests.at(-1)?.some((content) => content.includes("Knowledge provenance")),
    "hydrated lineage participates in model context"
  );
  assert(!sourced.activation?.representations.some((value) => value.kind === "project"), "no project required");

  // C: a retrieved contradiction expands the initially smaller set once.
  const expanded = await knowledgeOrchestrator.handle(
    "What do we know about Alpha?",
    { interactionMode: "neutral" }
  );
  includeActivation(expanded);
  assert(
    expanded.activation?.decisions.some(
      (value) =>
        value.capabilityId === "provenance_lineage" &&
        value.phase === "initial" &&
        value.state === "skipped"
    ),
    "lineage starts inactive"
  );
  assert(
    expanded.activation?.decisions.some(
      (value) =>
        value.capabilityId === "provenance_lineage" &&
        value.phase === "expanded" &&
        value.state === "selected"
    ),
    "contradiction expands lineage"
  );
  assert(expanded.activation?.expansions.length === 1, "expansion is bounded and observable");
  assert(lineageReads >= 2, "expanded capability executes lineage read");
} finally {
  knowledgeOrchestrator.close();
}

// D: requested but unavailable tools degrade explicitly; no unsafe knowledge widening.
const degradedOrchestrator = new Orchestrator(baseConfig(), {
  local: model,
  frontier: model,
});
try {
  const degraded = await degradedOrchestrator.handle(
    "Read file package.json and report its name.",
    { interactionMode: "neutral" }
  );
  includeActivation(degraded);
  assert(decision(degraded, "tools", "degraded"), "unavailable tool is degraded");
  assert(
    degraded.activation?.degradations.some(
      (value) => value.capabilityId === "tools" && value.fallback
    ),
    "degradation records bounded fallback"
  );
  assert(!decision(degraded, "knowledge_retrieval", "selected"), "degradation does not widen into knowledge");
  assert(degraded.reply === "bounded fixture response", "bounded model fallback continues");
} finally {
  degradedOrchestrator.close();
}

console.log("All selective capability-activation WP3 smoke checks passed.");
emitCcEvaluationResult({
  scenarioId: "wp3-activation",
  pass: true,
  durationMs: Math.round(performance.now() - evaluationStarted),
  model: "fixture-local",
  provider: "local",
  activationCounts: evaluationActivationCounts,
  provenanceChecks: { sourceLineageAuditable: true },
  degradationCount: evaluationActivationCounts.degraded,
});

/** Offline WP7 acceptance smoke for privacy-safe CC reconstruction/eval hooks. */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCostBreakdown,
  createCcEvaluationReport,
  emitCcEvaluationResult,
  isKnownPostgresTeardownNoise,
  resolveCcScenarioOutcome,
  type CcEvaluationResult,
} from "@workflows/eval";
import type {
  ClaimLineage,
  KnowledgeEvent,
  KnowledgeNode,
  KnowledgeStore,
} from "@workflows/knowledge";
import { createMemory } from "@workflows/memory";
import {
  InMemoryObserver,
  type CcOperationObservation,
  type Observer,
} from "@workflows/observability";
import { Orchestrator } from "../src/orchestrator.js";
import type {
  ModelChoice,
  ModelClient,
  OrchestratorConfig,
} from "../src/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function assertTeardownProtocolHandling(): void {
  const prefix = "@@workflows:cc-evaluation-result@@";
  const passed = {
    scenarioId: "wp6-background-cognition",
    pass: true,
    durationMs: 12,
  };
  const kept = resolveCcScenarioOutcome({
    scenarioId: "wp6-background-cognition",
    exitCode: 1,
    stdout: `${prefix}${JSON.stringify(passed)}\n`,
    stderr:
      "error: terminating connection due to administrator command\n    code: '57P01'\n",
    durationMs: 40,
  });
  assert(kept.pass === true, "post-pass 57P01 teardown keeps protocol pass");
  assert(
    isKnownPostgresTeardownNoise(
      "error: terminating connection due to administrator command"
    ),
    "admin disconnect is recognized as teardown noise"
  );
  const crashed = resolveCcScenarioOutcome({
    scenarioId: "wp6-background-cognition",
    exitCode: 1,
    stdout: `${prefix}${JSON.stringify(passed)}\n`,
    stderr: "TypeError: unexpected crash in scenario\n",
    durationMs: 40,
  });
  assert(crashed.pass === false, "non-teardown crash after pass still fails");
  const missing = resolveCcScenarioOutcome({
    scenarioId: "wp6-background-cognition",
    exitCode: 1,
    stdout: "",
    stderr: "error: terminating connection due to administrator command\n",
    durationMs: 8,
  });
  assert(missing.pass === false, "teardown without protocol result still fails");
}

const evaluationStarted = performance.now();
const now = Date.now();
const claim: KnowledgeNode = {
  id: "canonical-alpha-claim",
  type: "claim",
  label: "Alpha threshold is 17",
  status: "accepted",
  epistemicStatus: "supported",
  confidence: 0.8,
  createdAt: now,
  updatedAt: now,
};
const sourceEvent: KnowledgeEvent = {
  id: "event-alpha-source",
  sourceType: "conversation",
  sourceRef: "conversation:wp7",
  sourceExperienceIds: ["experience-alpha-source"],
  transformation: { method: "conversation_extract", model: "fixture-extractor" },
  createdAt: now,
};
const lineage: ClaimLineage = {
  claim,
  derivations: [{
    id: "derivation-alpha",
    targetNodeId: claim.id,
    sourceEventId: sourceEvent.id,
    method: "conversation_extract",
    model: "fixture-extractor",
    depth: 0,
    createdAt: now,
  }],
  sourceNodes: [],
  sourceEvents: [sourceEvent],
  evidence: [],
  maxDepth: 4,
  truncated: false,
};

const knowledge = {
  async findNodes(query: { label?: string }) {
    return query.label?.toLowerCase().includes("alpha") ? [claim] : [];
  },
  async getNeighborhood() {
    return {
      nodes: [claim],
      edges: [],
      truncated: false,
      complete: true,
      truncation: { nodes: false, edges: false },
      limits: { nodes: 50, edges: 100 },
    };
  },
  async getClaimLineage() {
    return lineage;
  },
  async listProposals() {
    return [];
  },
  async enqueueBackgroundWork() {
    return {
      work: { id: "background-fixture" },
      created: true,
    };
  },
  close() {},
} as unknown as KnowledgeStore;

class FixtureModel implements ModelClient {
  constructor(
    readonly provider: ModelChoice,
    private readonly modelId: string
  ) {}

  async complete() {
    return {
      content: "private-output-marker: canonical answer",
      model: this.modelId,
      provider: this.provider,
      usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
    };
  }
}

function config(input: {
  memory: ReturnType<typeof createMemory>;
  observer: Observer;
}): OrchestratorConfig {
  return {
    ollamaBin: "ollama",
    ollamaModel: "fixture-local-a",
    xaiApiKey: "fixture",
    xaiBaseUrl: "https://example.invalid",
    grokModel: "fixture-frontier-b",
    systemPrompt: "WP7 fixture assistant.",
    compression: {
      threshold: 20,
      keepRecent: 8,
      maxSummaryChars: 1_500,
      disabled: true,
    },
    retrieval: {
      limit: 4,
      maxChars: 1_000,
      maxChunkChars: 400,
      contextDir: resolve(process.cwd(), "../../context"),
      disabled: true,
    },
    workspaceRoot: process.cwd(),
    experienceStore: input.memory,
    toolsEnabled: false,
    toolsMaxSteps: 2,
    knowledge,
    knowledgeSettings: {
      toolsEnabled: false,
      injectEnabled: true,
      injectMaxChars: 1_000,
      injectHops: 1,
      ingestAutoOnChat: false,
      ingestMinChars: 20,
      ingestMaxMessages: 8,
      captureEnabled: false,
      minCaptureIntervalMs: 0,
      captureModelTier: "heuristic",
    },
    observer: input.observer,
    obsLogPrompts: false,
  };
}

function cognition(observer: InMemoryObserver): CcOperationObservation {
  const event = [...observer.events].reverse().find((item) => item.kind === "cognition");
  assert(event?.cognition, "completed operation emits a cognition event");
  return event.cognition;
}

function evaluation(
  scenarioId: string,
  observation: CcOperationObservation
): CcEvaluationResult {
  const cost = buildCostBreakdown({
    provider: observation.model?.provider ?? "local",
    usage: observation.usage,
  });
  return {
    scenarioId,
    pass: true,
    durationMs: observation.usage?.latencyMs ?? 0,
    model: observation.model?.model,
    provider: observation.model?.provider,
    toolIds: observation.tools,
    activationCounts: {
      selected: observation.activation.selected.length,
      skipped: observation.activation.skipped.length,
      degraded: observation.activation.degraded.length,
      expansions: observation.activation.expansions.length,
    },
    provenanceChecks: {
      inputExperience: Boolean(observation.experiences.inputExperienceId),
      sourceLineage: observation.knowledge.sourceExperienceIds.length > 0,
    },
    degradationCount: observation.activation.degraded.length,
    semanticChanges: {
      eventIds: observation.knowledge.sourceEventIds,
      proposalIds: observation.knowledge.proposalWrites.map((item) => item.proposalId),
      canonicalIds: observation.knowledge.canonicalIds,
    },
    usage: {
      promptTokens: observation.usage?.promptTokens,
      completionTokens: observation.usage?.completionTokens,
      totalTokens: cost.totalTokens,
      estimatedCostUsd: cost.estimatedCostUsd,
    },
  };
}

const memoryPath = resolve(process.cwd(), "data/_smoke_cc_observability.db");
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
}
const memory = createMemory({ dbPath: memoryPath });
try {
  assertTeardownProtocolHandling();
  const firstObserver = new InMemoryObserver();
  const first = new Orchestrator(config({ memory, observer: firstObserver }), {
    local: new FixtureModel("local", "fixture-local-a"),
    frontier: new FixtureModel("frontier", "fixture-frontier-b"),
  });
  const secretPrompt =
    "What do we know about Alpha and which source supports it? private-input-marker";
  const firstResult = await first.handle(secretPrompt, {
    sessionId: "wp7-model-a",
    interactionMode: "neutral",
    forceModel: "local",
  });
  const firstObservation = cognition(firstObserver);
  assert(
    firstObservation.experiences.inputExperienceId === firstResult.experiences?.input,
    "operation exposes its exact durable input ID"
  );
  assert(
    firstObservation.experiences.outputExperienceIds.includes(firstResult.experiences!.output!),
    "operation exposes its durable output ID"
  );
  assert(
    firstObservation.activation.selected.some((item) => item.capabilityId === "knowledge_retrieval"),
    "selected capabilities are reconstructable"
  );
  assert(
    firstObservation.knowledge.canonicalIds.includes(claim.id) &&
      firstObservation.knowledge.sourceExperienceIds.includes("experience-alpha-source"),
    "canonical participation and provenance IDs are reconstructable"
  );
  assert(firstObservation.model?.model === "fixture-local-a", "model ID is observable");
  assert(firstObservation.activation.limits.knowledgeChars === 1_000, "budgets are observable");
  assert(
    firstObservation.outcome.backgroundDeferred &&
      firstObservation.experiences.backgroundSourceExperienceIds.includes(
        firstResult.experiences.input
      ),
    "foreground telemetry exposes deferred persistent work by source experience"
  );
  const serialized = JSON.stringify(firstObserver.events);
  assert(!serialized.includes("private-input-marker"), "full private input is not logged");
  assert(!serialized.includes("private-output-marker"), "full private output is not logged");
  assert(!serialized.includes("Alpha threshold is 17"), "retrieved knowledge text is not logged");

  const secondObserver = new InMemoryObserver();
  const replacement = new Orchestrator(config({ memory, observer: secondObserver }), {
    local: new FixtureModel("local", "fixture-local-a"),
    frontier: new FixtureModel("frontier", "fixture-frontier-b"),
  });
  await replacement.handle(
    "What do we know about Alpha and which source supports it?",
    {
      sessionId: "wp7-model-b",
      interactionMode: "neutral",
      forceModel: "frontier",
    }
  );
  const secondObservation = cognition(secondObserver);
  assert(
    secondObservation.model?.provider === "frontier" &&
      secondObservation.model.model === "fixture-frontier-b",
    "replacement provider/model is distinguishable"
  );
  assert(
    secondObservation.knowledge.canonicalIds.includes(claim.id),
    "model replacement uses the same persistent canonical substrate"
  );
  const report = createCcEvaluationReport(
    new Date(now).toISOString(),
    new Date().toISOString(),
    [
      evaluation("fixture-local", firstObservation),
      evaluation("fixture-frontier", secondObservation),
    ]
  );
  assert(
    report.results[0]!.provider !== report.results[1]!.provider &&
      report.results.every((item) => item.usage?.totalTokens === 17) &&
      report.results[0]!.usage?.estimatedCostUsd === 0 &&
      (report.results[1]!.usage?.estimatedCostUsd ?? 0) > 0,
    "stable eval output distinguishes providers while reusing token/cost hooks"
  );

  const degradedObserver = new InMemoryObserver();
  const degraded = new Orchestrator(
    { ...config({ memory, observer: degradedObserver }), knowledge: undefined },
    {
      local: new FixtureModel("local", "fixture-local-a"),
      frontier: new FixtureModel("frontier", "fixture-frontier-b"),
    }
  );
  await degraded.handle("Read file package.json.", {
    sessionId: "wp7-degraded",
    interactionMode: "neutral",
  });
  const degradedObservation = cognition(degradedObserver);
  assert(
    degradedObservation.activation.degraded.some(
      (item) => item.capabilityId === "tools"
    ),
    "unavailable capability degradation is observable"
  );

  const throwingObserver: Observer = {
    emit() {
      throw new Error("fixture telemetry failure");
    },
  };
  const resilient = new Orchestrator(
    { ...config({ memory, observer: throwingObserver }), knowledge: undefined },
    {
      local: new FixtureModel("local", "fixture-local-a"),
      frontier: new FixtureModel("frontier", "fixture-frontier-b"),
    }
  );
  const resilientResult = await resilient.handle("Hello telemetry.", {
    sessionId: "wp7-telemetry-failure",
    interactionMode: "neutral",
  });
  assert(
    await memory.getExperience(resilientResult.experiences!.input!),
    "telemetry failure cannot invalidate the durable source"
  );
  assert(
    await memory.getExperience(resilientResult.experiences!.output!),
    "telemetry failure cannot invalidate the durable output"
  );
  console.log("WP7 Continuous Cognition observability/eval smoke passed.");
  const scenarioEvaluation = evaluation("wp7-observability", firstObservation);
  scenarioEvaluation.durationMs = Math.round(
    performance.now() - evaluationStarted
  );
  scenarioEvaluation.activationCounts!.degraded +=
    degradedObservation.activation.degraded.length;
  scenarioEvaluation.degradationCount =
    scenarioEvaluation.activationCounts!.degraded;
  emitCcEvaluationResult(scenarioEvaluation);
} finally {
  memory.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
  }
}

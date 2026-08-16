/** PostgreSQL-backed WP4 operational Continuous Cognition acceptance smoke. */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { emitCcEvaluationResult } from "@workflows/eval";
import {
  createKnowledgePostgresPool,
  createKnowledgeStore,
  resolvePostgresKnowledgeConfig,
  type KnowledgeProposal,
} from "@workflows/knowledge";
import { createMemory } from "@workflows/memory";
import { emitSafely, InMemoryObserver } from "@workflows/observability";
import { MapToolRegistry } from "@workflows/tools";
import { Orchestrator } from "../src/orchestrator.js";
import { knowledgeDiagnosticEvent } from "../src/cognitiveObservability.js";
import type {
  ModelClient,
  ModelRequest,
  OrchestratorConfig,
  OrchestratorResult,
} from "../src/types.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const OLD_CLAIM = "Motor A vibration began above 4200 rpm during the test";
const NEW_CLAIM = "Motor A vibration began at 4700 rpm during the corrected run";
const evaluationStarted = performance.now();

class FixtureModel implements ModelClient {
  readonly provider = "local" as const;
  readonly requests: ModelRequest[] = [];

  constructor(private readonly name: string) {}

  async complete(request: ModelRequest) {
    this.requests.push(request);
    const combined = request.messages.map((message) => message.content).join("\n");
    if (combined.includes("Extract durable knowledge from the conversation")) {
      const correction = combined.includes("actually began at 4700 rpm");
      return {
        content: JSON.stringify(
          correction
            ? {
                concepts: [],
                claims: [{
                  label: NEW_CLAIM,
                  description: "Direct human correction of the run attribution.",
                  confidence: 0.95,
                  epistemicStatus: "observed",
                }],
                relations: [
                  { from: NEW_CLAIM, relation: "supersedes", to: OLD_CLAIM, confidence: 0.95 },
                  { from: "Motor A", relation: "about", to: NEW_CLAIM, confidence: 0.95 },
                ],
                assumptions: [],
                openQuestions: [],
              }
            : combined.includes("4200 rpm")
              ? {
                  concepts: [{ label: "Motor A" }],
                  claims: [{
                    label: OLD_CLAIM,
                    description: "Natural human observation from a test.",
                    confidence: 0.8,
                    epistemicStatus: "observed",
                  }],
                  relations: [{ from: "Motor A", relation: "about", to: OLD_CLAIM, confidence: 0.8 }],
                  assumptions: [],
                  openQuestions: [],
                }
              : { concepts: [], claims: [], relations: [], assumptions: [], openQuestions: [] }
        ),
        model: this.name,
        provider: "local" as const,
      };
    }

    const toolResult = request.messages.find((message) =>
      message.content.startsWith("Tool result for diagnostic_reading")
    );
    if (request.tools?.length && !toolResult) {
      return {
        content: "Inspecting the bounded diagnostic source.",
        model: this.name,
        provider: "local" as const,
        toolCalls: [{ id: `${this.name}-tool-call`, name: "diagnostic_reading", args: {} }],
      };
    }
    if (toolResult) {
      return {
        content: `${this.name} used the durable tool result: vibration=normal`,
        model: this.name,
        provider: "local" as const,
      };
    }

    const user = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const current = combined.includes(NEW_CLAIM) || user.includes("4700 rpm")
      ? "4700 rpm"
      : combined.includes(OLD_CLAIM) || user.includes("4200 rpm")
        ? "4200 rpm"
        : "no stored motor threshold";
    return {
      content: `${this.name} response; current Motor A understanding: ${current}`,
      model: this.name,
      provider: "local" as const,
    };
  }
}

function config(input: {
  knowledge: ReturnType<typeof createKnowledgeStore>;
  memory: ReturnType<typeof createMemory>;
  tools: MapToolRegistry;
  observer: InMemoryObserver;
}): OrchestratorConfig {
  return {
    ollamaBin: "ollama",
    ollamaModel: "fixture-local",
    xaiApiKey: "",
    xaiBaseUrl: "https://example.invalid",
    grokModel: "fixture-frontier",
    systemPrompt: "WP4 fixture assistant.",
    compression: {
      threshold: 20,
      keepRecent: 8,
      maxSummaryChars: 1_500,
      disabled: false,
    },
    retrieval: {
      limit: 4,
      maxChars: 1_500,
      maxChunkChars: 500,
      contextDir: resolve(process.cwd(), "../../context"),
      disabled: true,
    },
    workspaceRoot: process.cwd(),
    experienceStore: input.memory,
    tools: input.tools,
    toolsEnabled: true,
    toolsMaxSteps: 3,
    observer: input.observer,
    knowledge: input.knowledge,
    knowledgeSettings: {
      toolsEnabled: false,
      injectEnabled: true,
      injectMaxChars: 2_000,
      injectHops: 1,
      ingestAutoOnChat: false,
      ingestMinChars: 20,
      ingestMaxMessages: 12,
      captureEnabled: true,
      minCaptureIntervalMs: 0,
      captureModelTier: "local",
      captureModel: "fixture-capture",
    },
  };
}

async function proposalsFor(
  result: OrchestratorResult,
  store: ReturnType<typeof createKnowledgeStore>
): Promise<KnowledgeProposal[]> {
  assert(result.capture?.eventId, "capture event id is exposed");
  return store.listProposals({ eventId: result.capture.eventId });
}

async function acceptNodesThenRelations(
  proposals: KnowledgeProposal[],
  store: ReturnType<typeof createKnowledgeStore>
): Promise<void> {
  for (const proposal of proposals.filter((item) => item.kind === "node")) {
    await store.acceptProposal(proposal.id);
  }
  for (const proposal of proposals.filter((item) => item.kind === "supersede")) {
    await store.acceptProposal(proposal.id);
  }
  for (const proposal of proposals.filter((item) => item.kind !== "node" && item.kind !== "supersede")) {
    await store.acceptProposal(proposal.id);
  }
}

const memoryPath = resolve(process.cwd(), "data/_smoke_continuous_cognition.db");
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
}

const postgres = await startKnowledgePostgresTest();
const pgConfig = {
  ...resolvePostgresKnowledgeConfig(),
  connectionString: postgres.connectionString,
  applicationName: "workflows-wp4-smoke",
};
const pool = createKnowledgePostgresPool(pgConfig);
const observer = new InMemoryObserver();
const knowledge = createKnowledgeStore({
  postgresConfig: pgConfig,
  pool,
  diagnosticSink: (record) => {
    emitSafely(observer, knowledgeDiagnosticEvent(record));
  },
});
const memory = createMemory({ dbPath: memoryPath });
const tools = new MapToolRegistry();
tools.register({
  name: "diagnostic_reading",
  description: "Return one bounded fixture diagnostic reading.",
  parameters: [],
  async execute() {
    return { ok: true, output: "vibration=normal" };
  },
});
const firstModel = new FixtureModel("model-a");
const replacementModel = new FixtureModel("model-b");
const firstRuntime = new Orchestrator(config({ knowledge, memory, tools, observer }), {
  local: firstModel,
  frontier: firstModel,
});
const replacementRuntime = new Orchestrator(config({ knowledge, memory, tools, observer }), {
  local: replacementModel,
  frontier: replacementModel,
});

try {
  // Interaction 1: natural observation, no workspace/project/task setup.
  const observation = await firstRuntime.handle(
    "Motor A started vibrating above 4200 rpm during the test.",
    {
      sessionId: "wp4-observation",
      history: [],
      interactionMode: "active",
      minCaptureIntervalMs: 0,
    }
  );
  assert(observation.experiences?.input, "natural input is a durable experience");
  assert(observation.experiences.output, "response model output is durable");
  assert(observation.capture?.ran, "natural observation produces pending semantic proposals");
  const observationEvent = await knowledge.getEvent(observation.capture.eventId!);
  assert(observationEvent?.sourceContent === undefined, "experience-backed event has no duplicate raw source");
  assert(
    observationEvent?.sourceExperienceIds.includes(observation.experiences.input),
    "observation event traces to exact user experience"
  );
  assert(
    observation.experiences.modelOutputs.every((id) => observationEvent?.sourceExperienceIds.includes(id)),
    "response and extraction model outputs that influenced integration are durable event sources"
  );
  const observationTelemetry = observer.events.find(
    (event) =>
      event.kind === "cognition" &&
      event.operationId === observation.activation?.operationId
  )?.cognition;
  assert(observationTelemetry, "normal operation emits reconstructable CC telemetry");
  assert(
    observationTelemetry.experiences.inputExperienceId === observation.experiences.input &&
      observationTelemetry.knowledge.sourceEventIds.includes(observation.capture.eventId!),
    "telemetry joins durable input and semantic event by ID"
  );
  await acceptNodesThenRelations(await proposalsFor(observation, knowledge), knowledge);
  const oldClaim = (await knowledge.findNodes({ type: "claim", label: OLD_CLAIM, status: "accepted" }))[0];
  assert(oldClaim?.epistemicStatus === "observed", "accepted observation retains observed epistemic status");
  const oldLineage = await knowledge.getClaimLineage(oldClaim.id);
  assert(
    oldLineage.sourceEvents.some((event) => event.sourceExperienceIds.includes(observation.experiences!.input!)),
    "persistent understanding retains exact source lineage"
  );

  // Interaction 2: a replacement model and empty history recover canonical understanding.
  const retrieval = await replacementRuntime.handle(
    "What do we know about Motor A and which source supports it?",
    {
      sessionId: "wp4-retrieval",
      history: [],
      interactionMode: "neutral",
    }
  );
  const retrievalPrompt = replacementModel.requests.at(-1)!.messages.map((message) => message.content).join("\n");
  assert(retrieval.activation?.decisions.some((item) => item.capabilityId === "knowledge_retrieval" && item.state === "selected"), "stored understanding activates automatically");
  assert(retrieval.activation?.decisions.some((item) => item.capabilityId === "provenance_lineage" && item.state === "selected"), "source-sensitive query activates lineage");
  assert(retrievalPrompt.includes(OLD_CLAIM), "replacement model receives canonical knowledge without prior model context");
  assert(retrievalPrompt.includes(observation.experiences.input), "lineage source experience is available to the replacement model");
  assert(!retrieval.activation?.representations.some((item) => item.kind === "project"), "project/task selection is not required");

  // Interaction 3: correction is new evidence; approval preserves and supersedes history.
  const correction = await replacementRuntime.handle(
    "The vibration actually began at 4700 rpm; the 4200 reading was from another run.",
    {
      sessionId: "wp4-correction",
      history: [],
      interactionMode: "active",
      minCaptureIntervalMs: 0,
    }
  );
  const correctionExperience = await memory.getExperience(correction.experiences!.input!);
  assert(correctionExperience?.kind === "human_correction", "explicit correction has its own durable experience kind");
  assert((await memory.getHistoryRecords("wp4-correction"))[0]?.experienceId === correctionExperience.id, "correction remains the exact user history source");
  assert(correction.activation?.decisions.some((item) => item.capabilityId === "knowledge_retrieval" && item.state === "selected"), "correction activates existing understanding through WP3 selection");
  const correctionEvent = await knowledge.getEvent(correction.capture!.eventId!);
  assert(correctionEvent?.sourceContent === undefined, "correction event also relies on durable sources");
  assert(correctionEvent?.sourceExperienceIds.includes(correctionExperience.id), "correction lineage includes exact correction experience");
  const correctionProposals = await proposalsFor(correction, knowledge);
  assert(correctionProposals.some((item) => item.kind === "supersede"), "explicit correction creates a bounded supersession proposal");
  await acceptNodesThenRelations(correctionProposals, knowledge);
  const disputedOld = await knowledge.getNode(oldClaim.id);
  const newClaim = (await knowledge.findNodes({ type: "claim", label: NEW_CLAIM, status: "accepted" }))[0];
  assert(disputedOld?.status === "disputed", "old understanding remains and becomes disputed");
  assert(disputedOld.description?.includes(newClaim.id), "old state explains which claim superseded it");
  const newLineage = await knowledge.getClaimLineage(newClaim.id);
  assert(newLineage.sourceEvents.some((event) => event.sourceExperienceIds.includes(correctionExperience.id)), "revised claim traces to correction experience");
  assert(oldLineage.sourceEvents[0]?.id !== newLineage.sourceEvents[0]?.id, "old and revised evidence histories remain distinct");
  const supersession = await pool.query(
    "SELECT source_event_id FROM knowledge_edges WHERE relation = 'supersedes' AND from_node_id = $1 AND to_node_id = $2",
    [newClaim.id, oldClaim.id]
  );
  assert(supersession.rows[0]?.source_event_id === correctionEvent?.id, "revision edge is provenance-addressable through the correction event");
  const correctionTelemetry = observer.events.find(
    (event) =>
      event.kind === "cognition" &&
      event.operationId === correction.activation?.operationId
  )?.cognition;
  assert(
    correctionTelemetry?.experiences.correctionExperienceIds.includes(correctionExperience.id),
    "correction outcome names the exact correction experience"
  );
  const supersessionTelemetry = observer.events.find(
    (event) =>
      event.kind === "knowledge" &&
      event.knowledge?.action === "proposal_accepted" &&
      event.knowledge.proposalKind === "supersede"
  )?.knowledge;
  assert(
    supersessionTelemetry?.oldClaimId === oldClaim.id &&
      supersessionTelemetry.revisedClaimId === newClaim.id &&
      supersessionTelemetry.sourceExperienceIds.includes(correctionExperience.id),
    "accepted correction exposes old/new claim IDs and exact lineage source"
  );

  // Interaction 4: only the accepted revised claim participates in later cognition.
  const revised = await replacementRuntime.handle(
    "What do we know about Motor A and which source supports the current understanding?",
    {
      sessionId: "wp4-revised-query",
      history: [],
      interactionMode: "neutral",
    }
  );
  const revisedPrompt = replacementModel.requests.at(-1)!.messages.map((message) => message.content).join("\n");
  assert(revised.reply.includes("4700 rpm"), "later response uses revised understanding");
  assert(revisedPrompt.includes(NEW_CLAIM), "revised canonical claim is active");
  assert(!revisedPrompt.includes(OLD_CLAIM), "disputed old claim is not injected as current truth");
  assert(revised.activation?.representations.some((item) => item.kind === "source_experience_references" && item.ids?.includes(correctionExperience.id)), "revised source lineage remains auditable");

  // A complete deterministic contribution can answer without invoking a model.
  const modelCallsBeforeCalculation = replacementModel.requests.length;
  const calculation = await replacementRuntime.handle("What is 7 * 6?", {
    sessionId: "wp4-deterministic",
    history: [],
    interactionMode: "neutral",
  });
  assert(calculation.reply.endsWith("42"), "deterministic capability provides the response");
  assert(calculation.provider === "deterministic", "model is not encoded as the universal response center");
  assert(replacementModel.requests.length === modelCallsBeforeCalculation, "complete deterministic result does not invoke a model");
  assert(calculation.activation?.decisions.some((item) => item.capabilityId === "local_model" && item.state === "skipped"), "trace explains skipped response model");
  assert(!calculation.activation?.decisions.some((item) => item.capabilityId === "knowledge_retrieval" && item.state === "selected"), "simple operation remains selective");
  assert(calculation.experiences?.deterministicOutputs.length === 1, "deterministic output is a durable experience");

  // Tool calls/results and every model output used by later reasoning are durable.
  const toolTurn = await replacementRuntime.handle(
    "Inspect the diagnostic reading with the available tool.",
    {
      sessionId: "wp4-tool",
      history: [],
      interactionMode: "neutral",
    }
  );
  assert(toolTurn.experiences?.toolCalls.length === 1, "tool call is durable");
  assert(toolTurn.experiences.toolResults.length === 1, "tool result is durable");
  assert(toolTurn.experiences.modelOutputs.length === 2, "intermediate and final model outputs are durable");
  const toolResult = await memory.getExperience(toolTurn.experiences.toolResults[0]!);
  assert(toolResult?.parentExperienceIds[0] === toolTurn.experiences.toolCalls[0], "tool result points to exact call experience");
  const finalToolOutput = await memory.getExperience(toolTurn.experiences.output!);
  assert(finalToolOutput?.parentExperienceIds[0] === toolTurn.experiences.toolResults[0], "final reasoning output points to the tool result it consumed");
  assert(toolTurn.activation?.representations.some((item) => item.kind === "tool_result" && item.ids?.includes(toolTurn.experiences!.toolResults[0]!)), "tool result is a first-class operation contribution");

  const outbox = await pool.query("SELECT count(*)::int AS count FROM knowledge_projection_outbox");
  assert(Number(outbox.rows[0]?.count) > 0, "canonical PostgreSQL writes enqueue reconstructable graph/vector projections");
  console.log("WP4 operational Continuous Cognition 3+1 acceptance checks passed.");
  emitCcEvaluationResult({
    scenarioId: "wp4-operational-continuity",
    pass: true,
    durationMs: Math.round(performance.now() - evaluationStarted),
    model: "model-b",
    provider: "local",
    toolIds: ["diagnostic_reading"],
    activationCounts: {
      selected: retrieval.activation?.decisions.filter((item) => item.state === "selected").length ?? 0,
      skipped: calculation.activation?.decisions.filter((item) => item.state === "skipped").length ?? 0,
      degraded: 0,
      expansions: retrieval.activation?.expansions.length ?? 0,
    },
    provenanceChecks: {
      durableInputAndOutput: true,
      correctionLineageAuditable: true,
      toolResultLineageAuditable: true,
      noDuplicateExperiencePayload: true,
    },
    semanticChanges: {
      eventIds: [observation.capture.eventId!, correction.capture!.eventId!],
      proposalIds: correctionProposals.map((item) => item.id),
      canonicalIds: [oldClaim.id, newClaim.id],
    },
  });
} finally {
  memory.close();
  await pool.end();
  await postgres.dispose();
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
  }
}

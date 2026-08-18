/** PostgreSQL-backed WP5 representation acquisition acceptance smoke. */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { emitCcEvaluationResult } from "@workflows/eval";
import {
  createKnowledgePostgresPool,
  endKnowledgePostgresPool,
  createKnowledgeStore,
  proposalToRepresentationGap,
  resolvePostgresKnowledgeConfig,
  type KnowledgeNode,
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
} from "../src/types.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const evaluationStarted = performance.now();

class FixtureModel implements ModelClient {
  readonly provider = "local" as const;
  readonly requests: ModelRequest[] = [];

  async complete(request: ModelRequest) {
    this.requests.push(request);
    const context = request.messages.map((message) => message.content).join("\n");
    return {
      content: context.includes("Resolved referent (canonical, contextual)")
        ? "Processed with the resolved canonical referent."
        : "Processed without a resolved referent.",
      model: "wp5-fixture",
      provider: "local" as const,
    };
  }
}

async function createIdentity(
  store: ReturnType<typeof createKnowledgeStore>,
  eventId: string,
  label: string,
  description: string
): Promise<KnowledgeNode> {
  const proposal = (await store.addProposals(eventId, [{
    kind: "node",
    payload: { type: "artifact", label, description },
  }]))[0]!;
  await store.acceptProposal(proposal.id);
  const matches = await store.findNodes({
    type: "artifact",
    label,
    status: "accepted",
    limit: 50,
  });
  const match = matches.find((node) => node.description === description);
  assert(match, `created identity ${label} (${description})`);
  return match;
}

function config(input: {
  knowledge: ReturnType<typeof createKnowledgeStore>;
  memory: ReturnType<typeof createMemory>;
  tools: MapToolRegistry;
  observer: InMemoryObserver;
}): OrchestratorConfig {
  return {
    ollamaBin: "ollama",
    ollamaModel: "wp5-fixture",
    xaiApiKey: "",
    xaiBaseUrl: "https://example.invalid",
    grokModel: "wp5-fixture-frontier",
    systemPrompt: "WP5 fixture assistant.",
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
    toolsMaxSteps: 2,
    observer: input.observer,
    knowledge: input.knowledge,
    knowledgeSettings: {
      toolsEnabled: false,
      injectEnabled: false,
      injectMaxChars: 1_500,
      injectHops: 1,
      ingestAutoOnChat: false,
      ingestMinChars: 20,
      ingestMaxMessages: 8,
      captureEnabled: false,
      minCaptureIntervalMs: 0,
      captureModelTier: "heuristic",
    },
  };
}

const memoryPath = resolve(process.cwd(), "data/_smoke_representation_acquisition.db");
for (const suffix of ["", "-shm", "-wal"]) {
  if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
}

const postgres = await startKnowledgePostgresTest();
const pgConfig = {
  ...resolvePostgresKnowledgeConfig(),
  connectionString: postgres.connectionString,
  applicationName: "workflows-wp5-smoke",
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
  name: "inspect_device_identity",
  description: "Inspect one fixture device identity.",
  parameters: [],
  async execute() {
    return {
      ok: true,
      output: JSON.stringify({ stableIdentifier: "device:pump-9" }),
      data: { stableIdentifier: "device:pump-9" },
    };
  },
});
const model = new FixtureModel();
const runtime = new Orchestrator(config({ knowledge, memory, tools, observer }), {
  local: model,
  frontier: model,
});

try {
  const seed = await knowledge.createEvent({
    sourceType: "manual",
    sourceRef: "wp5-fixture-identities",
  });
  const motorRun = await createIdentity(
    knowledge,
    seed.id,
    "Motor A",
    "motor from the 4700 rpm test run"
  );
  const motorBench = await createIdentity(
    knowledge,
    seed.id,
    "Motor A",
    "motor from the earlier bench test"
  );
  const pumpSensor = await createIdentity(
    knowledge,
    seed.id,
    "Pump telemetry channel 9",
    "bounded fixture source"
  );
  const similarA = await createIdentity(
    knowledge,
    seed.id,
    "Cooling Pump Alpha",
    "primary cooling loop pump"
  );
  const similarB = await createIdentity(
    knowledge,
    seed.id,
    "Cooling Pump A",
    "secondary cooling loop pump"
  );
  const runContext = await createIdentity(
    knowledge,
    seed.id,
    "Run 4700",
    "test context for the corrected run"
  );
  const contextEdge = (await knowledge.addProposals(seed.id, [{
    kind: "edge",
    payload: {
      fromId: motorRun.id,
      relation: "part_of",
      toId: runContext.id,
    },
  }]))[0]!;
  await knowledge.acceptProposal(contextEdge.id);
  await knowledge.addAlias({
    aliasLabel: "asset:motor-a:run-4700",
    canonicalNodeId: motorRun.id,
  });
  await knowledge.addAlias({
    aliasLabel: "device:pump-9",
    canonicalNodeId: pumpSensor.id,
  });

  // A. Strong source metadata resolves an otherwise unknown human label.
  const metadataResolved = await runtime.handle(
    "The unit alpha reading is above its expected range.",
    {
      sessionId: "wp5-metadata",
      history: [],
      interactionMode: "neutral",
      experienceSource: { type: "api", ref: "telemetry:sample-1" },
      representation: {
        referentLabel: "unit alpha",
        stableIdentifier: "asset:motor-a:run-4700",
        sourceType: "api",
        sourceRef: "telemetry:sample-1",
      },
    }
  );
  assert(metadataResolved.representation?.status === "resolved", "metadata resolves the unknown label");
  assert(metadataResolved.representation.canonicalId === motorRun.id, "stable identifier reuses canonical identity");
  assert(metadataResolved.representation.method === "source_metadata", "trace reports metadata resolution");
  assert(!metadataResolved.representation.question, "strong metadata avoids human clarification");
  assert(metadataResolved.activation?.decisions.some((item) => item.capabilityId === "representation_acquisition" && item.state === "selected"), "representation acquisition uses WP3 activation");
  assert(metadataResolved.activation?.expansions.some((item) => item.activated.includes("local_model")), "response model expands only after the referent is resolved");
  const metadataEvent = await knowledge.getEvent(metadataResolved.representation.sourceEventId!);
  assert(metadataEvent?.sourceContent === undefined, "resolved gap event does not duplicate authoritative experience content");
  assert(metadataEvent?.sourceExperienceIds.includes(metadataResolved.experiences!.input!), "metadata resolution preserves exact input provenance");
  assert(!metadataResolved.activation?.representations.some((item) => item.kind === "project"), "no project/task setup is required");

  // Existing accepted relations narrow candidates before a configured tool.
  const relationResolved = await runtime.handle(
    "Process this Motor A reading.",
    {
      sessionId: "wp5-world-context",
      history: [],
      interactionMode: "neutral",
      representation: {
        referentLabel: "Motor A",
        candidateCanonicalIds: [motorRun.id, motorBench.id],
        candidateSignal: "structured",
        contextCanonicalIds: [runContext.id],
        contextKey: "run:4700",
        inspection: { toolName: "inspect_device_identity" },
      },
    }
  );
  assert(relationResolved.representation?.canonicalId === motorRun.id, "accepted world-model relation narrows the candidate set");
  assert(relationResolved.representation.method === "world_model_context", "world-model context precedes tool inspection");
  assert(relationResolved.experiences?.toolCalls.length === 0, "unneeded inspection tool is not executed");

  // Bounded inference creates only a contextual gap resolution, never an alias.
  const inferred = await runtime.handle(
    "Process the cooling pump reading.",
    {
      sessionId: "wp5-bounded-inference",
      history: [],
      interactionMode: "neutral",
      representation: {
        referentLabel: "cooling pump",
        candidateCanonicalIds: [similarA.id, similarB.id],
        candidateSignal: "structured",
        contextTerms: ["secondary"],
        contextKey: "cooling-loop:secondary",
      },
    }
  );
  assert(inferred.representation?.canonicalId === similarB.id, "constrained context can resolve one candidate");
  assert(inferred.representation.method === "bounded_inference", "weaker inference remains explicit");
  assert((await knowledge.resolveCanonical({ label: "cooling pump", type: "artifact" })) === null, "bounded inference does not create a canonical alias");

  // B. Two exact canonical candidates remain explicit and produce one question.
  const modelCallsBeforeAmbiguity = model.requests.length;
  const ambiguous = await runtime.handle(
    "What is the current status of Motor A?",
    {
      sessionId: "wp5-ambiguity",
      history: [],
      interactionMode: "neutral",
    }
  );
  assert(ambiguous.representation?.status === "needs_clarification", "ambiguous label is not silently selected");
  assert(ambiguous.provider === "deterministic", "precise clarification does not require a model");
  assert(model.requests.length === modelCallsBeforeAmbiguity, "ambiguous identity does not invoke the response model");
  assert(ambiguous.reply.includes("4700 rpm test run") && ambiguous.reply.includes("earlier bench test"), "question asks only for the discriminating information");
  assert(ambiguous.reply.split("?").length === 2, "exactly one clarification question is produced");
  const pendingProposal = (await knowledge.listProposals({
    status: "pending",
    kind: "representation_gap",
    eventId: ambiguous.representation!.sourceEventId,
  }))[0];
  const pendingGap = proposalToRepresentationGap(pendingProposal);
  assert(pendingGap?.candidates.length === 2 && pendingGap.humanClarificationRequired, "unresolved candidate state is durable");
  assert((await knowledge.resolveCanonical({ label: "Motor A", type: "artifact" })) === null, "ambiguity never creates an alias or merge");
  let outsideCandidateRejected = false;
  try {
    await knowledge.acceptProposal(pendingProposal.id, {
      resolution: {
        canonicalNodeId: similarA.id,
        method: "human_clarification",
        confidence: 1,
      },
    });
  } catch {
    outsideCandidateRejected = true;
  }
  assert(outsideCandidateRejected, "gap resolution cannot substitute an identity outside the preserved candidates");

  // C. The answer is a durable experience that resolves the same gap.
  const clarified = await runtime.handle(
    "The 4700 rpm test run.",
    {
      sessionId: "wp5-ambiguity",
      history: [],
      interactionMode: "neutral",
    }
  );
  assert(clarified.representation?.status === "resolved", "human answer resolves the pending gap");
  assert(clarified.representation.canonicalId === motorRun.id, "clarification selects the intended canonical identity");
  assert(clarified.representation.gapId === ambiguous.representation.gapId, "clarification closes the same stable gap");
  const clarificationExperience = await memory.getExperience(clarified.experiences!.input!);
  assert(clarificationExperience?.content === "The 4700 rpm test run.", "clarification is retained as exact durable experience");
  const clarificationEvent = await knowledge.getEvent(clarified.representation.sourceEventId!);
  assert(clarificationEvent?.sourceExperienceIds[0] === clarificationExperience.id, "clarification event points to its exact experience");
  const resolvedProposal = (await knowledge.listProposals({
    status: "accepted",
    kind: "representation_gap",
    newestFirst: true,
  })).find((item) => item.id === ambiguous.representation!.gapId);
  const resolvedGap = proposalToRepresentationGap(resolvedProposal!);
  assert(resolvedGap?.resolution?.method === "human_clarification", "gap records explicit human resolution");
  assert(resolvedGap?.resolution?.clarificationExperienceId === clarificationExperience.id, "gap resolution remains experience-addressable");
  const clarificationObservations = await knowledge.listObservations(motorRun.id);
  assert(clarificationObservations.some((item) => item.metadata.representationGapId === resolvedGap.id && item.sourceEventId === clarificationEvent.id), "safe direct clarification observation is auditable");
  assert((await knowledge.getNode(motorBench.id))?.status === "accepted", "other plausible identity remains intact");
  const clarificationTelemetry = observer.events.find(
    (event) =>
      event.kind === "cognition" &&
      event.operationId === clarified.activation?.operationId
  )?.cognition;
  assert(
    clarificationTelemetry?.experiences.clarificationExperienceIds.includes(
      clarificationExperience.id
    ) &&
      clarificationTelemetry.knowledge.gapId === resolvedGap.id &&
      clarificationTelemetry.knowledge.canonicalIds.includes(motorRun.id),
    "clarification telemetry joins gap, experience, and canonical resolution"
  );
  const resolutionTelemetry = observer.events.find(
    (event) =>
      event.kind === "knowledge" &&
      event.knowledge?.gapId === resolvedGap.id &&
      event.knowledge.action === "proposal_accepted"
  )?.knowledge;
  assert(
    resolutionTelemetry?.sourceExperienceIds.includes(clarificationExperience.id) &&
      resolutionTelemetry.resolutionMethod === "human_clarification",
    "canonical write hook exposes clarification lineage without content"
  );

  // D. A later session reuses the exact contextual resolution without model history.
  const reused = await runtime.handle(
    "What is the current status of Motor A?",
    {
      sessionId: "wp5-later-session",
      history: [],
      interactionMode: "neutral",
    }
  );
  assert(reused.representation?.status === "resolved", "later input reuses resolved ambiguity");
  assert(reused.representation.canonicalId === motorRun.id, "later reuse selects the learned canonical referent");
  assert(reused.representation.method === "prior_clarification", "reuse is explicitly attributed to prior clarification");
  assert(!reused.representation.question, "same clarification is not asked again");
  const reusedPrompt = model.requests.at(-1)!.messages.map((message) => message.content).join("\n");
  assert(reusedPrompt.includes(motorRun.id), "replacement context receives canonical identity without prior model history");
  const reuseTelemetry = observer.events.find(
    (event) =>
      event.kind === "cognition" &&
      event.operationId === reused.activation?.operationId
  )?.cognition;
  assert(
    reuseTelemetry?.outcome.priorClarificationReused === true &&
      reuseTelemetry.outcome.clarificationResolved === false,
    "later reuse is a factual outcome hook without another clarification"
  );

  // E. One bounded tool inspection runs before any human question.
  const toolResolved = await runtime.handle(
    "Process the incoming pump reading.",
    {
      sessionId: "wp5-tool",
      history: [],
      interactionMode: "neutral",
      experienceSource: { type: "api", ref: "pump-reading:1" },
      representation: {
        referentLabel: "Pump Sensor",
        sourceType: "api",
        sourceRef: "pump-reading:1",
        inspection: { toolName: "inspect_device_identity" },
      },
    }
  );
  assert(toolResolved.representation?.status === "resolved", "tool metadata resolves the gap");
  assert(toolResolved.representation.canonicalId === pumpSensor.id, "tool stable identifier reuses canonical identity");
  assert(toolResolved.representation.method === "tool_inspection", "tool resolution method is explicit");
  assert(toolResolved.experiences?.toolCalls.length === 1 && toolResolved.experiences.toolResults.length === 1, "inspection call and result are durable experiences");
  assert(toolResolved.activation?.decisions.some((item) => item.capabilityId === "tools" && item.state === "selected"), "existing tools capability activates before clarification");
  assert(toolResolved.activation?.representations.some((item) => item.kind === "tool_result" && item.ids?.includes(toolResolved.experiences!.toolResults[0]!)), "tool result is a first-class capability output");
  const toolEvent = await knowledge.getEvent(toolResolved.representation.sourceEventId!);
  assert(toolResolved.experiences.toolResults.every((id) => toolEvent?.sourceExperienceIds.includes(id)), "resolved representation links to tool-result provenance");

  // F. Semantic candidates can motivate a gap but can never establish identity.
  const unsafeSimilarity = await runtime.handle(
    "Check the cooling pump.",
    {
      sessionId: "wp5-similarity",
      history: [],
      interactionMode: "neutral",
      representation: {
        referentLabel: "cooling pump",
        candidateCanonicalIds: [similarA.id, similarB.id],
        candidateSignal: "semantic",
        sourceType: "api",
      },
    }
  );
  assert(unsafeSimilarity.representation?.status === "needs_clarification", "semantic similarity preserves ambiguity");
  const similarityProposal = (await knowledge.listProposals({
    status: "pending",
    kind: "representation_gap",
    eventId: unsafeSimilarity.representation!.sourceEventId,
  }))[0];
  const similarityGap = proposalToRepresentationGap(similarityProposal);
  assert(similarityGap?.candidates.every((item) => item.reason === "semantic_candidate"), "semantic origin remains visible as candidate evidence only");
  assert((await knowledge.getNode(similarA.id))?.status === "accepted" && (await knowledge.getNode(similarB.id))?.status === "accepted", "similar entities remain separate canonical identities");
  assert((await knowledge.resolveCanonical({ label: "cooling pump", type: "artifact" })) === null, "similarity does not create a canonical alias");

  const outbox = await pool.query("SELECT count(*)::int AS count FROM knowledge_projection_outbox");
  assert(Number(outbox.rows[0]?.count) > 0, "PostgreSQL remains canonical and projections remain outbox-derived");
  console.log("WP5 representation acquisition acceptance checks passed.");
  emitCcEvaluationResult({
    scenarioId: "wp5-representation-acquisition",
    pass: true,
    durationMs: Math.round(performance.now() - evaluationStarted),
    model: "wp5-fixture",
    provider: "local",
    toolIds: ["inspect_device_identity"],
    activationCounts: {
      selected: toolResolved.activation?.decisions.filter((item) => item.state === "selected").length ?? 0,
      skipped: ambiguous.activation?.decisions.filter((item) => item.state === "skipped").length ?? 0,
      degraded: 0,
      expansions: metadataResolved.activation?.expansions.length ?? 0,
    },
    provenanceChecks: {
      metadataResolutionLineage: true,
      clarificationExperienceLineage: true,
      toolResolutionLineage: true,
      semanticSimilarityDoesNotMerge: true,
    },
    semanticChanges: {
      eventIds: [
        metadataResolved.representation.sourceEventId!,
        clarificationEvent!.id,
        toolEvent!.id,
      ],
      proposalIds: [resolvedGap!.id],
      canonicalIds: [motorRun.id, pumpSensor.id],
    },
  });
} finally {
  memory.close();
  await endKnowledgePostgresPool(pool);
  await postgres.dispose();
  for (const suffix of ["", "-shm", "-wal"]) {
    if (existsSync(memoryPath + suffix)) rmSync(memoryPath + suffix);
  }
}

/** PostgreSQL-backed WP6 finite background cognition acceptance smoke. */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  acquireRepresentation,
  createKnowledgePostgresPool,
  createKnowledgeStore,
  createPostgresVectorRepository,
  KNOWLEDGE_VECTOR_DIMENSION,
  runKnowledgeBackgroundPass,
  type GraphPath,
  type GraphRepository,
  type KnowledgeNode,
  type RepositoryHealth,
  type SemanticEmbeddingProvider,
} from "@workflows/knowledge";
import { createMemory } from "@workflows/memory";
import { InMemoryObserver } from "@workflows/observability";
import { Orchestrator } from "../src/orchestrator.js";
import { observeBackgroundPass } from "../src/cognitiveObservability.js";
import type { ModelClient, OrchestratorConfig } from "../src/types.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

class FixtureModel implements ModelClient {
  readonly provider = "local" as const;
  calls = 0;

  async complete() {
    this.calls++;
    return {
      content: "Foreground response completed before deferred consolidation.",
      model: "wp6-fixture",
      provider: "local" as const,
    };
  }
}

class CountingGraph implements GraphRepository {
  readonly backend = "graph" as const;
  reads = 0;
  writes = 0;

  async healthCheck(): Promise<RepositoryHealth> { return { backend: this.backend, ok: true }; }
  async replaceAcceptedProjection(): Promise<void> { this.writes++; }
  async upsertNode(): Promise<void> { this.writes++; }
  async upsertEdge(): Promise<void> { this.writes++; }
  async deleteCanonicalId(): Promise<void> { this.writes++; }
  async getNode(): Promise<KnowledgeNode | null> { this.reads++; return null; }
  async expand(): Promise<GraphPath> { this.reads++; return { nodes: [], edges: [] }; }
  async findPath(): Promise<GraphPath | null> { this.reads++; return null; }
  async close(): Promise<void> {}
}

const embedder: SemanticEmbeddingProvider = {
  model: "wp6-fixture",
  modelVersion: "v1",
  dimension: KNOWLEDGE_VECTOR_DIMENSION,
  async embed(texts) {
    return texts.map(() => {
      const vector = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0);
      vector[0] = 1;
      return vector;
    });
  },
};

function orchestratorConfig(
  knowledge: ReturnType<typeof createKnowledgeStore>,
  memory: ReturnType<typeof createMemory>
): OrchestratorConfig {
  return {
    ollamaBin: "ollama",
    ollamaModel: "wp6-fixture",
    xaiApiKey: "",
    xaiBaseUrl: "https://example.invalid",
    grokModel: "wp6-frontier",
    systemPrompt: "WP6 fixture assistant.",
    compression: { threshold: 20, keepRecent: 8, maxSummaryChars: 1_000, disabled: true },
    retrieval: { limit: 2, maxChars: 500, maxChunkChars: 250, contextDir: resolve(process.cwd(), "../../context"), disabled: true },
    workspaceRoot: process.cwd(),
    experienceStore: memory,
    toolsEnabled: false,
    toolsMaxSteps: 2,
    knowledge,
    knowledgeSettings: {
      toolsEnabled: false,
      injectEnabled: false,
      injectMaxChars: 500,
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

async function acceptedNode(
  store: ReturnType<typeof createKnowledgeStore>,
  input: { label: string; type?: string; workspaceId?: string; sourceExperienceId?: string }
) {
  const event = await store.createEvent({
    sourceType: "manual",
    sourceRef: `wp6-node:${input.label}:${input.workspaceId ?? "none"}`,
    sourceExperienceIds: input.sourceExperienceId ? [input.sourceExperienceId] : [],
    sourceContent: input.sourceExperienceId ? undefined : `fixture source for ${input.label}`,
    transformation: { method: "wp6_fixture", informationLoss: { occurred: false } },
  });
  const proposal = (await store.addProposals(event.id, [{
    kind: "node",
    payload: {
      type: input.type ?? "concept",
      label: input.label,
      workspaceId: input.workspaceId,
      epistemicStatus: "inferred",
      observationKind: "derived_from",
      derivation: { method: "wp6_fixture", informationLoss: { occurred: false } },
    },
  }]))[0]!;
  await store.acceptProposal(proposal.id);
  return (await store.findNodes({
    type: input.type ?? "concept",
    label: input.label,
    workspaceId: input.workspaceId,
    status: "accepted",
    limit: 10,
  }))[0]!;
}

async function main(): Promise<void> {
  const observer = new InMemoryObserver();
  const runtime = await startKnowledgePostgresTest();
  const memoryPath = resolve(process.cwd(), `data/wp6-memory-${Date.now()}.db`);
  const pool = createKnowledgePostgresPool({ connectionString: runtime.connectionString });
  let memory = createMemory({ dbPath: memoryPath });
  let store = createKnowledgeStore({ pool, postgresConfig: { connectionString: runtime.connectionString } });
  try {
    // A. Foreground persists + enqueues, but semantic consolidation happens later.
    const model = new FixtureModel();
    const orchestrator = new Orchestrator(orchestratorConfig(store, memory), { local: model, frontier: model });
    const foreground = await orchestrator.handle(
      "Motor Q vibration causes bearing heat above 4700 rpm during the endurance test.",
      { sessionId: "wp6-session" }
    );
    assert(foreground.experiences?.input, "foreground input is a durable experience");
    assert(foreground.capture?.ran === false, "foreground does not wait for semantic consolidation");
    const queued = await store.listBackgroundWork({ kind: "semantic_consolidation", status: "pending" });
    assert(queued.some((item) => item.sourceExperienceId === foreground.experiences!.input), "durable input creates stable pending work");

    const first = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(first.itemsInspected === 1 && first.proposalsCreated > 0, "background pass creates bounded semantic proposals");
    assert(first.modelCallsUsed === 0, "deferred conservative extraction does not invoke a model");
    const completed = (await store.listBackgroundWork({ kind: "semantic_consolidation", status: "completed" }))
      .find((item) => item.sourceExperienceId === foreground.experiences!.input)!;
    observer.emit({
      ts: new Date().toISOString(),
      kind: "background",
      background: observeBackgroundPass("wp6-first-pass", first, {
        workIds: [completed.id],
        work: [{
          id: completed.id,
          kind: completed.kind,
          status: completed.status,
          sourceExperienceId: completed.sourceExperienceId,
        }],
        sourceExperienceIds: [foreground.experiences.input],
        limits: { maxItems: 20, maxModelCalls: 0 },
      }),
    });
    const firstTelemetry = observer.events.at(-1)?.background;
    assert(
      firstTelemetry?.itemsInspected === first.itemsInspected &&
        firstTelemetry.sourceExperienceIds.includes(foreground.experiences.input) &&
        firstTelemetry.work[0]?.kind === "semantic_consolidation" &&
        firstTelemetry.work[0].status === "completed",
      "background observability reuses pass metrics and exact source IDs"
    );
    assert(
      !JSON.stringify(firstTelemetry).includes("bearing heat above 4700 rpm"),
      "background telemetry excludes raw source content"
    );
    const semanticEvent = await store.getEvent(String(completed.payload.eventId));
    assert(semanticEvent?.sourceContent === undefined, "background knowledge never copies authoritative experience content");
    assert(semanticEvent?.sourceExperienceIds.join(",") === foreground.experiences.input, "semantic lineage points to the exact durable experience");
    const pendingProposals = await store.listProposals({ eventId: semanticEvent.id });
    assert(pendingProposals.length === first.proposalsCreated && pendingProposals.every((item) => item.status === "pending"), "background extraction proposes and never auto-approves truth");
    const repeated = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(repeated.proposalsCreated === 0 && repeated.itemsInspected === 0, "rerun creates no duplicate semantic result");

    // B. Pending state survives worker/runtime replacement.
    const restartExperience = await memory.recordExperience({
      kind: "external_observation",
      content: "Cooling airflow reduces Motor R winding temperature during the endurance run.",
      source: { type: "sensor-adapter", ref: "fixture-r" },
    });
    await store.enqueueBackgroundWork({
      kind: "semantic_consolidation",
      workKey: `semantic-consolidation:${restartExperience.id}`,
      sourceExperienceId: restartExperience.id,
    });
    memory.close();
    memory = createMemory({ dbPath: memoryPath });
    store = createKnowledgeStore({ pool, postgresConfig: { connectionString: runtime.connectionString } });
    const restarted = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(restarted.itemsInspected === 1 && restarted.proposalsCreated > 0, "new runtime resumes persisted work");

    // C. An idle pass is finite and performs no model/projection work.
    const idleGraph = new CountingGraph();
    const idle = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(idle.itemsInspected === 0 && idle.modelCallsUsed === 0 && idle.proposalsCreated === 0, "no-change pass reports zero work");
    assert(idleGraph.reads === 0 && idleGraph.writes === 0, "no-change pass performs no auxiliary projection access when none is requested");

    // D. Existing projection outboxes are reconciled independently and idempotently.
    const projected = await acceptedNode(store, { label: "WP6 projected identity" });
    const graph = new CountingGraph();
    const vector = createPostgresVectorRepository({ connectionString: runtime.connectionString, pool });
    const projectionPass = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory, graph, vector, embedder });
    assert(projectionPass.projectionsReconciled.graph > 0 && projectionPass.projectionsReconciled.vector > 0, "background pass reuses graph/vector projection outboxes");
    assert((await store.getNode(projected.id))?.status === "accepted", "PostgreSQL canonical truth remains intact");
    const projectionRepeat = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory, graph, vector, embedder });
    assert(projectionRepeat.projectionsReconciled.graph === 0 && projectionRepeat.projectionsReconciled.vector === 0, "projection retry converges idempotently");
    await vector.close();

    // E. New strong alias evidence wakes one waiting representation gap.
    const candidateA = await acceptedNode(store, { label: "Drive Motor Alpha", type: "artifact", workspaceId: "run-a" });
    const candidateB = await acceptedNode(store, { label: "Drive Motor Beta", type: "artifact", workspaceId: "run-b" });
    const gapExperience = await memory.recordExperience({
      kind: "external_observation",
      content: "unit-17 emitted a vibration alert",
      source: { type: "telemetry", ref: "unit-17" },
    });
    const acquisition = await acquireRepresentation({
      store,
      content: gapExperience.content!,
      sourceExperienceId: gapExperience.id,
      metadata: {
        referentLabel: "unit-17",
        candidateCanonicalIds: [candidateA.id, candidateB.id],
        candidateSignal: "structured",
        sourceType: "telemetry",
      },
    });
    assert(acquisition.status === "needs_clarification" && acquisition.gap, "ambiguous referent persists as a gap");
    const waiting = await store.listBackgroundWork({ kind: "representation_gap_retry", status: "waiting" });
    assert(waiting.some((item) => item.targetProposalId === acquisition.gap!.id), "new gap waits cheaply for new evidence");
    await store.addAlias({ aliasLabel: "unit-17", canonicalNodeId: candidateA.id });
    const gapPass = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(gapPass.gapsResolved === 1, "new alias wakes and safely resolves the gap");
    const resolvedGap = await store.getProposal(acquisition.gap.id);
    assert(resolvedGap?.status === "accepted", "same persisted gap is resolved rather than replaced");
    const gapResolutionEvent = await store.getEvent(String((resolvedGap.payload.resolution as Record<string, unknown>).resolutionEventId));
    assert(gapResolutionEvent?.sourceExperienceIds.includes(gapExperience.id), "gap retry preserves original experience lineage");
    const gapRepeat = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(gapRepeat.gapsResolved === 0, "resolved gap is not retried or re-prompted");

    // F. Source invalidation surfaces dependent claims without rewriting history.
    const lineageExperience = await memory.recordExperience({
      kind: "external_observation",
      content: "Fixture source for dependent claim",
      source: { type: "test" },
    });
    const sourceEvent = await store.createEvent({
      sourceType: "manual",
      sourceRef: "wp6-dependent-source",
      sourceExperienceIds: [lineageExperience.id],
      transformation: { method: "fixture_observation", informationLoss: { occurred: false } },
    });
    const dependentProposal = (await store.addProposals(sourceEvent.id, [{
      kind: "node",
      payload: {
        type: "claim",
        label: "Motor S requires reconsideration after source invalidation",
        epistemicStatus: "inferred",
        observationKind: "derived_from",
        derivation: { method: "fixture_derivation", informationLoss: { occurred: false } },
      },
    }]))[0]!;
    await store.acceptProposal(dependentProposal.id);
    const dependentClaim = (await store.findNodes({ type: "claim", label: "Motor S requires reconsideration", status: "accepted" }))[0]!;
    await store.invalidateEvent(sourceEvent.id, "fixture source invalidated");
    const invalidationPass = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(invalidationPass.contradictionsSurfaced >= 1 && invalidationPass.escalationsCreated === 1, "source invalidation surfaces bounded reconsideration");
    assert((await store.getNode(dependentClaim.id))?.status === "accepted", "historical claim is preserved and not rewritten automatically");
    const invalidationWork = (await store.listBackgroundWork({ kind: "claim_reconsideration", status: "escalated" }))
      .find((item) => item.sourceEventId === sourceEvent.id)!;
    assert((invalidationWork.payload.affectedClaimIds as string[]).includes(dependentClaim.id), "escalation records the exact dependent claim ID");

    // G. A contradiction creates one bounded escalation and never recurses.
    const alternativeClaim = await acceptedNode(store, { label: "Motor S source remains valid", type: "claim" });
    const contradiction = await store.markContradiction({ fromId: dependentClaim.id, toId: alternativeClaim.id });
    const contradictionPass = await runKnowledgeBackgroundPass({
      pool,
      canonical: store,
      experiences: memory,
      limits: { maxItems: 1, maxContradictionInspections: 4, maxLineageDepth: 4 },
    });
    assert(contradictionPass.itemsInspected === 1 && contradictionPass.escalationsCreated === 1, "contradiction produces one bounded escalation");
    await store.markContradiction({ fromId: dependentClaim.id, toId: alternativeClaim.id });
    const contradictionWork = (await store.listBackgroundWork({ kind: "claim_reconsideration" }))
      .filter((item) => item.payload.edgeId === contradiction.id);
    assert(contradictionWork.length === 1 && contradictionWork[0]!.status === "escalated", "stable work key prevents duplicate escalation");
    observer.emit({
      ts: new Date().toISOString(),
      kind: "background",
      background: observeBackgroundPass("wp6-escalation-pass", contradictionPass, {
        workIds: [contradictionWork[0]!.id],
        work: [{
          id: contradictionWork[0]!.id,
          kind: contradictionWork[0]!.kind,
          status: contradictionWork[0]!.status,
          sourceEventId: contradictionWork[0]!.sourceEventId,
          targetId: contradictionWork[0]!.targetNodeId,
        }],
      }),
    });
    assert(
      observer.events.at(-1)?.background?.workIds[0] === contradictionWork[0]!.id &&
        observer.events.at(-1)?.background?.escalationsCreated === 1,
      "bounded escalation remains inspectable by stable work ID"
    );
    const finalIdle = await runKnowledgeBackgroundPass({ pool, canonical: store, experiences: memory });
    assert(finalIdle.itemsInspected === 0 && finalIdle.escalationsCreated === 0, "escalation does not become recursive background reasoning");

    console.log("WP6 background cognition smoke passed.");
  } finally {
    memory.close();
    await pool.end();
    await runtime.dispose();
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${memoryPath}${suffix}`;
      if (existsSync(path)) rmSync(path, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

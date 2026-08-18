import {
  createHybridKnowledgeRetrievalService, createKnowledgePostgresPool, createKnowledgeStore, endKnowledgePostgresPool,
  createNeo4jGraphRepository, createPostgresVectorRepository, KNOWLEDGE_VECTOR_DIMENSION,
  rebuildGraphProjection, resolvePostgresKnowledgeConfig, type GraphRepository,
  type SemanticVectorRecord, type VectorRepository,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";
import { startKnowledgeNeo4jTest } from "./knowledge-neo4j-test-runtime.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`ASSERT: ${message}`); }
function vector(...values: Array<[number, number]>): number[] { const result = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0); for (const [index, value] of values) result[index] = value; return result; }
async function node(store: ReturnType<typeof createKnowledgeStore>, eventId: string, type: string, label: string, workspaceId?: string | null) { const before = new Set((await store.findNodes({ type, label, status: "accepted", limit: 100 })).map((item) => item.id)); const proposal = (await store.addProposals(eventId, [{ kind: "node", payload: { type, label, workspaceId } }]))[0]; await store.acceptProposal(proposal.id); return (await store.findNodes({ type, label, status: "accepted", limit: 100 })).find((item) => !before.has(item.id))!; }
async function edge(store: ReturnType<typeof createKnowledgeStore>, eventId: string, fromId: string, relation: string, toId: string) { const proposal = (await store.addProposals(eventId, [{ kind: "edge", payload: { fromId, relation, toId } }]))[0]; await store.acceptProposal(proposal.id); }

async function main(): Promise<void> {
  const postgresRuntime = await startKnowledgePostgresTest(); const neo4jRuntime = await startKnowledgeNeo4jTest();
  const base = resolvePostgresKnowledgeConfig(); const pool = createKnowledgePostgresPool({ ...base, connectionString: postgresRuntime.connectionString, applicationName: `${base.applicationName}-hybrid-test` });
  const canonical = createKnowledgeStore({ postgresConfig: { ...base, connectionString: postgresRuntime.connectionString }, pool });
  const graph = createNeo4jGraphRepository(neo4jRuntime.config); const vectors = createPostgresVectorRepository({ ...base, connectionString: postgresRuntime.connectionString, pool });
  try {
    let health = await graph.healthCheck(); for (let attempt = 0; !health.ok && attempt < 60; attempt++) { await new Promise((resolve) => setTimeout(resolve, 1000)); health = await graph.healthCheck(); } assert(health.ok, "Neo4j hybrid test runtime health");
    const event = await canonical.createEvent({ sourceType: "file", sourceRef: "hybrid-fixture.md" });
    const project = await node(canonical, event.id, "project", "Thermal project", "workspace-a");
    const alpha = await node(canonical, event.id, "idea", "Thermal control", "workspace-a");
    const beta = await node(canonical, event.id, "concept", "Cooling loop", "workspace-a");
    const deep = await node(canonical, event.id, "artifact", "Heat sink", "workspace-a");
    const global = await node(canonical, event.id, "concept", "Global thermal principle", null);
    const outside = await node(canonical, event.id, "idea", "Unrelated workspace thermal", "workspace-b");
    const sameA = await node(canonical, event.id, "artifact", "Motor", "workspace-a"); const sameB = await node(canonical, event.id, "artifact", "Motor", "workspace-a");
    const source = await node(canonical, event.id, "source", "hybrid-fixture.md", "workspace-a");
    const bridgeRoot = await node(canonical, event.id, "concept", "Bridge root", "workspace-a"); const bridgeB = await node(canonical, event.id, "concept", "Bridge B", "workspace-a"); const bridgeC = await node(canonical, event.id, "concept", "Bridge C", "workspace-a"); const staleNode = await node(canonical, event.id, "concept", "Soon disputed", "workspace-a");
    await edge(canonical, event.id, project.id, "about", alpha.id); await edge(canonical, event.id, alpha.id, "requires", beta.id); await edge(canonical, event.id, beta.id, "part_of", deep.id); await edge(canonical, event.id, alpha.id, "uses", global.id); await edge(canonical, event.id, alpha.id, "cross_workspace", outside.id);
    await edge(canonical, event.id, bridgeRoot.id, "requires", bridgeB.id); await edge(canonical, event.id, bridgeB.id, "requires", bridgeC.id); await edge(canonical, event.id, alpha.id, "about", staleNode.id);
    const provenance = await canonical.addProposals(event.id, [
      { kind: "evidence", payload: { targetId: alpha.id, sourceId: source.id, stance: "supports", excerpt: "Source supports thermal control" } },
      { kind: "observation", payload: { targetId: alpha.id, sourceId: source.id, observationKind: "references", observationMetadata: { section: 2 } } },
    ]); for (const proposal of provenance) await canonical.acceptProposal(proposal.id);
    await rebuildGraphProjection({ canonical, graph, pageSize: 2 });
    const staleBridge = await pool.query<{ id: string }>("DELETE FROM knowledge_edges WHERE from_node_id = $1 AND to_node_id = $2 RETURNING id::text", [bridgeRoot.id, bridgeB.id]); assert(staleBridge.rowCount === 1, "stale bridge fixture removes canonical edge only");
    await pool.query("UPDATE knowledge_nodes SET status = 'disputed' WHERE id = $1", [staleNode.id]);
    const now = Date.now(); const records: Array<[string, number[], string, string | null]> = [
      [alpha.id, vector([0, 1]), "idea", "workspace-a"], [beta.id, vector([0, 0.85], [1, 0.15]), "concept", "workspace-a"],
      [deep.id, vector([0, 0.6], [2, 0.4]), "artifact", "workspace-a"], [outside.id, vector([0, 0.99], [3, 0.01]), "idea", "workspace-b"],
      [global.id, vector([0, 0.98], [6, 0.02]), "concept", null],
      [sameA.id, vector([4, 1]), "artifact", "workspace-a"], [sameB.id, vector([4, 0.99], [5, 0.01]), "artifact", "workspace-a"],
    ];
    for (const [canonicalId, embedding, entityType, workspaceId] of records) { const record: SemanticVectorRecord = { id: randomUUID(), canonicalId, vector: embedding, dimension: KNOWLEDGE_VECTOR_DIMENSION, model: "hybrid-fixture", modelVersion: "v1", entityType, workspaceId, createdAt: now, updatedAt: now }; await vectors.upsert(record); }
    const service = createHybridKnowledgeRetrievalService({ canonical, graph, vector: vectors });

    const exact = await createHybridKnowledgeRetrievalService({ canonical }).retrieve({ canonicalIds: [alpha.id], overallLimit: 2 });
    assert(exact.items.length === 1 && exact.items[0].node.id === alpha.id && exact.strategies.graph.state === "unavailable" && exact.strategies.semantic.state === "unavailable", "exact retrieval requires neither graph nor vector");
    const semantic = await service.retrieve({ queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", semanticLimit: 3, overallLimit: 3 });
    assert(semantic.items[0].node.id === alpha.id && semantic.items[0].semanticScore != null && semantic.items.every((item) => item.node.id), "semantic retrieval returns hydrated canonical IDs and scores");
    const graphOnly = await service.retrieve({ graphRootIds: [alpha.id], graphHops: 2, overallLimit: 10 });
    assert(graphOnly.items.some((item) => item.node.id === deep.id) && graphOnly.edges.some((item) => item.relation === "part_of"), "graph-root retrieval returns multi-hop canonical topology");
    assert(!graphOnly.items.some((item) => item.node.id === staleNode.id) && graphOnly.edges.every((item) => item.fromNodeId !== staleNode.id && item.toNodeId !== staleNode.id), "stale disputed Neo4j node and its edge never influence hybrid output");
    const bridgeResult = await service.retrieve({ graphRootIds: [bridgeRoot.id], graphHops: 2, overallLimit: 10 }); assert(bridgeResult.items.some((item) => item.node.id === bridgeRoot.id) && !bridgeResult.items.some((item) => item.node.id === bridgeB.id || item.node.id === bridgeC.id) && !bridgeResult.edges.some((item) => item.id === staleBridge.rows[0].id), "canonical validation removes a stale bridge and recomputed reachability prevents downstream graph origin");
    const narrowed = await service.retrieve({ projectId: project.id, graphHops: 2, queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", workspaceId: "workspace-a", semanticLimit: 5, overallLimit: 5 });
    assert(narrowed.strategies.graph.state === "ran" && narrowed.strategies.semantic.state === "ran" && narrowed.items.some((item) => item.node.id === global.id) && !narrowed.items.some((item) => item.node.id === outside.id), "graph/project scope preserves global visibility while excluding another workspace during vector narrowing");
    const workspaceExact = await service.retrieve({ canonicalIds: [global.id, outside.id], workspaceId: "workspace-a", overallLimit: 5 });
    const workspaceGraph = await service.retrieve({ graphRootIds: [alpha.id], graphHops: 1, workspaceId: "workspace-a", overallLimit: 10 });
    const workspaceVector = await service.retrieve({ candidateCanonicalIds: [global.id, outside.id], queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", workspaceId: "workspace-a", overallLimit: 5 });
    assert(workspaceExact.items.some((item) => item.node.id === global.id) && !workspaceExact.items.some((item) => item.node.id === outside.id) && workspaceGraph.items.some((item) => item.node.id === global.id) && !workspaceGraph.items.some((item) => item.node.id === outside.id) && workspaceVector.items.some((item) => item.node.id === global.id) && !workspaceVector.items.some((item) => item.node.id === outside.id), "exact, graph and vector retrieval agree on named-workspace global visibility");
    const semanticFirst = await service.retrieve({ queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", semanticLimit: 1, semanticGraphHops: 1, overallLimit: 5 });
    assert(semanticFirst.items.some((item) => item.node.id === beta.id && item.origins.includes("graph")), "semantic discovery supports graph enrichment");
    const hydrated = await service.retrieve({ canonicalIds: [alpha.id], includeEvidence: true, includeObservations: true, includeSources: true, evidencePerIdentity: 2, observationsPerIdentity: 3, sourcesPerIdentity: 2, contextBudget: 100 });
    const hydratedAlpha = hydrated.items[0]; assert(hydratedAlpha.evidence[0]?.sourceEventId === event.id && hydratedAlpha.evidence[0]?.sourceNodeId === source.id && hydratedAlpha.observations.some((item) => item.sourceEventId === event.id && item.sourceNodeId === source.id) && hydratedAlpha.sources[0]?.id === source.id && hydratedAlpha.events[0]?.sourceRef === "hybrid-fixture.md", "evidence/observation source and event provenance remain attributable");
    const sameLabel = await service.retrieve({ candidateCanonicalIds: [sameA.id, sameB.id], queryVector: vector([4, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", overallLimit: 5 });
    assert(sameLabel.items.filter((item) => item.node.label === "Motor").length === 2 && new Set(sameLabel.items.map((item) => item.node.id)).size === 2, "same-label identities remain distinct retrieval results");
    const bounded = await service.retrieve({ graphRootIds: [alpha.id], graphHops: 1, overallLimit: 2, maxEdges: 1, contextBudget: 20 });
    assert(bounded.items.length <= 2 && bounded.edges.length <= 1 && !bounded.items.some((item) => item.node.id === deep.id) && bounded.bounds.budgetUsed <= 20, "result, hop, edge and context bounds are honored");

    const graphUnavailable = await createHybridKnowledgeRetrievalService({ canonical, vector: vectors }).retrieve({ canonicalIds: [alpha.id], queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1", overallLimit: 3 });
    assert(graphUnavailable.strategies.graph.state === "unavailable" && graphUnavailable.strategies.semantic.state === "ran", "unavailable graph degrades to exact plus semantic retrieval");
    const vectorUnavailable = await createHybridKnowledgeRetrievalService({ canonical, graph }).retrieve({ graphRootIds: [alpha.id], graphHops: 1, overallLimit: 5 });
    assert(vectorUnavailable.strategies.semantic.state === "unavailable" && vectorUnavailable.strategies.graph.state === "ran" && vectorUnavailable.items.some((item) => item.node.id === beta.id), "unavailable vector degrades to graph plus canonical retrieval");
    const fakeVector = { async search() { return [{ record: { canonicalId: randomUUID() }, score: 1 }]; } } as unknown as VectorRepository;
    const unattributed = await createHybridKnowledgeRetrievalService({ canonical, vector: fakeVector }).retrieve({ queryVector: vector([0, 1]), embeddingModel: "fake", embeddingModelVersion: "v1" });
    assert(unattributed.items.length === 0, "unattributed vector object cannot become a retrieval result without canonical hydration");
    const failingGraph = { async expand() { throw new Error("graph unavailable fixture"); } } as unknown as GraphRepository;
    const degraded = await createHybridKnowledgeRetrievalService({ canonical, graph: failingGraph, vector: vectors }).retrieve({ canonicalIds: [alpha.id], graphRootIds: [alpha.id], queryVector: vector([0, 1]), embeddingModel: "hybrid-fixture", embeddingModelVersion: "v1" });
    assert(degraded.items[0]?.node.id === alpha.id && degraded.strategies.graph.state === "degraded" && degraded.strategies.semantic.state === "skipped", "failed graph reports degradation and refuses unsafe global semantic widening");
    console.log("Hybrid canonical/graph/pgvector retrieval checks passed.");
  } finally { await graph.close(); await vectors.close(); await endKnowledgePostgresPool(pool); await neo4jRuntime.dispose(); await postgresRuntime.dispose(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

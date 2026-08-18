import {
  createKnowledgePostgresPool, createKnowledgeStore, createNeo4jGraphRepository, createPostgresVectorRepository, endKnowledgePostgresPool,
  KNOWLEDGE_VECTOR_DIMENSION, processGraphProjectionOutbox, processVectorProjectionOutbox,
  rebuildGraphProjection, rebuildSemanticVectorProjection, resolvePostgresKnowledgeConfig, semanticVectorRecordId,
  type CanonicalKnowledgeRepository, type GraphRepository, type KnowledgeEdge, type KnowledgeNode, type SemanticEmbeddingProvider,
} from "@workflows/knowledge";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";
import { startKnowledgeNeo4jTest } from "./knowledge-neo4j-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`ASSERT: ${message}`); }
const embedder: SemanticEmbeddingProvider = { model: "graph-fixture", modelVersion: "v1", dimension: KNOWLEDGE_VECTOR_DIMENSION, async embed(texts) { return texts.map((text) => { const vector = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0); vector[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 32] = 1; return vector; }); } };

async function acceptedNode(store: ReturnType<typeof createKnowledgeStore>, eventId: string, type: string, label: string, workspaceId?: string) {
  const before = new Set((await store.findNodes({ type, label, status: "accepted", limit: 1000 })).map((item) => item.id));
  const proposal = (await store.addProposals(eventId, [{ kind: "node", payload: { type, label, workspaceId } }]))[0]; await store.acceptProposal(proposal.id);
  return (await store.findNodes({ type, label, status: "accepted", limit: 1000 })).find((item) => !before.has(item.id))!;
}
async function acceptedEdge(store: ReturnType<typeof createKnowledgeStore>, eventId: string, fromId: string, relation: string, toId: string) {
  const proposal = (await store.addProposals(eventId, [{ kind: "edge", payload: { fromId, relation, toId } }]))[0]; await store.acceptProposal(proposal.id);
  return (await store.getNeighborhood(fromId, { hops: 1, status: "accepted" })).edges.find((item) => item.fromNodeId === fromId && item.toNodeId === toId && item.relation === relation)!;
}

async function verifyGraphRebuildBeyondLegacyLimit(): Promise<void> {
  const total = 100_001; let replaced = 0;
  const canonical = { async *scanAcceptedTopology(options: { pageSize?: number } = {}) { const size = options.pageSize ?? 1000; for (let offset = 0; offset < total; offset += size) { const nodes: KnowledgeNode[] = []; for (let index = offset; index < Math.min(total, offset + size); index++) nodes.push({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "fixture", label: `node-${index}`, status: "accepted", createdAt: index, updatedAt: index }); yield { nodes }; } } } as unknown as CanonicalKnowledgeRepository;
  const graph = { async replaceAcceptedProjection(input: { nodes: KnowledgeNode[] }) { replaced = input.nodes.length; } } as unknown as GraphRepository;
  const result = await rebuildGraphProjection({ canonical, graph, pageSize: 991 });
  assert(result.nodes === total && replaced === total, "graph rebuild exceeds the former 100,000-record ceiling");
}

async function main(): Promise<void> {
  await verifyGraphRebuildBeyondLegacyLimit();
  const postgresRuntime = await startKnowledgePostgresTest(); const neo4jRuntime = await startKnowledgeNeo4jTest();
  const base = resolvePostgresKnowledgeConfig(); const pool = createKnowledgePostgresPool({ ...base, connectionString: postgresRuntime.connectionString, applicationName: `${base.applicationName}-graph-test` });
  const canonical = createKnowledgeStore({ postgresConfig: { ...base, connectionString: postgresRuntime.connectionString }, pool });
  const graph = createNeo4jGraphRepository(neo4jRuntime.config);
  const vectors = createPostgresVectorRepository({ ...base, connectionString: postgresRuntime.connectionString, pool });
  try {
    let health = await graph.healthCheck();
    for (let attempt = 0; !health.ok && attempt < 60; attempt++) { await new Promise((resolve) => setTimeout(resolve, 1000)); health = await graph.healthCheck(); }
    assert(health.ok, `Neo4j graph runtime health: ${health.detail ?? "unknown"}`);
    const event = await canonical.createEvent({ sourceType: "manual", sourceRef: "graph-integration" });
    const alpha = await acceptedNode(canonical, event.id, "concept", "Alpha", "workspace-a");
    const beta = await acceptedNode(canonical, event.id, "concept", "Beta", "workspace-a");
    const gamma = await acceptedNode(canonical, event.id, "artifact", "Gamma", "workspace-a");
    const other = await acceptedNode(canonical, event.id, "concept", "Other workspace", "workspace-b");
    const sameA = await acceptedNode(canonical, event.id, "artifact", "Motor", "workspace-a");
    const sameB = await acceptedNode(canonical, event.id, "artifact", "Motor", "workspace-a");
    const rejected = await acceptedNode(canonical, event.id, "concept", "Rejected duplicate", "workspace-a");
    const causes = await acceptedEdge(canonical, event.id, alpha.id, "causes", beta.id);
    const limits = await acceptedEdge(canonical, event.id, beta.id, "limits", gamma.id);
    const self = await acceptedEdge(canonical, event.id, alpha.id, "controls", alpha.id);
    await acceptedEdge(canonical, event.id, alpha.id, "cross_workspace", other.id);
    const pending = (await canonical.addProposals(event.id, [{ kind: "edge", payload: { fromId: alpha.id, relation: "pending_relation", toId: gamma.id } }]))[0];
    assert(pending.status === "pending", "pending topology fixture remains pending");
    await canonical.mergeNodes({ fromId: rejected.id, intoId: alpha.id });

    const rebuilt = await rebuildGraphProjection({ canonical, graph, pageSize: 2 });
    const acceptedCounts = await pool.query<{ nodes: number; edges: number }>("SELECT (SELECT count(*)::int FROM knowledge_nodes WHERE status = 'accepted') AS nodes, (SELECT count(*)::int FROM knowledge_edges WHERE status = 'accepted' AND from_node_id IN (SELECT id FROM knowledge_nodes WHERE status = 'accepted') AND to_node_id IN (SELECT id FROM knowledge_nodes WHERE status = 'accepted')) AS edges");
    assert(rebuilt.nodes === acceptedCounts.rows[0].nodes && rebuilt.edges === acceptedCounts.rows[0].edges, "multi-page graph rebuild covers complete eligible canonical topology");
    assert((await graph.getNode(alpha.id))?.id === alpha.id && (await graph.getNode(rejected.id)) === null, "accepted IDs project and rejected identity is excluded");
    assert((await graph.getNode(sameA.id))?.id === sameA.id && (await graph.getNode(sameB.id))?.id === sameB.id && sameA.id !== sameB.id, "same-label identities remain distinct graph nodes");

    const oneHop = await graph.expand(alpha.id, { hops: 1 });
    assert(oneHop.nodes.some((item) => item.id === beta.id) && oneHop.edges.some((item) => item.id === causes.id), "one-hop expansion runs in Neo4j with canonical IDs");
    assert(oneHop.edges.some((item) => item.id === self.id && item.fromNodeId === item.toNodeId), "self-relation survives graph projection");
    const multiHop = await graph.expand(alpha.id, { hops: 2 });
    assert(multiHop.nodes.some((item) => item.id === gamma.id) && multiHop.edges.some((item) => item.id === limits.id), "multi-hop expansion runs in graph engine");
    const relationOnly = await graph.expand(alpha.id, { hops: 2, relation: "causes" });
    assert(relationOnly.edges.length === 1 && relationOnly.edges[0].relation === "causes", "relation filtering preserves exact canonical relation semantics");
    assert((await graph.expand(alpha.id, { hops: 2, relation: "pending_relation" })).edges.length === 0, "pending edge is absent from accepted topology");
    const path = await graph.findPath({ fromCanonicalNodeId: alpha.id, toCanonicalNodeId: gamma.id, maxHops: 3 });
    assert(path?.edges.map((item) => item.relation).join(",") === "causes,limits", "directed shortest path preserves relation direction");
    const scoped = await graph.expand(alpha.id, { hops: 1, workspaceId: "workspace-a" });
    assert(!scoped.nodes.some((item) => item.id === other.id), "workspace filtering excludes another workspace context");

    const oldClaim = await acceptedNode(canonical, event.id, "claim", "Old accepted claim", "workspace-a");
    const newClaim = await acceptedNode(canonical, event.id, "claim", "Replacement claim", "workspace-a");
    await acceptedEdge(canonical, event.id, oldClaim.id, "about", gamma.id);
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    await rebuildSemanticVectorProjection({ canonical, vector: vectors, embedder, pageSize: 2 });
    assert((await graph.getNode(oldClaim.id))?.id === oldClaim.id && await vectors.get(semanticVectorRecordId(oldClaim.id, embedder.model, embedder.modelVersion)) !== null, "accepted claim exists in both projections before supersession");
    await canonical.supersedeClaim({ oldClaimId: oldClaim.id, newClaimId: newClaim.id });
    assert((await canonical.getNode(oldClaim.id))?.status === "disputed", "supersession changes canonical old claim status");
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder, limit: 100 });
    assert(await graph.getNode(oldClaim.id) === null, "disputed superseded claim is removed from accepted graph projection");
    assert(await vectors.get(semanticVectorRecordId(oldClaim.id, embedder.model, embedder.modelVersion)) === null, "disputed superseded claim is removed from vector projection");

    const mergeFrom = await acceptedNode(canonical, event.id, "concept", "Projection merge source", "workspace-a");
    const mergeInto = await acceptedNode(canonical, event.id, "concept", "Projection merge survivor", "workspace-a");
    const mergeEdge = await acceptedEdge(canonical, event.id, mergeFrom.id, "requires", gamma.id);
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 }); await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder, limit: 100 });
    await canonical.mergeNodes({ fromId: mergeFrom.id, intoId: mergeInto.id });
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 }); await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder, limit: 100 });
    assert(await graph.getNode(mergeFrom.id) === null && (await graph.getNode(mergeInto.id))?.id === mergeInto.id, "merge graph projection converges on survivor identity");
    assert((await graph.expand(mergeInto.id, { hops: 1 })).edges.some((item) => item.id === mergeEdge.id && item.fromNodeId === mergeInto.id), "merge rebuild restores rewired canonical topology");
    assert(await vectors.get(semanticVectorRecordId(mergeFrom.id, embedder.model, embedder.modelVersion)) === null && await vectors.get(semanticVectorRecordId(mergeInto.id, embedder.model, embedder.modelVersion)) !== null, "merge vector projection deletes retired identity and retains survivor");

    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    const outboxNode = await acceptedNode(canonical, event.id, "future_type", "Incremental graph node", "workspace-a");
    const incrementalGraph = await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 }); const incrementalVector = await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder, limit: 100 });
    assert(incrementalGraph.processed > 0 && incrementalVector.processed > 0 && (await graph.getNode(outboxNode.id))?.id === outboxNode.id && await vectors.get(semanticVectorRecordId(outboxNode.id, embedder.model, embedder.modelVersion)) !== null, "normal accepted canonical write becomes visible in graph and active vector projections after reconciliation");
    const project = await acceptedNode(canonical, event.id, "project", "Graph delete project", "workspace-a");
    const projectEdge = await canonical.linkToProject({ nodeId: alpha.id, projectId: project.id, relation: "used_in", sourceEventId: event.id });
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    assert((await graph.expand(alpha.id, { hops: 1, relation: "used_in" })).edges.some((item) => item.id === projectEdge.id), "graph outbox incrementally upserts canonical edge");
    assert(await canonical.unlinkFromProject({ nodeId: alpha.id, projectId: project.id }), "canonical edge deletion succeeds");
    await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    assert(!(await graph.expand(alpha.id, { hops: 1, relation: "used_in" })).edges.some((item) => item.id === projectEdge.id), "graph outbox delete removes deleted canonical edge");

    await graph.replaceAcceptedProjection({ nodes: [], edges: [] });
    assert(await graph.getNode(alpha.id) === null, "graph can be wiped independently");
    await rebuildGraphProjection({ canonical, graph, pageSize: 2 });
    assert((await graph.getNode(alpha.id))?.id === alpha.id && (await graph.findPath({ fromCanonicalNodeId: alpha.id, toCanonicalNodeId: gamma.id }))?.edges.length === 2, "full rebuild restores lost topology from PostgreSQL");

    const failureNode = await acceptedNode(canonical, event.id, "idea", "Canonical survives graph failure", "workspace-a");
    const failingGraph = { async upsertNode() { throw new Error("fixture graph failure"); } } as unknown as GraphRepository;
    const failure = await processGraphProjectionOutbox({ pool, canonical, graph: failingGraph, limit: 100 });
    assert(failure.failed > 0 && (await canonical.getNode(failureNode.id))?.status === "accepted", "graph failure does not invalidate canonical PostgreSQL write");
    const failedJob = await pool.query("SELECT last_error, processed_at FROM knowledge_projection_outbox WHERE canonical_id = $1 AND projection = 'graph' ORDER BY created_at DESC LIMIT 1", [failureNode.id]);
    assert(String(failedJob.rows[0]?.last_error).includes("fixture graph failure") && failedJob.rows[0]?.processed_at == null, "failed graph job remains retryable");
    await canonical.mergeNodes({ fromId: failureNode.id, intoId: alpha.id }); await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 }); await pool.query("UPDATE knowledge_projection_outbox SET available_at = now() WHERE canonical_id = $1 AND projection = 'graph' AND processed_at IS NULL", [failureNode.id]); await processGraphProjectionOutbox({ pool, canonical, graph, limit: 100 });
    const remainingOldGraphJobs = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM knowledge_projection_outbox WHERE canonical_id = $1 AND projection = 'graph' AND processed_at IS NULL", [failureNode.id]); assert(remainingOldGraphJobs.rows[0].count === 0 && await graph.getNode(failureNode.id) === null, "newer merge/delete supersedes an older failed graph upsert and prevents resurrection");
    console.log("Neo4j canonical graph projection checks passed.");
  } finally { await graph.close(); await vectors.close(); await endKnowledgePostgresPool(pool); await neo4jRuntime.dispose(); await postgresRuntime.dispose(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

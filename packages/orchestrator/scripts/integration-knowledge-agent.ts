import {
  createHybridKnowledgeRetrievalService, createKnowledgeAgent, createKnowledgePostgresPool,
  createKnowledgeStore, createNeo4jGraphRepository, createPostgresVectorRepository,
  KNOWLEDGE_VECTOR_DIMENSION, rebuildGraphProjection, resolvePostgresKnowledgeConfig,
  type GraphRepository, type KnowledgeAgentAuditEvent, type KnowledgeAgentDecision,
  type KnowledgeAgentModelAdapter, type KnowledgeAgentModelInput, type KnowledgeProposal,
  type SemanticVectorRecord,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";
import { startKnowledgeNeo4jTest } from "./knowledge-neo4j-test-runtime.js";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(`ASSERT: ${message}`); }
function vector(...entries: Array<[number, number]>): number[] { const value = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0); for (const [index, number] of entries) value[index] = number; return value; }
class ScriptedModel implements KnowledgeAgentModelAdapter {
  constructor(private readonly decisions: KnowledgeAgentDecision[], readonly inputs: KnowledgeAgentModelInput[] = []) {}
  async next(input: KnowledgeAgentModelInput): Promise<KnowledgeAgentDecision> { this.inputs.push(input); return this.decisions.shift() ?? { kind: "final", answer: "script complete" }; }
}
const call = (tool: string, args: Record<string, unknown> = {}): KnowledgeAgentDecision => ({ kind: "tool", tool, args });
const done = (answer = "done"): KnowledgeAgentDecision => ({ kind: "final", answer });
async function acceptedNode(store: ReturnType<typeof createKnowledgeStore>, eventId: string, type: string, label: string, workspaceId?: string | null) { const before = new Set((await store.findNodes({ type, label, status: "accepted", limit: 100 })).map((x) => x.id)); const proposal = (await store.addProposals(eventId, [{ kind: "node", payload: { type, label, workspaceId } }]))[0]; await store.acceptProposal(proposal.id); return (await store.findNodes({ type, label, status: "accepted", limit: 100 })).find((x) => !before.has(x.id))!; }
async function acceptedEdge(store: ReturnType<typeof createKnowledgeStore>, eventId: string, fromId: string, relation: string, toId: string) { const proposal = (await store.addProposals(eventId, [{ kind: "edge", payload: { fromId, relation, toId } }]))[0]; await store.acceptProposal(proposal.id); }

async function main() {
  const postgresRuntime = await startKnowledgePostgresTest(); const neo4jRuntime = await startKnowledgeNeo4jTest();
  const base = resolvePostgresKnowledgeConfig(); const pool = createKnowledgePostgresPool({ ...base, connectionString: postgresRuntime.connectionString, applicationName: `${base.applicationName}-agent-test` });
  const canonical = createKnowledgeStore({ postgresConfig: { ...base, connectionString: postgresRuntime.connectionString }, pool });
  const graph = createNeo4jGraphRepository(neo4jRuntime.config); const vectors = createPostgresVectorRepository({ ...base, connectionString: postgresRuntime.connectionString, pool });
  try {
    let health = await graph.healthCheck(); for (let i = 0; !health.ok && i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); health = await graph.healthCheck(); } assert(health.ok, "agent graph runtime healthy");
    const event = await canonical.createEvent({ sourceType: "file", sourceRef: "agent-fixture.md" });
    const project = await acceptedNode(canonical, event.id, "project", "Agent project", "workspace-a");
    const idea = await acceptedNode(canonical, event.id, "idea", "Adaptive cooling", "workspace-a");
    const claimA = await acceptedNode(canonical, event.id, "claim", "Cooling reduces temperature", "workspace-a");
    const claimB = await acceptedNode(canonical, event.id, "claim", "Cooling does not reduce temperature", "workspace-a");
    const source = await acceptedNode(canonical, event.id, "source", "agent-fixture.md", null);
    const sameA = await acceptedNode(canonical, event.id, "artifact", "Motor", "workspace-a"); const sameB = await acceptedNode(canonical, event.id, "artifact", "Motor", "workspace-a");
    const highDegree = await acceptedNode(canonical, event.id, "concept", "High degree hub", "workspace-a");
    for (let index = 0; index < 8; index++) { const spoke = await acceptedNode(canonical, event.id, "concept", `Spoke ${index}`, "workspace-a"); await acceptedEdge(canonical, event.id, highDegree.id, "about", spoke.id); }
    await acceptedEdge(canonical, event.id, project.id, "about", idea.id); await acceptedEdge(canonical, event.id, idea.id, "supports", claimA.id); await acceptedEdge(canonical, event.id, claimA.id, "contradicts", claimB.id);
    const provenance = await canonical.addProposals(event.id, [{ kind: "evidence", payload: { targetId: claimA.id, sourceId: source.id, stance: "supports", excerpt: "fixture support" } }, { kind: "observation", payload: { targetId: claimA.id, sourceId: source.id, observationKind: "mentions" } }]); for (const p of provenance) await canonical.acceptProposal(p.id);
    await rebuildGraphProjection({ canonical, graph, pageSize: 2 });
    const now = Date.now(); for (const [id, embedding, type, workspaceId] of [[idea.id, vector([0, 1]), "idea", "workspace-a"], [claimA.id, vector([0, .9], [1, .1]), "claim", "workspace-a"], [sameA.id, vector([2, 1]), "artifact", "workspace-a"], [sameB.id, vector([2, .99], [3, .01]), "artifact", "workspace-a"]] as Array<[string, number[], string, string | null]>) { const record: SemanticVectorRecord = { id: randomUUID(), canonicalId: id, vector: embedding, dimension: KNOWLEDGE_VECTOR_DIMENSION, model: "agent-fixture", modelVersion: "v1", entityType: type, workspaceId, createdAt: now, updatedAt: now }; await vectors.upsert(record); }
    const retrieval = createHybridKnowledgeRetrievalService({ canonical, graph, vector: vectors }); const audit: KnowledgeAgentAuditEvent[] = [];
    const run = async (mode: "navigator" | "curator", decisions: KnowledgeAgentDecision[], limits = {}) => { const model = new ScriptedModel(decisions); const agent = createKnowledgeAgent({ canonical, graph, vector: vectors, retrieval, model, auditor: { emit: (e) => audit.push(e) } }); return { result: await agent.run({ goal: "fixture goal", mode, limits }), model, agent }; };

    const resolved = await run("navigator", [call("knowledge.resolve_entity", { canonicalId: idea.id }), done()]); assert(resolved.result.canonicalIds.includes(idea.id), "Navigator resolves canonical identity through controlled tool");
    const hybrid = await run("navigator", [call("knowledge.retrieve", { graphRootIds: [project.id], queryVector: vector([0, 1]), embeddingModel: "agent-fixture", embeddingModelVersion: "v1", includeEvidence: true, overallLimit: 5 }), done()]); assert(hybrid.result.steps[0].result.strategies?.graph && hybrid.result.steps[0].result.strategies?.semantic, "Navigator performs bounded hybrid retrieval");
    const topology = await run("navigator", [call("knowledge.graph_expand", { canonicalId: project.id, hops: 2 }), call("knowledge.find_path", { fromId: project.id, toId: claimA.id, maxHops: 3 }), done()]); assert(topology.result.canonicalIds.includes(claimA.id), "Navigator expands neighborhood and finds path");
    const trace = await run("navigator", [call("knowledge.get_evidence", { canonicalId: claimA.id }), call("knowledge.get_observations", { canonicalId: claimA.id }), call("knowledge.get_sources", { canonicalId: claimA.id }), done()]); assert(trace.result.canonicalIds.includes(source.id), "Navigator retrieves evidence, observations and source provenance");
    assert(!resolved.agent.listTools("navigator").some((x) => x.name.includes("sql") || x.name.includes("cypher") || x.name.includes("accept") || x.name.includes("merge")), "Navigator receives no raw backend, approval or merge tools");

    const degradedGraphModel = new ScriptedModel([call("knowledge.retrieve", { canonicalIds: [idea.id], graphRootIds: [idea.id] }), done()]); const failingGraph = { async expand() { throw new Error("graph fixture unavailable"); } } as unknown as GraphRepository;
    const degradedGraph = await createKnowledgeAgent({ canonical, graph: failingGraph, vector: vectors, retrieval: createHybridKnowledgeRetrievalService({ canonical, graph: failingGraph, vector: vectors }), model: degradedGraphModel }).run({ goal: "degrade" }); assert(degradedGraph.canonicalIds.includes(idea.id) && degradedGraph.degradedDependencies.includes("graph"), "graph degradation retains canonical retrieval and is reported");
    const noVector = await createKnowledgeAgent({ canonical, graph, retrieval: createHybridKnowledgeRetrievalService({ canonical, graph }), model: new ScriptedModel([call("knowledge.retrieve", { canonicalIds: [idea.id], graphRootIds: [idea.id] }), done()]) }).run({ goal: "no vector" }); assert(noVector.canonicalIds.includes(idea.id), "vector unavailable degrades to canonical plus graph");

    const curated = await run("curator", [call("knowledge.propose_entity", { type: "artifact", label: "Pending actuator" }), call("knowledge.propose_claim", { label: "Pending claim" }), call("knowledge.propose_relation", { fromId: idea.id, relation: "about", toId: project.id }), done()]); assert(curated.result.proposalIds.length === 3 && (await canonical.listProposals({ status: "pending" })).filter((p) => curated.result.proposalIds.includes(p.id)).length === 3, "Curator creates pending entity, claim and relation proposals only"); assert(!(await canonical.findNodes({ label: "Pending actuator", status: "accepted" })).length, "Curator proposal is not permanent before separate approval"); await canonical.acceptProposal(curated.result.proposalIds[0]); assert((await canonical.findNodes({ label: "Pending actuator", status: "accepted" })).length === 1, "separate approval can materialize proposal");
    const globalAliases = canonical.listAliases.bind(canonical); canonical.listAliases = async () => { throw new Error("global alias enumeration forbidden in duplicate inspection"); };
    const identity = await run("curator", [call("knowledge.inspect_duplicates", { label: "Motor", type: "artifact" }), call("knowledge.propose_merge", { fromId: sameA.id, intoId: sameB.id, rationale: "review" }), done()]); canonical.listAliases = globalAliases; assert((identity.result.steps[0].result.data as { autoMerged: boolean }).autoMerged === false && (await canonical.getNode(sameA.id))?.status === "accepted", "duplicate inspection uses bounded alias hydration and never auto-merges"); const mergeProposal = (await canonical.listProposals({ status: "pending" })).find((p) => identity.result.proposalIds.includes(p.id)); assert(mergeProposal?.kind === "merge", "Curator proposes merge without executing it");
    const supersede = await run("curator", [call("knowledge.propose_supersede", { oldClaimId: claimA.id, newClaimId: claimB.id }), done()]); assert((await canonical.getNode(claimA.id))?.status === "accepted" && supersede.result.proposalIds.length === 1, "Curator proposes supersession without executing it");
    const conflicts = await run("curator", [call("knowledge.inspect_conflicts", { canonicalId: claimA.id }), done()]); const conflictData = conflicts.result.steps[0].result.data as { contradictions: unknown[] }; assert(conflictData.contradictions.length === 1 && conflicts.result.canonicalIds.includes(claimB.id), "contradiction inspection returns canonical IDs without arbitration");
    const maintenance = await run("curator", [call("knowledge.inspect_structure", { canonicalIds: [source.id, randomUUID()] }), done()]); const maintenanceData = maintenance.result.steps[0].result.data as { inspected: number; conservative: boolean; issues: unknown[] }; assert(maintenanceData.inspected === 2 && maintenanceData.conservative && maintenanceData.issues.length <= 20, "maintenance inspection is bounded and conservative");
    const boundedConflictInspection = await run("curator", [call("knowledge.inspect_conflicts", { canonicalId: highDegree.id }), done()], { maxResults: 3 }); const boundedConflictData = boundedConflictInspection.result.steps[0].result.data as { complete: boolean; truncated: boolean }; assert(!boundedConflictData.complete && boundedConflictData.truncated, "high-degree conflict inspection reports incomplete bounded topology");
    const boundedStructureInspection = await run("curator", [call("knowledge.inspect_structure", { canonicalIds: [highDegree.id] }), done()], { maxResults: 3 }); const boundedStructureData = boundedStructureInspection.result.steps[0].result.data as { complete: boolean; issues: Array<{ issue: string }> }; assert(!boundedStructureData.complete && boundedStructureData.issues.some((issue) => issue.issue === "topology_inspection_incomplete") && !boundedStructureData.issues.some((issue) => issue.issue === "isolated_review_candidate"), "truncated high-degree topology is never interpreted as isolated");
    const isolatedStructureInspection = await run("curator", [call("knowledge.inspect_structure", { canonicalIds: [source.id] }), done()], { maxResults: 3 }); const isolatedStructureData = isolatedStructureInspection.result.steps[0].result.data as { complete: boolean; issues: Array<{ issue: string }> }; assert(isolatedStructureData.complete && isolatedStructureData.issues.some((issue) => issue.issue === "isolated_review_candidate"), "complete topology still identifies an actually isolated node");
    const bounded = await run("navigator", [call("knowledge.get_node", { canonicalId: idea.id }), call("knowledge.get_node", { canonicalId: claimA.id }), done()], { maxToolCalls: 1 }); assert(bounded.result.hitToolLimit && bounded.result.steps.length === 1, "tool-call limit is enforced");
    const proposalBound = await run("curator", [call("knowledge.propose_claim", { label: "Bound one" }), call("knowledge.propose_claim", { label: "Bound two" }), done()], { maxProposals: 1 }); assert(proposalBound.result.proposalIds.length === 1 && !proposalBound.result.steps[1].result.ok, "proposal count limit is enforced");
    const sameLabelNav = await run("navigator", [call("knowledge.retrieve", { canonicalIds: [sameA.id, sameB.id], overallLimit: 5 }), done()]); assert(sameLabelNav.result.canonicalIds.includes(sameA.id) && sameLabelNav.result.canonicalIds.includes(sameB.id), "same-label distinct identities remain distinct in agent navigation");
    assert(audit.some((e) => e.phase === "start") && audit.some((e) => e.phase === "tool" && e.canonicalIds?.length) && audit.some((e) => e.phase === "finish"), "audit records run/mode, tools, canonical IDs and outcome without prompts");
    await canonical.acceptProposal(mergeProposal.id); assert((await canonical.getNode(sameA.id))?.status === "rejected", "separate approval executes a pending merge transactionally");
    await canonical.acceptProposal(supersede.result.proposalIds[0]); assert((await canonical.getNode(claimA.id))?.status === "disputed", "separate approval executes pending supersession");
    const staleTopology = await run("navigator", [call("knowledge.graph_expand", { canonicalId: project.id, hops: 3 }), call("knowledge.find_path", { fromId: project.id, toId: claimA.id, maxHops: 3 }), done()]);
    assert(!staleTopology.result.steps[0].result.canonicalIds?.includes(claimA.id), "stale Neo4j node is excluded after canonical status mutation");
    assert(!staleTopology.result.steps[1].result.ok && !(staleTopology.result.steps[1].result.data as { path?: unknown }).path, "canonically invalid stale Neo4j path fails closed");
    await pool.query("ALTER TABLE knowledge_proposals DROP CONSTRAINT knowledge_proposals_kind_check");
    const unknown = (await canonical.addProposals(event.id, [{ kind: "unknown" as KnowledgeProposal["kind"], payload: { oldClaimId: claimA.id, newClaimId: claimB.id } }]))[0];
    let unknownRejected = false;
    try { await canonical.acceptProposal(unknown.id); } catch (error) { unknownRejected = error instanceof Error && error.message.includes("unsupported proposal kind unknown"); }
    assert(unknownRejected, "unknown proposal kinds fail closed instead of dispatching to supersession");
    assert((await canonical.listProposals({ status: "pending" })).some((proposal) => proposal.id === unknown.id), "failed unknown proposal remains pending after rollback");
    console.log("Knowledge Agent controlled navigation/curation checks passed.");
  } finally { await graph.close(); await vectors.close(); await pool.end(); await neo4jRuntime.dispose(); await postgresRuntime.dispose(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

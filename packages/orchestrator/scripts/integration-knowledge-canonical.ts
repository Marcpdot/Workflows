import {
  createKnowledgePostgresPool,
  createKnowledgeStore,
  loadKnowledgeMigrations,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function databaseUrl(source: string, database: string): string {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main(): Promise<void> {
  const base = resolvePostgresKnowledgeConfig();
  const database = `workflows_canonical_${randomUUID().replaceAll("-", "")}`;
  assert(/^workflows_canonical_[a-f0-9]+$/.test(database), "safe database name");
  const admin = createKnowledgePostgresPool({
    ...base,
    connectionString: databaseUrl(base.connectionString, "postgres"),
    applicationName: `${base.applicationName}-identity-admin`,
  });
  let pool: ReturnType<typeof createKnowledgePostgresPool> | undefined;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const config = {
      ...base,
      connectionString: databaseUrl(base.connectionString, database),
      applicationName: `${base.applicationName}-identity`,
    };
    pool = createKnowledgePostgresPool(config);
    await runKnowledgeMigrations(pool, await loadKnowledgeMigrations(config.migrationsDir));
    const repository = createKnowledgeStore({ postgresConfig: config, pool });
    assert(repository.backend === "postgresql", "PostgreSQL is the canonical factory backend");

    const event = await repository.createEvent({ sourceType: "manual", sourceRef: "identity-round" });
    const sameLabel = await repository.addProposals(event.id, [
      { kind: "node", payload: { type: "artifact", label: "Motor", description: "left drive motor" } },
      { kind: "node", payload: { type: "artifact", label: "Motor", description: "right drive motor" } },
    ]);
    for (const item of sameLabel) await repository.acceptProposal(item.id);
    const motors = await repository.findNodes({ type: "artifact", label: "Motor", status: "accepted" });
    assert(motors.length === 2 && motors[0].id !== motors[1].id, "same label can represent distinct referents");
    assert(await repository.resolveCanonical({ label: "Motor", type: "artifact" }) === null, "ambiguous label does not silently collapse identity");

    const ideaProposal = (await repository.addProposals(event.id, [
      { kind: "node", payload: { type: "idea", label: "Field-oriented thermal control" } },
    ]))[0];
    await repository.acceptProposal(ideaProposal.id);
    const idea = (await repository.findNodes({ type: "idea", label: "Field-oriented thermal control", status: "accepted" }))[0];
    assert(idea?.id, "future ontology kinds receive canonical identities");
    const observation = await repository.createEvent({ sourceType: "file", sourceRef: "paper.md" });
    const repeated = await repository.addProposals(observation.id, [
      { kind: "node", payload: { type: "idea", label: "Field-oriented thermal control", canonicalId: idea.id } },
      { kind: "evidence", payload: { claimLabel: idea.label, claimId: idea.id, sourceLabel: "paper.md", excerpt: "Independent source supports the same idea", stance: "supports" } },
      { kind: "evidence", payload: { claimLabel: idea.label, claimId: idea.id, sourceLabel: "test-42", excerpt: "Test observation supports the same idea", stance: "supports" } },
    ]);
    for (const item of repeated) await repository.acceptProposal(item.id);
    assert((await repository.findNodes({ type: "idea", label: idea.label, status: "accepted" })).length === 1, "repeated observation reuses explicit canonical identity");
    const evidence = await pool.query<{ count: number; events: number }>(
      `SELECT count(*)::int AS count, count(DISTINCT source_event_id)::int AS events
       FROM knowledge_evidence WHERE claim_node_id = $1`,
      [idea.id]
    );
    assert(evidence.rows[0].count === 2, "observations extend evidence without a second identity");

    const alias = await repository.addAlias({ aliasLabel: "FOC thermal control", canonicalNodeId: idea.id });
    assert((await repository.resolveCanonical({ label: alias.aliasLabel }))?.id === idea.id, "explicit alias resolves terminology to one identity");

    const mergeItems = await repository.addProposals(event.id, [
      { kind: "node", payload: { type: "concept", label: "Thermal regulation idea" } },
      { kind: "node", payload: { type: "concept", label: "Heat control concept" } },
      { kind: "node", payload: { type: "concept", label: "Legitimate recursive system" } },
    ]);
    for (const item of mergeItems) await repository.acceptProposal(item.id);
    const mergeFrom = (await repository.findNodes({ label: "Thermal regulation idea", status: "accepted" }))[0];
    const mergeInto = (await repository.findNodes({ label: "Heat control concept", status: "accepted" }))[0];
    const unrelated = (await repository.findNodes({ label: "Legitimate recursive system", status: "accepted" }))[0];
    const edges = await repository.addProposals(event.id, [
      { kind: "edge", payload: { fromId: mergeFrom.id, relation: "same_as", toId: mergeInto.id } },
      { kind: "edge", payload: { fromId: mergeFrom.id, relation: "controls", toId: mergeFrom.id } },
      { kind: "edge", payload: { fromId: unrelated.id, relation: "controls", toId: unrelated.id } },
    ]);
    for (const item of edges) await repository.acceptProposal(item.id);
    await repository.mergeNodes({ fromId: mergeFrom.id, intoId: mergeInto.id });
    const unrelatedSelfEdge = await pool.query(
      "SELECT id FROM knowledge_edges WHERE from_node_id = $1 AND to_node_id = $1 AND relation = 'controls'",
      [unrelated.id]
    );
    assert(unrelatedSelfEdge.rowCount === 1, "merge preserves unrelated legitimate self-edge");
    const transferredSelfEdge = await pool.query(
      "SELECT id FROM knowledge_edges WHERE from_node_id = $1 AND to_node_id = $1 AND relation = 'controls'",
      [mergeInto.id]
    );
    assert(transferredSelfEdge.rowCount === 1, "merge preserves legitimate self-relation owned by merged identity");
    assert((await repository.getNode(mergeFrom.id))?.status === "rejected", "explicit merge retires duplicate identity with history");
    assert((await repository.resolveCanonical({ label: "Thermal regulation idea" }))?.id === mergeInto.id, "merge alias resolves merged name to survivor");

    const shared = motors[0];
    const projectA = await repository.ensureProject({ label: "Project Alpha", workspaceId: "workspace-a" });
    const projectB = await repository.ensureProject({ label: "Project Beta", workspaceId: "workspace-b" });
    await repository.linkToProject({ nodeId: shared.id, projectId: projectA.id });
    await repository.linkToProject({ nodeId: shared.id, projectId: projectB.id });
    const contexts = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM knowledge_edges WHERE from_node_id = $1 AND relation = 'used_in'",
      [shared.id]
    );
    assert(contexts.rows[0].count === 2, "one canonical identity participates in multiple project/workspace contexts");
    assert((await repository.findNodes({ type: "artifact", label: "Motor", status: "accepted" })).filter((node) => node.id === shared.id).length === 1, "context does not duplicate canonical identity");

    const outbox = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM knowledge_projection_outbox");
    assert(outbox.rows[0].count > 0, "canonical writes retain projection outbox contract");
    console.log("PostgreSQL canonical cutover and identity correctness checks passed.");
  } finally {
    if (pool) await pool.end();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

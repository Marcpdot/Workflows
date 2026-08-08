import {
  createKnowledgePostgresPool,
  createPostgresCanonicalKnowledgeRepository,
  createSqliteKnowledgeRepository,
  importSqliteKnowledge,
  loadKnowledgeMigrations,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
  type CanonicalKnowledgeRepository,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function databaseUrl(source: string, database: string): string {
  const url = new URL(source); url.pathname = `/${database}`; return url.toString();
}

async function exercise(repository: CanonicalKnowledgeRepository, workspaceId: string) {
  const event = await repository.createEvent({ sourceType: "manual", sourceRef: `parity:${workspaceId}`, model: "fixture", inputHash: "parity" });
  const proposals = await repository.addProposals(event.id, [
    { kind: "node", payload: { type: "claim", label: "Copper loss produces heat", workspaceId } },
    { kind: "node", payload: { type: "concept", label: "Heat", workspaceId } },
    { kind: "edge", payload: { from: "Copper loss produces heat", relation: "causes", to: "Heat", confidence: 0.9 } },
    { kind: "evidence", payload: { claimLabel: "Copper loss produces heat", excerpt: "Fixture evidence", stance: "supports" } },
    { kind: "node", payload: { type: "claim", label: "Rejected fixture", workspaceId } },
  ]);
  for (const item of proposals.slice(0, 4)) await repository.acceptProposal(item.id);
  await repository.rejectProposal(proposals[4].id);
  const claim = (await repository.findNodes({ type: "claim", label: "Copper loss", status: "accepted" }))[0];
  const heat = await repository.resolveCanonical({ label: "Heat", type: "concept" });
  assert(claim && heat, "accepted nodes resolve");
  const project = await repository.ensureProject({ label: `Project ${workspaceId}`, workspaceId });
  await repository.linkToProject({ nodeId: claim.id, projectId: project.id, sourceEventId: event.id });
  await repository.linkToProject({ nodeId: claim.id, projectId: project.id, sourceEventId: event.id });
  const alias = await repository.addAlias({ aliasLabel: `Thermal ${workspaceId}`, canonicalNodeId: heat.id });
  assert((await repository.resolveCanonical({ label: alias.aliasLabel }))?.id === heat.id, "alias resolves");
  const competing = (await repository.addProposals(event.id, [{ kind: "node", payload: { type: "claim", label: `Heat is harmless ${workspaceId}`, workspaceId } }]))[0];
  await repository.acceptProposal(competing.id);
  const other = (await repository.findNodes({ type: "claim", label: `Heat is harmless ${workspaceId}`, status: "accepted" }))[0];
  await repository.markContradiction({ fromId: claim.id, toId: other.id, sourceEventId: event.id });
  await repository.supersedeClaim({ oldClaimId: other.id, newClaimId: claim.id });
  const neighborhood = await repository.getNeighborhood(claim.id, { hops: 2, status: "accepted" });
  const projectStatus = await repository.getProjectStatus({ projectId: project.id });
  const subgraph = await repository.getSubgraph({ workspaceId, status: "accepted" });
  return {
    acceptedClaims: (await repository.findNodes({ type: "claim", workspaceId, status: "accepted" })).length,
    rejectedProposals: (await repository.listProposals({ status: "rejected", eventId: event.id })).length,
    aliases: (await repository.listAliases(heat.id)).length,
    contradictions: (await repository.findContradictions({ nodeId: claim.id })).length,
    neighborhoodNodes: neighborhood.nodes.length,
    projectClaims: projectStatus.claims.length,
    subgraphNodes: subgraph.nodes.length,
  };
}

async function main(): Promise<void> {
  const base = resolvePostgresKnowledgeConfig();
  const database = `workflows_canonical_${randomUUID().replaceAll("-", "")}`;
  assert(/^workflows_canonical_[a-f0-9]+$/.test(database), "safe database name");
  const admin = createKnowledgePostgresPool({ ...base, connectionString: databaseUrl(base.connectionString, "postgres"), applicationName: `${base.applicationName}-canonical-admin` });
  let pool: ReturnType<typeof createKnowledgePostgresPool> | undefined;
  const parityPath = join(tmpdir(), `workflows-parity-${randomUUID()}.db`);
  const importPath = join(tmpdir(), `workflows-import-${randomUUID()}.db`);
  let paritySqlite: CanonicalKnowledgeRepository | undefined;
  let importSqlite: CanonicalKnowledgeRepository | undefined;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const config = { ...base, connectionString: databaseUrl(base.connectionString, database), applicationName: `${base.applicationName}-canonical` };
    pool = createKnowledgePostgresPool(config);
    const migrations = await loadKnowledgeMigrations(config.migrationsDir);
    await runKnowledgeMigrations(pool, migrations);

    paritySqlite = createSqliteKnowledgeRepository({ dbPath: parityPath, defaultWorkspaceId: "parity" });
    const postgres = createPostgresCanonicalKnowledgeRepository({ ...config, defaultWorkspaceId: "parity", pool });
    const sqliteResult = await exercise(paritySqlite, "parity");
    const postgresResult = await exercise(postgres, "parity");
    assert(JSON.stringify(postgresResult) === JSON.stringify(sqliteResult), `repository parity ${JSON.stringify({ sqliteResult, postgresResult })}`);
    assert((await postgres.healthCheck()).ok, "PostgreSQL repository health");
    const outbox = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM knowledge_projection_outbox");
    assert(outbox.rows[0].count > 0, "accepted canonical writes enqueue projection work");

    importSqlite = createSqliteKnowledgeRepository({ dbPath: importPath, defaultWorkspaceId: "import" });
    const importedEvent = await importSqlite.createEvent({ sourceType: "file", sourceRef: "fixture.md", inputHash: "fixture-hash" });
    const importedProposals = await importSqlite.addProposals(importedEvent.id, [
      { kind: "node", payload: { type: "concept", label: "Imported canonical ID", workspaceId: "import" } },
      { kind: "node", payload: { type: "claim", label: "Imported claim", workspaceId: "import" } },
      { kind: "edge", payload: { from: "Imported claim", relation: "about", to: "Imported canonical ID" } },
    ]);
    for (const item of importedProposals) await importSqlite.acceptProposal(item.id);
    const importedNode = (await importSqlite.findNodes({ label: "Imported canonical ID", status: "accepted" }))[0];
    const importedAlias = await importSqlite.addAlias({ aliasLabel: "Imported alias", canonicalNodeId: importedNode.id });
    importSqlite.close(); importSqlite = undefined;

    const firstImport = await importSqliteKnowledge({ sqliteDbPath: importPath, postgresConfig: config, pool });
    const secondImport = await importSqliteKnowledge({ sqliteDbPath: importPath, postgresConfig: config, pool });
    assert(JSON.stringify(firstImport) === JSON.stringify(secondImport), "retry reports stable source counts");
    const preserved = await postgres.getNode(importedNode.id);
    assert(preserved?.id === importedNode.id && preserved.label === importedNode.label, "import preserves canonical node ID");
    assert((await postgres.getEvent(importedEvent.id))?.inputHash === "fixture-hash", "import preserves event provenance");
    assert((await postgres.listAliases(importedNode.id))[0]?.id === importedAlias.id, "import preserves alias ID");
    const counts = await pool.query<{ nodes: number; events: number; proposals: number }>(
      `SELECT
        (SELECT count(*)::int FROM knowledge_nodes WHERE workspace_id = 'import') AS nodes,
        (SELECT count(*)::int FROM knowledge_events WHERE id = $1) AS events,
        (SELECT count(*)::int FROM knowledge_proposals WHERE event_id = $1) AS proposals`, [importedEvent.id]
    );
    assert(counts.rows[0].nodes === firstImport.nodes, "retry creates no duplicate nodes");
    assert(counts.rows[0].events === 1 && counts.rows[0].proposals === firstImport.proposals, "retry creates no duplicate provenance/proposals");
    console.log("PostgreSQL canonical repository parity and SQLite import checks passed.");
  } finally {
    paritySqlite?.close(); importSqlite?.close();
    for (const path of [parityPath, importPath]) for (const suffix of ["", "-wal", "-shm"]) if (existsSync(`${path}${suffix}`)) unlinkSync(`${path}${suffix}`);
    if (pool) await pool.end();
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

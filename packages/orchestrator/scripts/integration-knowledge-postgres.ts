import {
  createKnowledgePostgresPool,
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
  const baseConfig = resolvePostgresKnowledgeConfig();
  const database = `workflows_integration_${randomUUID().replaceAll("-", "")}`;
  assert(/^workflows_integration_[a-f0-9]+$/.test(database), "safe test database name");

  const adminPool = createKnowledgePostgresPool({
    ...baseConfig,
    connectionString: databaseUrl(baseConfig.connectionString, "postgres"),
    applicationName: `${baseConfig.applicationName}-integration-admin`,
  });
  let testPool: ReturnType<typeof createKnowledgePostgresPool> | undefined;

  try {
    await adminPool.query(`CREATE DATABASE ${database}`);
    const testConfig = {
      ...baseConfig,
      connectionString: databaseUrl(baseConfig.connectionString, database),
      applicationName: `${baseConfig.applicationName}-integration`,
    };
    testPool = createKnowledgePostgresPool(testConfig);
    const migrations = await loadKnowledgeMigrations(testConfig.migrationsDir);

    const firstRun = await runKnowledgeMigrations(testPool, migrations);
    assert(firstRun.applied.length === migrations.length, "all migrations apply");
    const secondRun = await runKnowledgeMigrations(testPool, migrations);
    assert(secondRun.applied.length === 0, "migration rerun applies nothing");
    assert(
      secondRun.alreadyApplied.length === migrations.length,
      "migration rerun reports every migration as applied"
    );

    const extensions = await testPool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'vector')"
    );
    assert(
      new Set(extensions.rows.map((row) => row.extname)).size === 2,
      "PostGIS and pgvector coexist in one database"
    );

    const event = await testPool.query<{ id: string }>(
      `INSERT INTO knowledge_events (source_type, source_ref)
       VALUES ('manual', 'integration-test') RETURNING id`
    );
    const claimA = await testPool.query<{ id: string }>(
      `INSERT INTO knowledge_nodes
         (type, label, normalized_label, status, workspace_id)
       VALUES ('claim', 'Shared label', 'shared label', 'accepted', 'integration')
       RETURNING id`
    );
    const claimB = await testPool.query<{ id: string }>(
      `INSERT INTO knowledge_nodes
         (type, label, normalized_label, status, workspace_id)
       VALUES ('claim', 'Shared label', 'shared label', 'accepted', 'integration')
       RETURNING id`
    );
    const duplicateKinds = await testPool.query<{ id: string; type: string }>(
      `INSERT INTO knowledge_nodes
         (type, label, normalized_label, status, workspace_id)
       VALUES ('event', 'Shared event', 'shared event', 'accepted', 'integration'),
              ('event', 'Shared event', 'shared event', 'accepted', 'integration'),
              ('source', 'Shared source', 'shared source', 'accepted', 'integration'),
              ('source', 'Shared source', 'shared source', 'accepted', 'integration')
       RETURNING id, type`
    );
    const source = await testPool.query<{ id: string }>(
      `INSERT INTO knowledge_nodes
         (type, label, normalized_label, status, workspace_id)
       VALUES ('source', 'Integration source', 'integration source', 'accepted', 'integration')
       RETURNING id`
    );
    assert(claimA.rows[0].id !== claimB.rows[0].id, "same-label claims retain distinct IDs");
    assert(
      new Set(duplicateKinds.rows.map((row) => row.id)).size === 4,
      "same-label event and source nodes retain distinct IDs"
    );

    await testPool.query(
      `INSERT INTO knowledge_edges
         (from_node_id, relation, to_node_id, source_event_id, status)
       VALUES ($1, 'supports', $2, $3, 'accepted'),
              ($1, 'about', $1, $3, 'accepted')`,
      [claimA.rows[0].id, claimB.rows[0].id, event.rows[0].id]
    );
    await testPool.query(
      `INSERT INTO knowledge_evidence
         (claim_node_id, source_node_id, source_event_id, excerpt, stance)
       VALUES ($1, $2, $3, 'PostgreSQL integration evidence', 'supports')`,
      [claimA.rows[0].id, source.rows[0].id, event.rows[0].id]
    );
    const canonicalRead = await testPool.query<{ evidence_count: number }>(
      `SELECT count(e.id)::int AS evidence_count
       FROM knowledge_nodes n
       JOIN knowledge_evidence e ON e.claim_node_id = n.id
       WHERE n.id = $1 AND n.status = 'accepted'`,
      [claimA.rows[0].id]
    );
    assert(canonicalRead.rows[0].evidence_count === 1, "canonical knowledge round trip");

    await testPool.query(
      `INSERT INTO knowledge_locations (canonical_node_id, geometry)
       VALUES ($1, ST_SetSRID(ST_MakePoint(10.7522, 59.9139), 4326))`,
      [source.rows[0].id]
    );
    const nearby = await testPool.query<{ canonical_node_id: string }>(
      `SELECT canonical_node_id
       FROM knowledge_locations
       WHERE ST_DWithin(
         geometry::geography,
         ST_SetSRID(ST_MakePoint(10.75, 59.91), 4326)::geography,
         1000
       )`
    );
    assert(nearby.rows[0]?.canonical_node_id === source.rows[0].id, "spatial query finds geometry");

    console.log("PostgreSQL/PostGIS/pgvector integration checks passed.");
  } finally {
    if (testPool) await testPool.end();
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database]
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${database}`);
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

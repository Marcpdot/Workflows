import {
  createHybridKnowledgeRetrievalService,
  createKnowledgePostgresPool,
  createKnowledgeStore,
  createPostgresSpatialRepository,
  disposeIsolatedKnowledgeDatabase,
  endKnowledgePostgresPool,
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
         (target_node_id, source_node_id, source_event_id, excerpt, stance)
       VALUES ($1, $2, $3, 'PostgreSQL integration evidence', 'supports')`,
      [claimA.rows[0].id, source.rows[0].id, event.rows[0].id]
    );
    const canonicalRead = await testPool.query<{ evidence_count: number }>(
      `SELECT count(e.id)::int AS evidence_count
       FROM knowledge_nodes n
       JOIN knowledge_evidence e ON e.target_node_id = n.id
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
    await testPool.query("DELETE FROM knowledge_locations WHERE canonical_node_id = $1", [source.rows[0].id]);

    const canonical = createKnowledgeStore({ postgresConfig: testConfig, pool: testPool });
    const spatial = createPostgresSpatialRepository({ ...testConfig, pool: testPool });
    await spatial.upsert({ canonicalId: claimA.rows[0].id, geometry: { type: "Point", coordinates: [10.7522, 59.9139] }, properties: { fixture: true }, updatedAt: Date.now() });
    const repositoryHits = await spatial.withinDistance({ longitude: 10.75, latitude: 59.91, distanceMeters: 1000, workspaceId: "integration", limit: 1 });
    assert(repositoryHits.length === 1 && repositoryHits[0].canonicalId === claimA.rows[0].id && Number.isFinite(repositoryHits[0].distanceMeters), "PostgresSpatialRepository uses bounded PostGIS meter distance and deterministic canonical results");
    const spatialHybrid = await createHybridKnowledgeRetrievalService({ canonical, spatial }).retrieve({ workspaceId: "integration", spatial: { longitude: 10.75, latitude: 59.91, distanceMeters: 1000, limit: 5 } });
    assert(spatialHybrid.items.some((item) => item.node.id === claimA.rows[0].id && item.origins.includes("spatial")), "hybrid spatial discovery canonically hydrates accepted PostgreSQL identity");
    await spatial.delete(claimA.rows[0].id); assert(await spatial.get(claimA.rows[0].id) === null, "spatial repository delete removes the canonical location record");

    console.log("PostgreSQL/PostGIS/pgvector integration checks passed.");
  } finally {
    if (testPool) await endKnowledgePostgresPool(testPool);
    await disposeIsolatedKnowledgeDatabase(adminPool, database);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

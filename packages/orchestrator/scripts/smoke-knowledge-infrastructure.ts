import {
  createSqliteKnowledgeRepository,
  loadKnowledgeMigrations,
  resolveKnowledgeMigrationsDir,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
  type PostgresMigrationClient,
  type PostgresQueryResult,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

class FakeMigrationClient implements PostgresMigrationClient {
  readonly calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
  readonly applied = new Map<string, string>();

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    this.calls.push({ sql, params });
    if (sql.includes("SELECT version, checksum")) {
      return {
        rows: [...this.applied].map(([version, checksum]) => ({
          version,
          checksum,
        })) as Row[],
      };
    }
    if (sql.includes("INSERT INTO knowledge_schema_migrations")) {
      this.applied.set(String(params?.[0]), String(params?.[2]));
    }
    return { rows: [] };
  }
}

async function main(): Promise<void> {
  const config = resolvePostgresKnowledgeConfig({
    KNOWLEDGE_DATABASE_URL: "postgresql://test/db",
    KNOWLEDGE_DATABASE_SSL: "true",
  });
  assert(config.connectionString === "postgresql://test/db", "database URL config");
  assert(config.ssl, "database SSL config");
  assert(config.migrationsDir === resolveKnowledgeMigrationsDir(), "migration path");
  assert(
    resolvePostgresKnowledgeConfig({}).connectionString.includes(":55432/"),
    "conflict-safe local database port"
  );

  const migrations = await loadKnowledgeMigrations(config.migrationsDir);
  assert(migrations.length >= 1, "at least one migration");
  const first = migrations[0];
  assert(first.version === "0001", "ordered migration version");
  for (const required of [
    "CREATE EXTENSION IF NOT EXISTS postgis",
    "CREATE TABLE knowledge_nodes",
    "CREATE TABLE knowledge_edges",
    "CREATE TABLE knowledge_events",
    "CREATE TABLE knowledge_evidence",
    "CREATE TABLE knowledge_proposals",
    "CREATE TABLE knowledge_aliases",
    "CREATE TABLE knowledge_locations",
    "geometry(Geometry, 4326)",
    "CREATE TABLE knowledge_projection_outbox",
  ]) {
    assert(first.sql.includes(required), `migration contains ${required}`);
  }
  assert(first.sql.includes("timestamptz"), "PostgreSQL temporal types");
  assert(first.sql.includes("REFERENCES knowledge_nodes"), "canonical foreign keys");
  assert(
    migrations.some((migration) => migration.sql.includes("CREATE EXTENSION IF NOT EXISTS vector")),
    "pgvector extension migration"
  );

  const client = new FakeMigrationClient();
  const initial = await runKnowledgeMigrations(client, migrations);
  assert(initial.applied.length === migrations.length, "initial migrations applied");
  assert(client.calls.some((call) => call.sql === "BEGIN"), "transaction begins");
  assert(client.calls.some((call) => call.sql === "COMMIT"), "transaction commits");
  assert(
    client.calls.some((call) => call.sql.includes("pg_advisory_lock")),
    "migration lock acquired"
  );

  const rerun = await runKnowledgeMigrations(client, migrations);
  assert(rerun.applied.length === 0, "migration rerun is idempotent");
  assert(
    rerun.alreadyApplied.length === migrations.length,
    "applied versions reported"
  );

  const dbPath = join(tmpdir(), `workflows-contract-${randomUUID()}.db`);
  const sqlite = createSqliteKnowledgeRepository({ dbPath });
  try {
    assert(sqlite.backend === "sqlite", "compatibility adapter identifies backend");
    assert((await sqlite.healthCheck()).ok, "compatibility adapter health");
  } finally {
    sqlite.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${dbPath}${suffix}`;
      if (existsSync(path)) unlinkSync(path);
    }
  }

  console.log("All knowledge infrastructure foundation smoke checks passed.");
}

void main();

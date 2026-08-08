import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PostgresQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PostgresMigrationClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface KnowledgeMigration {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

const MIGRATION_FILE = /^(\d{4,})_([a-z0-9][a-z0-9_-]*)\.sql$/i;
const MIGRATION_LOCK_ID = 8_214_701_932;

export async function loadKnowledgeMigrations(
  migrationsDir: string
): Promise<KnowledgeMigration[]> {
  const entries = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const migrations: KnowledgeMigration[] = [];
  const versions = new Set<string>();
  for (const entry of entries) {
    const match = MIGRATION_FILE.exec(entry.name)!;
    const version = match[1];
    if (versions.has(version)) {
      throw new Error(`Duplicate knowledge migration version ${version}`);
    }
    versions.add(version);
    const sql = await readFile(join(migrationsDir, entry.name), "utf8");
    if (!sql.trim()) {
      throw new Error(`Knowledge migration ${entry.name} is empty`);
    }
    migrations.push({
      version,
      name: entry.name,
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }
  return migrations;
}

export async function runKnowledgeMigrations(
  client: PostgresMigrationClient,
  migrations: readonly KnowledgeMigration[]
): Promise<MigrationResult> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS knowledge_schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    const existing = await client.query<{
      version: string;
      checksum: string;
    }>("SELECT version, checksum FROM knowledge_schema_migrations");
    const checksums = new Map(
      existing.rows.map((row) => [row.version, row.checksum])
    );

    for (const migration of migrations) {
      const priorChecksum = checksums.get(migration.version);
      if (priorChecksum) {
        if (priorChecksum !== migration.checksum) {
          throw new Error(
            `Knowledge migration ${migration.version} checksum changed after apply`
          );
        }
        alreadyApplied.push(migration.version);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO knowledge_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum]
        );
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  }

  return { applied, alreadyApplied };
}

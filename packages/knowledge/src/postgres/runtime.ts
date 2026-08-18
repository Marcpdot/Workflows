import { Pool, type PoolConfig } from "pg";
import type { PostgresKnowledgeConfig } from "./config.js";
import {
  loadKnowledgeMigrations,
  runKnowledgeMigrations,
  type MigrationResult,
} from "./migrations.js";

const endingPools = new WeakSet<Pool>();

/** SQLSTATEs and messages that appear when a backend is terminated on purpose. */
export function isExpectedPostgresAdminShutdown(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | undefined;
  const code = String(record?.code ?? "");
  const message = String(record?.message ?? error ?? "");
  if (
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "08003" ||
    code === "08006" ||
    code === "08001"
  ) {
    return true;
  }
  return (
    /terminating connection due to administrator command/i.test(message) ||
    /connection terminated unexpectedly/i.test(message) ||
    /server closed the connection unexpectedly/i.test(message) ||
    /Client has encountered a connection error and is not queryable/i.test(
      message
    ) ||
    /Connection terminated/i.test(message)
  );
}

function attachIdlePoolErrorHandler(pool: Pool): void {
  pool.on("error", (error) => {
    if (isExpectedPostgresAdminShutdown(error) || endingPools.has(pool)) {
      return;
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code ?? "unknown")
        : "unknown";
    console.error(`[knowledge-pg] idle pool error code=${code}`);
  });
}

export function createKnowledgePostgresPool(
  config: PostgresKnowledgeConfig
): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName,
    max: 10,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  };
  const pool = new Pool(poolConfig);
  attachIdlePoolErrorHandler(pool);
  return pool;
}

/** Mark the pool as shutting down, then wait for every client to close. */
export async function endKnowledgePostgresPool(pool: Pool): Promise<void> {
  endingPools.add(pool);
  try {
    await pool.end();
  } catch (error) {
    if (!isExpectedPostgresAdminShutdown(error)) throw error;
  }
}

/**
 * Terminate leftover backends, drop an isolated test database, then close the
 * admin pool. Work pools must already be ended.
 */
export async function disposeIsolatedKnowledgeDatabase(
  admin: Pool,
  database: string
): Promise<void> {
  endingPools.add(admin);
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [database]
    );
  } catch (error) {
    if (!isExpectedPostgresAdminShutdown(error)) throw error;
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  } catch (error) {
    if (!isExpectedPostgresAdminShutdown(error)) throw error;
  }
  await endKnowledgePostgresPool(admin);
}

export async function migratePostgresKnowledge(
  config: PostgresKnowledgeConfig
): Promise<MigrationResult> {
  const pool = createKnowledgePostgresPool(config);
  const client = await pool.connect();
  try {
    const migrations = await loadKnowledgeMigrations(config.migrationsDir);
    return await runKnowledgeMigrations(client, migrations);
  } finally {
    client.release();
    await endKnowledgePostgresPool(pool);
  }
}

import { Pool, type PoolConfig } from "pg";
import type { PostgresKnowledgeConfig } from "./config.js";
import {
  loadKnowledgeMigrations,
  runKnowledgeMigrations,
  type MigrationResult,
} from "./migrations.js";

export function createKnowledgePostgresPool(
  config: PostgresKnowledgeConfig
): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName,
    max: 10,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  };
  return new Pool(poolConfig);
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
    await pool.end();
  }
}

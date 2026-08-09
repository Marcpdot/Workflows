import {
  createKnowledgePostgresPool,
  loadKnowledgeMigrations,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";

function databaseUrl(source: string, database: string): string {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function startKnowledgePostgresTest(): Promise<{
  connectionString: string;
  dispose(): Promise<void>;
}> {
  const base = resolvePostgresKnowledgeConfig();
  const database = `workflows_smoke_${randomUUID().replaceAll("-", "")}`;
  const admin = createKnowledgePostgresPool({
    ...base,
    connectionString: databaseUrl(base.connectionString, "postgres"),
    applicationName: `${base.applicationName}-smoke-admin`,
  });
  await admin.query(`CREATE DATABASE ${database}`);
  const connectionString = databaseUrl(base.connectionString, database);
  const pool = createKnowledgePostgresPool({
    ...base,
    connectionString,
    applicationName: `${base.applicationName}-smoke`,
  });
  try {
    await runKnowledgeMigrations(
      pool,
      await loadKnowledgeMigrations(base.migrationsDir)
    );
  } finally {
    await pool.end();
  }

  const previous = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.KNOWLEDGE_DATABASE_URL = connectionString;
  return {
    connectionString,
    async dispose() {
      if (previous === undefined) delete process.env.KNOWLEDGE_DATABASE_URL;
      else process.env.KNOWLEDGE_DATABASE_URL = previous;
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [database]
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    },
  };
}

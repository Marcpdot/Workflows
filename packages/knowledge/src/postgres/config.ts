import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PostgresKnowledgeConfig {
  connectionString: string;
  applicationName: string;
  migrationsDir: string;
  ssl: boolean;
}

export function resolveKnowledgeMigrationsDir(): string {
  return resolve(fileURLToPath(new URL("../../migrations", import.meta.url)));
}

export function resolvePostgresKnowledgeConfig(
  env: NodeJS.ProcessEnv = process.env
): PostgresKnowledgeConfig {
  return {
    connectionString:
      env.KNOWLEDGE_DATABASE_URL?.trim() ||
      "postgresql://workflows:workflows@127.0.0.1:5432/workflows",
    applicationName:
      env.KNOWLEDGE_DATABASE_APPLICATION_NAME?.trim() ||
      "workflows-knowledge",
    migrationsDir:
      env.KNOWLEDGE_MIGRATIONS_DIR?.trim() ||
      resolveKnowledgeMigrationsDir(),
    ssl: env.KNOWLEDGE_DATABASE_SSL?.trim().toLowerCase() === "true",
  };
}

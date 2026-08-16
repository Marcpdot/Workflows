import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { CanonicalKnowledgeRepository } from "./storage/contracts.js";
import type { PostgresKnowledgeConfig } from "./postgres/config.js";
import { resolvePostgresKnowledgeConfig } from "./postgres/config.js";
import { createPostgresCanonicalKnowledgeRepository } from "./postgres/repository.js";
import type { KnowledgeDiagnosticSink } from "./types.js";

export interface KnowledgeStoreConfig {
  defaultWorkspaceId?: string | null;
  postgresConfig?: PostgresKnowledgeConfig;
  pool?: Pool;
  diagnosticSink?: KnowledgeDiagnosticSink;
}

/** PostgreSQL is the sole canonical knowledge runtime. */
export function createKnowledgeStore(
  config: KnowledgeStoreConfig = {}
): CanonicalKnowledgeRepository {
  return createPostgresCanonicalKnowledgeRepository({
    ...(config.postgresConfig ?? resolvePostgresKnowledgeConfig()),
    defaultWorkspaceId: config.defaultWorkspaceId,
    pool: config.pool,
    diagnosticSink: config.diagnosticSink,
  });
}

export function hashInput(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

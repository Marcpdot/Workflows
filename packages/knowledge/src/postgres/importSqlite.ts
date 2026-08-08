import Database from "better-sqlite3";
import type { Pool } from "pg";
import { normalizeLabel } from "../identity.js";
import type { PostgresKnowledgeConfig } from "./config.js";
import { createKnowledgePostgresPool } from "./runtime.js";

export interface SqliteKnowledgeImportResult {
  events: number;
  nodes: number;
  edges: number;
  evidence: number;
  proposals: number;
  aliases: number;
}

export interface SqliteKnowledgeImportOptions {
  sqliteDbPath: string;
  postgresConfig: PostgresKnowledgeConfig;
  pool?: Pool;
}

type Row = Record<string, unknown>;

function rows(db: Database.Database, table: string): Row[] {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? db.prepare(`SELECT * FROM ${table}`).all() as Row[] : [];
}

export async function importSqliteKnowledge(options: SqliteKnowledgeImportOptions): Promise<SqliteKnowledgeImportResult> {
  if (!options.sqliteDbPath?.trim()) throw new Error("importSqliteKnowledge: sqliteDbPath is required");
  const sqlite = new Database(options.sqliteDbPath, { readonly: true, fileMustExist: true });
  const pool = options.pool ?? createKnowledgePostgresPool(options.postgresConfig);
  const ownsPool = !options.pool;
  const client = await pool.connect();
  const result: SqliteKnowledgeImportResult = { events: 0, nodes: 0, edges: 0, evidence: 0, proposals: 0, aliases: 0 };

  try {
    await client.query("BEGIN");
    for (const item of rows(sqlite, "knowledge_events")) {
      await client.query(
        `INSERT INTO knowledge_events (id, source_type, source_ref, model, input_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET source_type = EXCLUDED.source_type,
           source_ref = EXCLUDED.source_ref, model = EXCLUDED.model,
           input_hash = EXCLUDED.input_hash, created_at = EXCLUDED.created_at`,
        [item.id, item.source_type, item.source_ref, item.model ?? null, item.input_hash ?? null, item.created_at]
      ); result.events++;
    }
    for (const item of rows(sqlite, "knowledge_nodes")) {
      await client.query(
        `INSERT INTO knowledge_nodes
           (id, type, label, normalized_label, description, status, workspace_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, label = EXCLUDED.label,
           normalized_label = EXCLUDED.normalized_label, description = EXCLUDED.description,
           status = EXCLUDED.status, workspace_id = EXCLUDED.workspace_id,
           created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
        [item.id, item.type, item.label, normalizeLabel(String(item.label)), item.description ?? null, item.status, item.workspace_id ?? null, item.created_at, item.updated_at]
      ); result.nodes++;
    }
    for (const item of rows(sqlite, "knowledge_edges")) {
      await client.query(
        `INSERT INTO knowledge_edges
           (id, from_node_id, relation, to_node_id, confidence, source_event_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET from_node_id = EXCLUDED.from_node_id,
           relation = EXCLUDED.relation, to_node_id = EXCLUDED.to_node_id,
           confidence = EXCLUDED.confidence, source_event_id = EXCLUDED.source_event_id,
           status = EXCLUDED.status, created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [item.id, item.from_node_id, item.relation, item.to_node_id, item.confidence ?? null, item.source_event_id ?? null, item.status, item.created_at]
      ); result.edges++;
    }
    for (const item of rows(sqlite, "knowledge_evidence")) {
      await client.query(
        `INSERT INTO knowledge_evidence
           (id, claim_node_id, source_node_id, excerpt, stance, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET claim_node_id = EXCLUDED.claim_node_id,
           source_node_id = EXCLUDED.source_node_id, excerpt = EXCLUDED.excerpt,
           stance = EXCLUDED.stance, confidence = EXCLUDED.confidence,
           created_at = EXCLUDED.created_at`,
        [item.id, item.claim_node_id, item.source_node_id, item.excerpt ?? null, item.stance, item.confidence ?? null, item.created_at]
      ); result.evidence++;
    }
    for (const item of rows(sqlite, "knowledge_proposals")) {
      const payload = typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload);
      await client.query(
        `INSERT INTO knowledge_proposals
           (id, event_id, kind, payload, status, created_at, resolved_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, to_timestamp($6 / 1000.0),
           CASE WHEN $7::double precision IS NULL THEN NULL ELSE to_timestamp($7 / 1000.0) END)
         ON CONFLICT (id) DO UPDATE SET event_id = EXCLUDED.event_id,
           kind = EXCLUDED.kind, payload = EXCLUDED.payload, status = EXCLUDED.status,
           created_at = EXCLUDED.created_at, resolved_at = EXCLUDED.resolved_at`,
        [item.id, item.event_id, item.kind, payload, item.status, item.created_at, item.resolved_at ?? null]
      ); result.proposals++;
    }
    for (const item of rows(sqlite, "knowledge_aliases")) {
      const normalized = normalizeLabel(String(item.alias_label));
      await client.query(
        `INSERT INTO knowledge_aliases
           (id, alias_label, normalized_alias_label, canonical_node_id, created_at)
         VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))
         ON CONFLICT (id) DO UPDATE SET alias_label = EXCLUDED.alias_label,
           normalized_alias_label = EXCLUDED.normalized_alias_label,
           canonical_node_id = EXCLUDED.canonical_node_id,
           created_at = EXCLUDED.created_at`,
        [item.id, normalized, normalized, item.canonical_node_id, item.created_at]
      ); result.aliases++;
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    sqlite.close();
    if (ownsPool) await pool.end();
  }
}

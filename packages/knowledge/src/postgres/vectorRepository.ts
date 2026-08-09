import type { Pool, PoolClient } from "pg";
import type {
  RepositoryHealth,
  SemanticVectorHit,
  SemanticVectorRecord,
  VectorRepository,
} from "../storage/contracts.js";
import type { PostgresKnowledgeConfig } from "./config.js";
import { createKnowledgePostgresPool } from "./runtime.js";

type Queryable = Pick<Pool | PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const KNOWLEDGE_VECTOR_DIMENSION = 1536;

export interface PostgresVectorRepositoryConfig extends PostgresKnowledgeConfig {
  pool?: Pool;
}

function millis(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  const text = String(value ?? "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) throw new Error("pgvector returned an invalid vector");
  if (text === "[]") return [];
  return text.slice(1, -1).split(",").map(Number);
}

function record(row: Record<string, unknown>): SemanticVectorRecord {
  return {
    id: String(row.id), canonicalId: String(row.canonical_id),
    sourceId: row.source_id == null ? undefined : String(row.source_id),
    chunkId: row.chunk_id == null ? undefined : String(row.chunk_id),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    entityType: row.entity_type == null ? undefined : String(row.entity_type),
    model: String(row.embedding_model), modelVersion: String(row.embedding_model_version),
    dimension: Number(row.embedding_dimension), vector: parseVector(row.embedding),
    contentHash: row.content_hash == null ? undefined : String(row.content_hash),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: millis(row.created_at as Date), updatedAt: millis(row.updated_at as Date),
  };
}

function vectorLiteral(vector: readonly number[]): string {
  if (vector.length !== KNOWLEDGE_VECTOR_DIMENSION) throw new Error(`vector dimension ${vector.length} is incompatible; expected ${KNOWLEDGE_VECTOR_DIMENSION}`);
  if (vector.some((value) => !Number.isFinite(value))) throw new Error("vector contains a non-finite value");
  return `[${vector.join(",")}]`;
}

function validate(item: SemanticVectorRecord): string {
  if (!UUID.test(item.id)) throw new Error("vector record id must be a UUID");
  if (!UUID.test(item.canonicalId)) throw new Error("canonicalId must be a UUID");
  if (item.sourceId && !UUID.test(item.sourceId)) throw new Error("sourceId must be a UUID");
  if (item.chunkId && !UUID.test(item.chunkId)) throw new Error("chunkId must be a UUID");
  if (!item.model?.trim()) throw new Error("embedding model is required");
  if (!item.modelVersion?.trim()) throw new Error("embedding model version is required");
  if (item.dimension !== KNOWLEDGE_VECTOR_DIMENSION || item.vector.length !== item.dimension) throw new Error(`embedding dimension ${item.dimension}/${item.vector.length} is incompatible; expected ${KNOWLEDGE_VECTOR_DIMENSION}`);
  return vectorLiteral(item.vector);
}

export class PostgresVectorRepository implements VectorRepository {
  readonly backend = "vector" as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(config: PostgresVectorRepositoryConfig) {
    this.pool = config.pool ?? createKnowledgePostgresPool(config);
    this.ownsPool = !config.pool;
  }

  async healthCheck(): Promise<RepositoryHealth> {
    try { await this.pool.query("SELECT 1 FROM knowledge_semantic_vectors LIMIT 1"); return { backend: this.backend, ok: true }; }
    catch (error) { return { backend: this.backend, ok: false, detail: error instanceof Error ? error.message : String(error) }; }
  }

  async upsert(item: SemanticVectorRecord): Promise<void> { await this.upsertWith(this.pool, item); }

  private async upsertWith(db: Queryable, item: SemanticVectorRecord): Promise<void> {
    const embedding = validate(item);
    const result = await db.query(
      `INSERT INTO knowledge_semantic_vectors
         (id, canonical_id, source_id, chunk_id, embedding, embedding_model,
          embedding_model_version, embedding_dimension, workspace_id, entity_type,
          content_hash, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::vector, $6, $7, $8, $9, $10, $11, $12::jsonb,
               to_timestamp($13 / 1000.0), to_timestamp($14 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET
         canonical_id = excluded.canonical_id, source_id = excluded.source_id,
         chunk_id = excluded.chunk_id, embedding = excluded.embedding,
         embedding_model = excluded.embedding_model,
         embedding_model_version = excluded.embedding_model_version,
         embedding_dimension = excluded.embedding_dimension,
         workspace_id = excluded.workspace_id, entity_type = excluded.entity_type,
         content_hash = excluded.content_hash, metadata = excluded.metadata,
         updated_at = excluded.updated_at
       WHERE knowledge_semantic_vectors.canonical_id = excluded.canonical_id
         AND knowledge_semantic_vectors.embedding_model = excluded.embedding_model
         AND knowledge_semantic_vectors.embedding_model_version = excluded.embedding_model_version`,
      [item.id, item.canonicalId, item.sourceId ?? null, item.chunkId ?? null, embedding,
       item.model.trim(), item.modelVersion.trim(), item.dimension, item.workspaceId ?? null,
       item.entityType ?? null, item.contentHash ?? null, JSON.stringify(item.metadata ?? {}),
       item.createdAt, item.updatedAt]
    );
    if ((result.rowCount ?? 0) !== 1) throw new Error(`vector record ${item.id} already belongs to another canonical identity or model/version projection`);
  }

  async get(id: string): Promise<SemanticVectorRecord | null> {
    const result = await this.pool.query("SELECT * FROM knowledge_semantic_vectors WHERE id = $1", [id]);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async deleteByCanonicalId(canonicalId: string): Promise<number> {
    const result = await this.pool.query("DELETE FROM knowledge_semantic_vectors WHERE canonical_id = $1", [canonicalId]);
    return result.rowCount ?? 0;
  }

  async replaceProjection(input: { model: string; modelVersion: string; records: readonly SemanticVectorRecord[] }): Promise<void> {
    const model = input.model.trim(); const modelVersion = input.modelVersion.trim();
    if (!model || !modelVersion) throw new Error("projection model and modelVersion are required");
    for (const item of input.records) if (item.model !== model || item.modelVersion !== modelVersion) throw new Error("replacement record model/version does not match projection scope");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM knowledge_semantic_vectors WHERE embedding_model = $1 AND embedding_model_version = $2", [model, modelVersion]);
      for (const item of input.records) await this.upsertWith(client, item);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async search(queryVector: readonly number[], options: Parameters<VectorRepository["search"]>[1]): Promise<SemanticVectorHit[]> {
    const model = options.model?.trim();
    const modelVersion = options.modelVersion?.trim();
    if (!model || !modelVersion) throw new Error("vector search requires embedding model and modelVersion");
    const embedding = vectorLiteral(queryVector);
    const clauses = ["embedding_model = $2"];
    const params: unknown[] = [embedding, model];
    const add = (sql: string, value: unknown) => { params.push(value); clauses.push(sql.replace("?", `$${params.length}`)); };
    add("embedding_model_version = ?", modelVersion);
    if (options.workspaceId !== undefined) options.workspaceId === null ? clauses.push("workspace_id IS NULL") : add("workspace_id = ?", options.workspaceId);
    if (options.canonicalIds?.length) add("canonical_id = ANY(?::uuid[])", options.canonicalIds);
    if (options.sourceIds?.length) add("source_id = ANY(?::uuid[])", options.sourceIds);
    if (options.chunkIds?.length) add("chunk_id = ANY(?::uuid[])", options.chunkIds);
    if (options.entityTypes?.length) add("entity_type = ANY(?::text[])", options.entityTypes);
    if (options.metadata && Object.keys(options.metadata).length) add("metadata @> ?::jsonb", JSON.stringify(options.metadata));
    if (options.minScore != null) add("(1 - (embedding <=> $1::vector)) >= ?", options.minScore);
    params.push(Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 1000));
    const result = await this.pool.query(
      `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM knowledge_semantic_vectors WHERE ${clauses.join(" AND ")}
       ORDER BY embedding <=> $1::vector LIMIT $${params.length}`,
      params
    );
    return result.rows.map((row) => ({ record: record(row), score: Number(row.similarity) }));
  }

  async close(): Promise<void> { if (this.ownsPool) await this.pool.end(); }
}

export function createPostgresVectorRepository(config: PostgresVectorRepositoryConfig): VectorRepository {
  return new PostgresVectorRepository(config);
}

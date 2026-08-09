import type { Pool } from "pg";
import type { PostgresKnowledgeConfig } from "./config.js";
import { createKnowledgePostgresPool } from "./runtime.js";
import type { RepositoryHealth, SpatialHit, SpatialRecord, SpatialRepository } from "../storage/contracts.js";

export interface PostgresSpatialRepositoryConfig extends PostgresKnowledgeConfig { pool?: Pool; }
const millis = (value: Date | string | number) => value instanceof Date ? value.getTime() : new Date(value).getTime();
const spatial = (row: Record<string, unknown>): SpatialHit => ({ canonicalId: String(row.canonical_node_id), geometry: JSON.parse(String(row.geometry_json)), properties: (row.properties ?? {}) as Record<string, unknown>, updatedAt: millis(row.updated_at as Date), distanceMeters: row.distance_meters == null ? undefined : Number(row.distance_meters) });

export class PostgresSpatialRepository implements SpatialRepository {
  readonly backend = "spatial" as const; private readonly pool: Pool; private readonly ownsPool: boolean;
  constructor(config: PostgresSpatialRepositoryConfig) { this.pool = config.pool ?? createKnowledgePostgresPool(config); this.ownsPool = !config.pool; }
  async healthCheck(): Promise<RepositoryHealth> { try { await this.pool.query("SELECT 1 FROM knowledge_locations LIMIT 1"); return { backend: this.backend, ok: true }; } catch (error) { return { backend: this.backend, ok: false, detail: error instanceof Error ? error.message : String(error) }; } }
  async upsert(item: SpatialRecord): Promise<void> { await this.pool.query(`INSERT INTO knowledge_locations (canonical_node_id, geometry, properties, updated_at) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3::jsonb, to_timestamp($4 / 1000.0)) ON CONFLICT (canonical_node_id) DO UPDATE SET geometry = excluded.geometry, properties = excluded.properties, updated_at = excluded.updated_at`, [item.canonicalId, JSON.stringify(item.geometry), JSON.stringify(item.properties ?? {}), item.updatedAt]); }
  async get(canonicalId: string): Promise<SpatialRecord | null> { const result = await this.pool.query(`SELECT canonical_node_id::text, ST_AsGeoJSON(geometry) AS geometry_json, properties, updated_at FROM knowledge_locations WHERE canonical_node_id = $1`, [canonicalId]); return result.rows[0] ? spatial(result.rows[0]) : null; }
  async withinDistance(input: { longitude: number; latitude: number; distanceMeters: number; workspaceId?: string | null; limit?: number }): Promise<SpatialHit[]> {
    const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 250); const params: unknown[] = [input.longitude, input.latitude, input.distanceMeters]; let workspace = "";
    if (input.workspaceId === null) workspace = "AND n.workspace_id IS NULL"; else if (input.workspaceId !== undefined) { params.push(input.workspaceId); workspace = `AND (n.workspace_id = $${params.length} OR n.workspace_id IS NULL)`; } params.push(limit);
    const result = await this.pool.query(`SELECT l.canonical_node_id::text, ST_AsGeoJSON(l.geometry) AS geometry_json, l.properties, l.updated_at, ST_Distance(l.geometry::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters FROM knowledge_locations l JOIN knowledge_nodes n ON n.id = l.canonical_node_id WHERE n.status = 'accepted' ${workspace} AND ST_DWithin(l.geometry::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3) ORDER BY distance_meters ASC, l.canonical_node_id ASC LIMIT $${params.length}`, params); return result.rows.map(spatial);
  }
  async delete(canonicalId: string): Promise<boolean> { const result = await this.pool.query("DELETE FROM knowledge_locations WHERE canonical_node_id = $1", [canonicalId]); return (result.rowCount ?? 0) > 0; }
  async close(): Promise<void> { if (this.ownsPool) await this.pool.end(); }
}
export const createPostgresSpatialRepository = (config: PostgresSpatialRepositoryConfig) => new PostgresSpatialRepository(config);

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { normalizeLabel } from "../identity.js";
import type {
  ClaimLineage,
  ContradictionPair,
  DependentClaim,
  KnowledgeAlias,
  KnowledgeDerivation,
  KnowledgeEdge,
  KnowledgeEpistemicStatus,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeObservation,
  KnowledgeObservationKind,
  KnowledgeProposal,
  KnowledgeStatus,
  KnowledgeTransformation,
  MergeNodesResult,
  ProjectLinkRelation,
  ProjectStatus,
} from "../types.js";
import type {
  CanonicalKnowledgeRepository,
  RepositoryHealth,
} from "../storage/contracts.js";
import type { PostgresKnowledgeConfig } from "./config.js";
import { createKnowledgePostgresPool } from "./runtime.js";

type Queryable = Pick<Pool | PoolClient, "query">;
const PROJECT_RELATIONS: ProjectLinkRelation[] = ["used_in", "about", "part_of"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }

function millis(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function node(row: Record<string, unknown>): KnowledgeNode {
  return {
    id: String(row.id),
    type: row.type as KnowledgeNodeType,
    label: String(row.label),
    description: row.description == null ? undefined : String(row.description),
    status: row.status as KnowledgeStatus,
    epistemicStatus: (row.epistemic_status ?? "unknown") as KnowledgeEpistemicStatus,
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    validFrom: row.valid_from == null ? undefined : millis(row.valid_from as Date),
    validTo: row.valid_to == null ? undefined : millis(row.valid_to as Date),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    createdAt: millis(row.created_at as Date),
    updatedAt: millis(row.updated_at as Date),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function informationLoss(value: unknown): KnowledgeTransformation["informationLoss"] {
  const item = object(value);
  if (typeof item.occurred !== "boolean") return undefined;
  return {
    occurred: item.occurred,
    description: typeof item.description === "string" ? item.description : undefined,
  };
}

function transformation(value: unknown): KnowledgeTransformation | undefined {
  const item = object(value);
  const method = typeof item.method === "string" ? item.method.trim() : "";
  if (!method) return undefined;
  return {
    method,
    model: typeof item.model === "string" ? item.model : undefined,
    assumptions: stringArray(item.assumptions),
    confidence: item.confidence == null ? undefined : Number(item.confidence),
    uncertainty: typeof item.uncertainty === "string" ? item.uncertainty : undefined,
    representationScope: typeof item.representationScope === "string" ? item.representationScope : undefined,
    informationLoss: informationLoss(item.informationLoss),
    validFrom: item.validFrom == null ? undefined : Number(item.validFrom),
    validTo: item.validTo == null ? undefined : Number(item.validTo),
  };
}

function edge(row: Record<string, unknown>): KnowledgeEdge {
  return {
    id: String(row.id),
    fromNodeId: String(row.from_node_id),
    relation: String(row.relation),
    toNodeId: String(row.to_node_id),
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    sourceEventId: row.source_event_id == null ? undefined : String(row.source_event_id),
    status: row.status as KnowledgeStatus,
    createdAt: millis(row.created_at as Date),
  };
}

function event(row: Record<string, unknown>): KnowledgeEvent {
  const metadata = object(row.action_metadata);
  return {
    id: String(row.id),
    sourceType: row.source_type as KnowledgeEvent["sourceType"],
    sourceRef: String(row.source_ref),
    sourceContent: row.source_content == null ? undefined : String(row.source_content),
    sourceExperienceIds: stringArray(metadata.sourceExperienceIds),
    model: row.model == null ? undefined : String(row.model),
    inputHash: row.input_hash == null ? undefined : String(row.input_hash),
    transformation: transformation(metadata.transformation),
    invalidatedAt: row.invalidated_at == null ? undefined : millis(row.invalidated_at as Date),
    invalidationReason: row.invalidation_reason == null ? undefined : String(row.invalidation_reason),
    createdAt: millis(row.created_at as Date),
  };
}

function proposal(row: Record<string, unknown>): KnowledgeProposal {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    kind: row.kind as KnowledgeProposal["kind"],
    payload: row.payload as Record<string, unknown>,
    status: row.status as KnowledgeProposal["status"],
    createdAt: millis(row.created_at as Date),
    resolvedAt: row.resolved_at == null ? undefined : millis(row.resolved_at as Date),
  };
}

function alias(row: Record<string, unknown>): KnowledgeAlias {
  return {
    id: String(row.id),
    aliasLabel: String(row.alias_label),
    canonicalNodeId: String(row.canonical_node_id),
    createdAt: millis(row.created_at as Date),
  };
}

function evidence(row: Record<string, unknown>): KnowledgeEvidence {
  return { id: String(row.id), targetNodeId: String(row.target_node_id), sourceNodeId: String(row.source_node_id), sourceEventId: row.source_event_id == null ? undefined : String(row.source_event_id), excerpt: row.excerpt == null ? undefined : String(row.excerpt), stance: row.stance as KnowledgeEvidence["stance"], confidence: row.confidence == null ? undefined : Number(row.confidence), createdAt: millis(row.created_at as Date) };
}

function observation(row: Record<string, unknown>): KnowledgeObservation {
  return { id: String(row.id), targetNodeId: String(row.target_node_id), sourceEventId: row.source_event_id == null ? undefined : String(row.source_event_id), sourceNodeId: row.source_node_id == null ? undefined : String(row.source_node_id), kind: row.kind as KnowledgeObservationKind, observedAt: millis(row.observed_at as Date), metadata: (row.metadata ?? {}) as Record<string, unknown> };
}

export interface PostgresCanonicalRepositoryConfig extends PostgresKnowledgeConfig {
  defaultWorkspaceId?: string | null;
  pool?: Pool;
}

export class PostgresCanonicalKnowledgeRepository implements CanonicalKnowledgeRepository {
  readonly backend = "postgresql" as const;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly defaultWorkspaceId: string | null | undefined;

  constructor(config: PostgresCanonicalRepositoryConfig) {
    this.pool = config.pool ?? createKnowledgePostgresPool(config);
    this.ownsPool = !config.pool;
    this.defaultWorkspaceId = config.defaultWorkspaceId;
  }

  async healthCheck(): Promise<RepositoryHealth> {
    try {
      await this.pool.query("SELECT 1 FROM knowledge_schema_migrations LIMIT 1");
      return { backend: this.backend, ok: true };
    } catch (error) {
      return { backend: this.backend, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async *scanAcceptedNodes(options: { pageSize?: number } = {}): AsyncIterable<readonly KnowledgeNode[]> {
    const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 1000), 1), 10_000);
    const client = await this.pool.connect();
    let completed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let afterId: string | null = null;
      while (true) {
        const rows: QueryResultRow[] = afterId
          ? (await client.query("SELECT * FROM knowledge_nodes WHERE status = 'accepted' AND id > $1 ORDER BY id ASC LIMIT $2", [afterId, pageSize])).rows
          : (await client.query("SELECT * FROM knowledge_nodes WHERE status = 'accepted' ORDER BY id ASC LIMIT $1", [pageSize])).rows;
        if (!rows.length) break;
        const page: KnowledgeNode[] = rows.map(node);
        yield page;
        afterId = page[page.length - 1]!.id;
        if (page.length < pageSize) break;
      }
      await client.query("COMMIT");
      completed = true;
    } finally {
      if (!completed) await client.query("ROLLBACK");
      client.release();
    }
  }

  async *scanAcceptedTopology(options: { pageSize?: number } = {}): AsyncIterable<{ nodes?: readonly KnowledgeNode[]; edges?: readonly KnowledgeEdge[] }> {
    const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? 1000), 1), 10_000);
    const client = await this.pool.connect(); let completed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let afterNodeId: string | null = null;
      while (true) {
        const rows: QueryResultRow[] = afterNodeId
          ? (await client.query("SELECT * FROM knowledge_nodes WHERE status = 'accepted' AND id > $1 ORDER BY id ASC LIMIT $2", [afterNodeId, pageSize])).rows
          : (await client.query("SELECT * FROM knowledge_nodes WHERE status = 'accepted' ORDER BY id ASC LIMIT $1", [pageSize])).rows;
        if (!rows.length) break;
        const nodes: KnowledgeNode[] = rows.map(node); yield { nodes };
        afterNodeId = nodes[nodes.length - 1]!.id; if (nodes.length < pageSize) break;
      }
      let afterEdgeId: string | null = null;
      while (true) {
        const rows: QueryResultRow[] = afterEdgeId
          ? (await client.query("SELECT * FROM knowledge_edges WHERE status = 'accepted' AND id > $1 ORDER BY id ASC LIMIT $2", [afterEdgeId, pageSize])).rows
          : (await client.query("SELECT * FROM knowledge_edges WHERE status = 'accepted' ORDER BY id ASC LIMIT $1", [pageSize])).rows;
        if (!rows.length) break;
        const edges: KnowledgeEdge[] = rows.map(edge); yield { edges };
        afterEdgeId = edges[edges.length - 1]!.id; if (edges.length < pageSize) break;
      }
      await client.query("COMMIT"); completed = true;
    } finally { if (!completed) await client.query("ROLLBACK"); client.release(); }
  }

  async getEdge(id: string): Promise<KnowledgeEdge | null> {
    const result = await this.pool.query("SELECT * FROM knowledge_edges WHERE id = $1", [id]);
    return result.rows[0] ? edge(result.rows[0]) : null;
  }

  async createEvent(input: { sourceType: KnowledgeEvent["sourceType"]; sourceRef: string; sourceContent?: string; sourceExperienceIds?: string[]; model?: string; inputHash?: string; transformation?: KnowledgeTransformation }): Promise<KnowledgeEvent> {
    if (!input.sourceRef?.trim()) throw new Error("createEvent: sourceRef is required");
    const metadata = {
      sourceExperienceIds: stringArray(input.sourceExperienceIds),
      transformation: input.transformation,
    };
    const result = await this.pool.query(
      `INSERT INTO knowledge_events (id, source_type, source_ref, source_content, model, input_hash, action_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
      [randomUUID(), input.sourceType, input.sourceRef.trim(), input.sourceContent ?? null, input.model ?? null, input.inputHash ?? null, JSON.stringify(metadata)]
    );
    return event(result.rows[0]);
  }

  async getEvent(id: string): Promise<KnowledgeEvent | null> {
    const result = await this.pool.query("SELECT * FROM knowledge_events WHERE id = $1", [id]);
    return result.rows[0] ? event(result.rows[0]) : null;
  }

  async invalidateEvent(id: string, reason: string): Promise<KnowledgeEvent> {
    if (!reason.trim()) throw new Error("invalidateEvent: reason is required");
    const result = await this.pool.query(
      `UPDATE knowledge_events
       SET invalidated_at = COALESCE(invalidated_at, now()),
           invalidation_reason = $2
       WHERE id = $1
       RETURNING *`,
      [id, reason.trim()]
    );
    if (!result.rows[0]) throw new Error(`invalidateEvent: unknown id ${id}`);
    return event(result.rows[0]);
  }

  async addProposals(eventId: string, items: Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }>): Promise<KnowledgeProposal[]> {
    if (!(await this.getEvent(eventId))) throw new Error(`addProposals: unknown eventId ${eventId}`);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const output: KnowledgeProposal[] = [];
      for (const item of items) {
        const result = await client.query(
          `INSERT INTO knowledge_proposals (id, event_id, kind, payload)
           VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
          [randomUUID(), eventId, item.kind, JSON.stringify(item.payload)]
        );
        output.push(proposal(result.rows[0]));
      }
      await client.query("COMMIT");
      return output;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listProposals(filter?: { status?: KnowledgeProposal["status"]; eventId?: string }): Promise<KnowledgeProposal[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
    if (filter?.eventId) { params.push(filter.eventId); clauses.push(`event_id = $${params.length}`); }
    const result = await this.pool.query(
      `SELECT * FROM knowledge_proposals ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at ASC`, params
    );
    return result.rows.map(proposal);
  }

  async acceptProposal(id: string, edits?: Record<string, unknown>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM knowledge_proposals WHERE id = $1 FOR UPDATE", [id]);
      if (!result.rows[0]) throw new Error(`acceptProposal: unknown id ${id}`);
      const current = proposal(result.rows[0]);
      if (current.status !== "pending") throw new Error(`acceptProposal: proposal ${id} is already ${current.status}`);
      const payload = { ...current.payload, ...edits };
      if (current.kind === "node") await this.materializeNode(client, payload, current.eventId, true);
      else if (current.kind === "edge") await this.materializeEdge(client, payload, current.eventId);
      else if (current.kind === "evidence") await this.materializeEvidence(client, payload, current.eventId);
      else if (current.kind === "observation") await this.materializeObservation(client, payload, current.eventId);
      else if (current.kind === "merge") await this.mergeNodesWith(client, { fromId: requiredString(payload.fromId, "merge fromId"), intoId: requiredString(payload.intoId, "merge intoId") });
      else if (current.kind === "supersede") await this.supersedeClaimWith(client, { oldClaimId: requiredString(payload.oldClaimId, "supersede oldClaimId"), newClaimId: requiredString(payload.newClaimId, "supersede newClaimId"), markOldDisputed: payload.markOldDisputed !== false });
      else throw new Error(`acceptProposal: unsupported proposal kind ${String(current.kind)}`);
      await client.query("UPDATE knowledge_proposals SET status = 'accepted', resolved_at = now() WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async rejectProposal(id: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE knowledge_proposals SET status = 'rejected', resolved_at = now()
       WHERE id = $1 AND status = 'pending' RETURNING id`, [id]
    );
    if (!result.rows[0]) {
      const current = await this.pool.query("SELECT status FROM knowledge_proposals WHERE id = $1", [id]);
      if (!current.rows[0]) throw new Error(`rejectProposal: unknown id ${id}`);
      throw new Error(`rejectProposal: proposal ${id} is already ${current.rows[0].status}`);
    }
  }

  async listEvidence(targetNodeId: string, limit = 50): Promise<KnowledgeEvidence[]> {
    const result = await this.pool.query("SELECT * FROM knowledge_evidence WHERE target_node_id = $1 ORDER BY created_at DESC LIMIT $2", [targetNodeId, Math.min(Math.max(Math.floor(limit), 0), 1000)]);
    return result.rows.map(evidence);
  }

  async listObservations(targetNodeId: string, limit = 100): Promise<KnowledgeObservation[]> {
    const result = await this.pool.query("SELECT * FROM knowledge_observations WHERE target_node_id = $1 ORDER BY observed_at DESC, id ASC LIMIT $2", [targetNodeId, Math.min(Math.max(Math.floor(limit), 0), 1000)]);
    return result.rows.map(observation);
  }

  async getClaimLineage(claimId: string, options?: { maxDepth?: number }): Promise<ClaimLineage> {
    const claim = await this.getNode(claimId);
    if (!claim || claim.type !== "claim") throw new Error(`getClaimLineage: ${claimId} is not a claim`);
    const maxDepth = Math.min(Math.max(Math.floor(options?.maxDepth ?? 8), 1), 20);
    const rows: Array<{ item: KnowledgeObservation; depth: number }> = [];
    const visitedTargets = new Set<string>([claimId]);
    let frontier = [claimId];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const result = await this.pool.query(
        `SELECT * FROM knowledge_observations
         WHERE kind = 'derived_from' AND target_node_id = ANY($1::uuid[])
         ORDER BY observed_at ASC, id ASC`,
        [frontier]
      );
      const level = result.rows.map(observation);
      rows.push(...level.map((item) => ({ item, depth })));
      frontier = [...new Set(level.flatMap((item) => item.sourceNodeId ? [item.sourceNodeId] : []))]
        .filter((id) => !visitedTargets.has(id));
      for (const id of frontier) visitedTargets.add(id);
    }
    let truncated = false;
    if (frontier.length > 0) {
      const more = await this.pool.query(
        `SELECT 1 FROM knowledge_observations
         WHERE kind = 'derived_from' AND target_node_id = ANY($1::uuid[])
         LIMIT 1`,
        [frontier]
      );
      truncated = more.rows.length > 0;
    }
    const lineageTargetIds = [...visitedTargets];
    const evidenceRows = await this.pool.query(
      `SELECT * FROM knowledge_evidence
       WHERE target_node_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [lineageTargetIds]
    );
    const evidenceItems = evidenceRows.rows.map(evidence);
    const sourceNodeIds = [...new Set([
      ...rows.flatMap(({ item }) => item.sourceNodeId ? [item.sourceNodeId] : []),
      ...evidenceItems.map((item) => item.sourceNodeId),
    ])];
    const sourceEventIds = [...new Set([
      ...rows.flatMap(({ item }) => item.sourceEventId ? [item.sourceEventId] : []),
      ...evidenceItems.flatMap((item) => item.sourceEventId ? [item.sourceEventId] : []),
    ])];
    const sourceNodes = sourceNodeIds.length === 0 ? [] : (await this.pool.query(
      "SELECT * FROM knowledge_nodes WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC",
      [sourceNodeIds]
    )).rows.map(node);
    const sourceEvents = sourceEventIds.length === 0 ? [] : (await this.pool.query(
      "SELECT * FROM knowledge_events WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC",
      [sourceEventIds]
    )).rows.map(event);
    const eventsById = new Map(sourceEvents.map((item) => [item.id, item]));
    const derivations: KnowledgeDerivation[] = rows.map(({ item, depth }) => {
      const details = transformation(object(item.metadata).derivation)
        ?? (item.sourceEventId ? eventsById.get(item.sourceEventId)?.transformation : undefined)
        ?? { method: "unspecified" };
      return {
        ...details,
        id: item.id,
        targetNodeId: item.targetNodeId,
        sourceEventId: item.sourceEventId,
        sourceNodeId: item.sourceNodeId,
        createdAt: item.observedAt,
        depth,
      };
    });
    return { claim, derivations, sourceNodes, sourceEvents, evidence: evidenceItems, maxDepth, truncated };
  }

  async findDependentClaims(input: { sourceNodeId?: string; sourceEventId?: string; maxDepth?: number }): Promise<DependentClaim[]> {
    if (!input.sourceNodeId && !input.sourceEventId) throw new Error("findDependentClaims: sourceNodeId or sourceEventId is required");
    const maxDepth = Math.min(Math.max(Math.floor(input.maxDepth ?? 8), 1), 20);
    const derivations = new Map<string, Array<{ id: string; depth: number }>>();
    const visited = new Set<string>();
    let frontier = input.sourceNodeId ? [input.sourceNodeId] : [];
    for (let depth = 1; depth <= maxDepth; depth++) {
      let result;
      if (depth === 1 && input.sourceEventId) {
        result = await this.pool.query(
          `SELECT * FROM knowledge_observations
           WHERE kind = 'derived_from'
             AND (source_event_id = $1 OR source_node_id = ANY($2::uuid[]))
           ORDER BY observed_at ASC, id ASC`,
          [input.sourceEventId, frontier]
        );
      } else if (frontier.length > 0) {
        result = await this.pool.query(
          `SELECT * FROM knowledge_observations
           WHERE kind = 'derived_from' AND source_node_id = ANY($1::uuid[])
           ORDER BY observed_at ASC, id ASC`,
          [frontier]
        );
      } else break;
      const level = result.rows.map(observation).filter((item) => !visited.has(item.id));
      for (const item of level) {
        visited.add(item.id);
        const current = derivations.get(item.targetNodeId) ?? [];
        current.push({ id: item.id, depth });
        derivations.set(item.targetNodeId, current);
      }
      frontier = [...new Set(level.map((item) => item.targetNodeId))];
    }
    const ids = [...derivations.keys()];
    if (ids.length === 0) return [];
    const nodes = (await this.pool.query(
      "SELECT * FROM knowledge_nodes WHERE id = ANY($1::uuid[])",
      [ids]
    )).rows.map(node);
    return nodes
      .filter((item) => item.type === "claim")
      .map((claim) => {
        const links = derivations.get(claim.id)!;
        return {
          claim,
          depth: Math.min(...links.map((item) => item.depth)),
          derivationIds: links.map((item) => item.id),
        };
      })
      .sort((a, b) => a.depth - b.depth || a.claim.id.localeCompare(b.claim.id));
  }

  async getNode(id: string): Promise<KnowledgeNode | null> { return this.getNodeWith(this.pool, id); }

  private async getNodeWith(db: Queryable, id: string): Promise<KnowledgeNode | null> {
    const result = await db.query("SELECT * FROM knowledge_nodes WHERE id = $1", [id]);
    return result.rows[0] ? node(result.rows[0]) : null;
  }

  async findNodes(query: { type?: KnowledgeNodeType; label?: string; workspaceId?: string | null; status?: KnowledgeStatus; limit?: number }): Promise<KnowledgeNode[]> {
    return this.findNodesWith(this.pool, query);
  }

  private async findNodesWith(db: Queryable, query: { type?: KnowledgeNodeType; label?: string; workspaceId?: string | null; status?: KnowledgeStatus; limit?: number }): Promise<KnowledgeNode[]> {
    const clauses: string[] = []; const params: unknown[] = [];
    if (query.type) { params.push(query.type); clauses.push(`type = $${params.length}`); }
    if (query.label) { params.push(`%${query.label}%`); clauses.push(`label ILIKE $${params.length}`); }
    if (query.workspaceId !== undefined) {
      if (query.workspaceId === null) clauses.push("workspace_id IS NULL");
      else { params.push(query.workspaceId); clauses.push(`workspace_id = $${params.length}`); }
    }
    if (query.status) { params.push(query.status); clauses.push(`status = $${params.length}`); }
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 50;
    params.push(limit);
    const result = await db.query(`SELECT * FROM knowledge_nodes ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT $${params.length}`, params);
    return result.rows.map(node);
  }

  private async findIdentityCandidates(
    db: Queryable,
    labelValue: string,
    type?: KnowledgeNodeType,
    status: KnowledgeStatus = "accepted"
  ): Promise<KnowledgeNode[]> {
    const params: unknown[] = [normalizeLabel(labelValue), status];
    const typeClause = type ? "AND type = $3" : "";
    if (type) params.push(type);
    const result = await db.query(
      `SELECT * FROM knowledge_nodes
       WHERE normalized_label = $1 AND status = $2 ${typeClause}
       ORDER BY created_at ASC`,
      params
    );
    return result.rows.map(node);
  }

  private async edgesFor(db: Queryable, ids: string[], status: KnowledgeStatus, limit?: number): Promise<KnowledgeEdge[]> {
    if (!ids.length) return [];
    const result = await db.query(
      `SELECT * FROM knowledge_edges WHERE status = $1 AND (from_node_id = ANY($2::uuid[]) OR to_node_id = ANY($2::uuid[])) ORDER BY created_at ASC${limit == null ? "" : " LIMIT $3"}`,
      limit == null ? [status, ids] : [status, ids, limit]
    );
    return result.rows.map(edge);
  }

  async getNeighborhood(nodeId: string, options?: { hops?: 1 | 2; status?: KnowledgeStatus; nodeLimit?: number; edgeLimit?: number }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; truncated: boolean; complete: boolean; truncation: { nodes: boolean; edges: boolean }; limits: { nodes: number; edges: number } }> {
    const nodeLimit = Math.min(Math.max(Math.floor(options?.nodeLimit ?? 250), 1), 1000); const edgeLimit = Math.min(Math.max(Math.floor(options?.edgeLimit ?? 500), 0), 2000);
    const empty = { nodes: [], edges: [], truncated: false, complete: true, truncation: { nodes: false, edges: false }, limits: { nodes: nodeLimit, edges: edgeLimit } };
    const root = await this.getNode(nodeId); const status = options?.status ?? "accepted"; if (!root || root.status !== status) return empty;
    const hops = options?.hops === 2 ? 2 : 1;
    const nodes = new Map([[root.id, root]]); const edges = new Map<string, KnowledgeEdge>(); let frontier = [root.id]; let nodeTruncated = false; let edgeTruncated = false;
    for (let i = 0; i < hops; i++) {
      const remainingEdges = edgeLimit - edges.size; const remainingNodes = nodeLimit - nodes.size;
      if (remainingEdges <= 0) { edgeTruncated = frontier.length > 0; break; }
      const sqlLimit = remainingEdges + 1;
      const found = await this.edgesFor(this.pool, frontier, status, sqlLimit); const next: string[] = [];
      if (found.length > remainingEdges) edgeTruncated = true;
      for (const item of found) {
        if (edges.size >= edgeLimit) { edgeTruncated = true; break; }
        const endpointIds = [item.fromNodeId, item.toNodeId]; const missingIds = endpointIds.filter((id) => !nodes.has(id));
        if (nodes.size + missingIds.length > nodeLimit) { nodeTruncated = true; continue; }
        for (const id of [item.fromNodeId, item.toNodeId]) if (!nodes.has(id)) {
          const foundNode = await this.getNode(id);
          if (foundNode && foundNode.status === status) { nodes.set(id, foundNode); next.push(id); }
        }
        if (nodes.has(item.fromNodeId) && nodes.has(item.toNodeId)) edges.set(item.id, item);
      }
      frontier = next;
      if (nodeTruncated || edgeTruncated) break;
    }
    const truncated = nodeTruncated || edgeTruncated;
    return { nodes: [...nodes.values()], edges: [...edges.values()], truncated, complete: !truncated, truncation: { nodes: nodeTruncated, edges: edgeTruncated }, limits: { nodes: nodeLimit, edges: edgeLimit } };
  }

  async getSubgraph(input?: { rootId?: string; nodeIds?: string[]; hops?: 1 | 2; status?: KnowledgeStatus; workspaceId?: string | null; limit?: number; edgeLimit?: number }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; truncated: boolean; complete: boolean; truncation: { nodes: boolean; edges: boolean } }> {
    const status = input?.status ?? "accepted"; const limit = Math.min(input?.limit && input.limit > 0 ? Math.floor(input.limit) : 250, 1000); const edgeLimit = Math.min(input?.edgeLimit && input.edgeLimit > 0 ? Math.floor(input.edgeLimit) : limit * 2, 2000);
    let candidates: KnowledgeNode[]; let traversalTruncated = false; let traversalNodeTruncated = false; let traversalEdgeTruncated = false;
    if (input?.rootId) {
      const root = await this.getNode(input.rootId); if (!root || root.status !== status) return { nodes: [], edges: [], truncated: false, complete: true, truncation: { nodes: false, edges: false } };
      const neighborhood = await this.getNeighborhood(root.id, { hops: input.hops === 2 ? 2 : 1, status, nodeLimit: limit + 1, edgeLimit }); candidates = neighborhood.nodes; traversalTruncated = neighborhood.truncated; traversalNodeTruncated = neighborhood.truncation.nodes; traversalEdgeTruncated = neighborhood.truncation.edges;
    } else if (input?.nodeIds?.length) {
      const requestedIds = [...new Set(input.nodeIds)]; traversalNodeTruncated = requestedIds.length > limit;
      candidates = []; for (const id of requestedIds.slice(0, limit)) { const item = await this.getNode(id); if (item?.status === status) candidates.push(item); }
    } else candidates = await this.findNodes({ status, workspaceId: input?.workspaceId, limit: limit + 1 });
    if (input?.workspaceId !== undefined) candidates = candidates.filter((item) => item.workspaceId === input.workspaceId);
    const nodeTruncated = traversalNodeTruncated || candidates.length > limit; const nodes = candidates.slice(0, limit); const ids = nodes.map((item) => item.id);
    const found = ids.length ? await this.pool.query(`SELECT * FROM knowledge_edges WHERE status = $1 AND from_node_id = ANY($2::uuid[]) AND to_node_id = ANY($2::uuid[]) ORDER BY created_at ASC, id ASC LIMIT $3`, [status, ids, edgeLimit + 1]) : { rows: [] };
    const foundEdges = found.rows.map(edge); const edgeTruncated = traversalEdgeTruncated || foundEdges.length > edgeLimit; const edges = foundEdges.slice(0, edgeLimit); const truncated = traversalTruncated || nodeTruncated || edgeTruncated;
    return { nodes, edges, truncated, complete: !truncated, truncation: { nodes: nodeTruncated, edges: edgeTruncated } };
  }

  async ensureProject(input: { canonicalId?: string; label: string; description?: string; workspaceId?: string | null; createAccepted?: boolean }): Promise<KnowledgeNode> {
    const labelValue = input.label?.trim(); if (!labelValue) throw new Error("ensureProject: label is required");
    if (input.canonicalId) {
      const existing = await this.getNode(input.canonicalId);
      if (!existing || existing.type !== "project" || existing.status === "rejected") throw new Error("ensureProject: canonicalId must reference a non-rejected project");
      return existing;
    }
    if (input.createAccepted === false) {
      const candidates = await this.findIdentityCandidates(this.pool, labelValue, "project");
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) throw new Error(`ensureProject: label "${labelValue}" is ambiguous; provide canonicalId`);
    }
    if (input.createAccepted === false) throw new Error(`ensureProject: no accepted project "${labelValue}" and createAccepted=false`);
    const workspaceId = input.workspaceId !== undefined ? input.workspaceId : this.defaultWorkspaceId ?? null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO knowledge_nodes (id, type, label, normalized_label, description, status, workspace_id)
         VALUES ($1, 'project', $2, $3, $4, 'accepted', $5) RETURNING *`,
        [randomUUID(), labelValue, normalizeLabel(labelValue), input.description ?? null, workspaceId]
      );
      const created = node(result.rows[0]); await this.queueProjection(client, created.id, "graph", "upsert"); await this.queueProjection(client, created.id, "vector", "upsert");
      await client.query("COMMIT"); return created;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async linkToProject(input: { nodeId: string; projectId: string; relation?: ProjectLinkRelation; sourceEventId?: string }): Promise<KnowledgeEdge> {
    const source = await this.getNode(input.nodeId); const project = await this.getNode(input.projectId);
    if (!source) throw new Error(`linkToProject: unknown nodeId ${input.nodeId}`);
    if (!project || project.type !== "project") throw new Error("linkToProject: projectId must be an accepted project node");
    if (project.status !== "accepted") throw new Error("linkToProject: project is not accepted");
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const edge = await this.insertEdge(client, { id: randomUUID(), fromNodeId: source.id, relation: input.relation ?? "used_in", toNodeId: project.id, sourceEventId: input.sourceEventId, status: "accepted", createdAt: Date.now() }); await client.query("COMMIT"); return edge; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async unlinkFromProject(input: { nodeId: string; projectId: string }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await client.query<{ id: string }>("DELETE FROM knowledge_edges WHERE from_node_id = $1 AND to_node_id = $2 AND relation = ANY($3::text[]) RETURNING id::text", [input.nodeId, input.projectId, PROJECT_RELATIONS]);
      for (const row of removed.rows) await this.queueProjection(client, row.id, "graph", "delete");
      await client.query("COMMIT"); return (removed.rowCount ?? 0) > 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async getProjectStatus(input: { projectId?: string; label?: string; workspaceId?: string | null; hops?: 1 | 2 }): Promise<ProjectStatus> {
    const project = input.projectId ? await this.getNode(input.projectId) : input.label ? await this.resolveCanonical({ label: input.label, type: "project" }) : null;
    if (!project || project.type !== "project") throw new Error("getProjectStatus: provide projectId or label of an existing project");
    if (input.workspaceId != null && project.workspaceId && project.workspaceId !== input.workspaceId) throw new Error(`getProjectStatus: project workspace mismatch (want ${input.workspaceId})`);
    const graph = await this.getNeighborhood(project.id, { hops: input.hops === 2 ? 2 : 1, status: "accepted" });
    const linkedNodes = graph.nodes.filter((item) => item.id !== project.id);
    const claims = linkedNodes.filter((item) => item.type === "claim"); const concepts = linkedNodes.filter((item) => item.type === "concept"); const artifacts = linkedNodes.filter((item) => item.type === "artifact");
    const pending = await this.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM knowledge_proposals WHERE status = 'pending' AND (position($1 in lower(payload::text)) > 0 OR position($2 in lower(payload::text)) > 0)", [project.label.toLowerCase(), project.id.toLowerCase()]);
    const pendingProposalCount = pending.rows[0]?.count ?? 0;
    const summaryLines = [`project: ${project.label} (${project.status})`, `workspace: ${project.workspaceId ?? "none"}`, `claims: ${claims.length} | concepts: ${concepts.length} | artifacts: ${artifacts.length}`, ...claims.slice(0, 8).map((item) => `- claim: ${item.label}`), `pending proposals: ${pendingProposalCount}`];
    if (!graph.complete) summaryLines.push(`topology: incomplete (${graph.truncation.nodes ? "node limit" : ""}${graph.truncation.nodes && graph.truncation.edges ? ", " : ""}${graph.truncation.edges ? "edge limit" : ""})`);
    return { project, workspaceId: project.workspaceId, linkedNodes, edges: graph.edges, claims, concepts, artifacts, pendingProposalCount, summaryLines, topologyComplete: graph.complete, topologyTruncated: graph.truncated, topologyTruncation: graph.truncation };
  }

  async addAlias(input: { aliasLabel: string; canonicalNodeId: string }): Promise<KnowledgeAlias> {
    const normalized = normalizeLabel(input.aliasLabel); if (!normalized) throw new Error("addAlias: aliasLabel is required");
    const canonical = await this.getNode(input.canonicalNodeId); if (!canonical) throw new Error(`addAlias: unknown node ${input.canonicalNodeId}`); if (canonical.status === "rejected") throw new Error("addAlias: canonical node is rejected");
    const existing = await this.getAlias(this.pool, normalized); if (existing) { if (existing.canonicalNodeId === canonical.id) return existing; throw new Error(`addAlias: alias "${normalized}" already points to ${existing.canonicalNodeId}`); }
    const result = await this.pool.query(
      `INSERT INTO knowledge_aliases (id, alias_label, normalized_alias_label, canonical_node_id)
       VALUES ($1, $2, $2, $3) RETURNING *`, [randomUUID(), normalized, canonical.id]
    );
    return alias(result.rows[0]);
  }

  async resolveCanonical(input: { label: string; type?: KnowledgeNodeType }): Promise<KnowledgeNode | null> {
    const raw = input.label?.trim(); if (!raw) return null;
    const direct = UUID.test(raw) ? await this.getNode(raw) : null; if (direct && direct.status !== "rejected") return direct;
    const knownAlias = await this.getAlias(this.pool, normalizeLabel(raw)); if (knownAlias) { const target = await this.getNode(knownAlias.canonicalNodeId); if (target && target.status !== "rejected") return target; }
    const candidates = await this.findIdentityCandidates(this.pool, raw, input.type);
    return candidates.length === 1 ? candidates[0] : null;
  }

  async mergeNodes(input: { fromId: string; intoId: string }): Promise<MergeNodesResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const result = await this.mergeNodesWith(client, input); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async mergeNodesWith(client: PoolClient, input: { fromId: string; intoId: string }): Promise<MergeNodesResult> {
      if (input.fromId === input.intoId) throw new Error("mergeNodes: fromId and intoId must differ");
      const from = await this.getNodeWith(client, input.fromId); const into = await this.getNodeWith(client, input.intoId);
      if (!from) throw new Error(`mergeNodes: unknown fromId ${input.fromId}`); if (!into) throw new Error(`mergeNodes: unknown intoId ${input.intoId}`); if (into.status === "rejected") throw new Error("mergeNodes: into node is rejected");
      const affected = await client.query<{ id: string; from_node_id: string; to_node_id: string }>(
        "SELECT id, from_node_id::text, to_node_id::text FROM knowledge_edges WHERE from_node_id = $1 OR to_node_id = $1 FOR UPDATE",
        [from.id]
      );
      const first = await client.query("UPDATE knowledge_edges SET from_node_id = $1 WHERE from_node_id = $2", [into.id, from.id]);
      const second = await client.query("UPDATE knowledge_edges SET to_node_id = $1 WHERE to_node_id = $2", [into.id, from.id]);
      const mergeConflictIds = affected.rows
        .filter((row) =>
          (row.from_node_id === from.id && row.to_node_id === into.id) ||
          (row.from_node_id === into.id && row.to_node_id === from.id)
        )
        .map((row) => row.id);
      if (mergeConflictIds.length) {
        await client.query(
          "DELETE FROM knowledge_edges WHERE id = ANY($1::uuid[]) AND from_node_id = to_node_id",
          [mergeConflictIds]
        );
      }
      const evidenceA = await client.query("UPDATE knowledge_evidence SET target_node_id = $1 WHERE target_node_id = $2", [into.id, from.id]);
      const evidenceB = await client.query("UPDATE knowledge_evidence SET source_node_id = $1 WHERE source_node_id = $2", [into.id, from.id]);
      const observationsA = await client.query("UPDATE knowledge_observations SET target_node_id = $1 WHERE target_node_id = $2", [into.id, from.id]);
      const observationsB = await client.query("UPDATE knowledge_observations SET source_node_id = $1 WHERE source_node_id = $2", [into.id, from.id]);
      const retarget = await client.query("UPDATE knowledge_aliases SET canonical_node_id = $1 WHERE canonical_node_id = $2", [into.id, from.id]);
      let aliasCreated = false; const normalized = normalizeLabel(from.label); const existing = normalized ? await this.getAlias(client, normalized) : null;
      if (normalized && !existing) { await client.query("INSERT INTO knowledge_aliases (id, alias_label, normalized_alias_label, canonical_node_id) VALUES ($1, $2, $2, $3)", [randomUUID(), normalized, into.id]); aliasCreated = true; }
      const description = `${from.description ? `${from.description}; ` : ""}merged into ${into.id} (${into.label}) at ${Date.now()}`;
      await client.query("UPDATE knowledge_nodes SET status = 'rejected', description = $2, updated_at = now(), revision = revision + 1 WHERE id = $1", [from.id, description]);
      await this.insertEdge(client, { id: randomUUID(), fromNodeId: into.id, relation: "same_as", toNodeId: from.id, status: "accepted", createdAt: Date.now() });
      await this.queueProjection(client, into.id, "graph", "rebuild");
      await this.queueProjection(client, into.id, "vector", "upsert");
      await this.queueProjection(client, from.id, "vector", "delete");
      return { from: (await this.getNodeWith(client, from.id))!, into: (await this.getNodeWith(client, into.id))!, edgesRewired: (first.rowCount ?? 0) + (second.rowCount ?? 0), evidenceRewired: (evidenceA.rowCount ?? 0) + (evidenceB.rowCount ?? 0), observationsRewired: (observationsA.rowCount ?? 0) + (observationsB.rowCount ?? 0), aliasesRetargeted: retarget.rowCount ?? 0, aliasCreated };
  }

  async findContradictions(input?: { nodeId?: string; limit?: number }): Promise<ContradictionPair[]> {
    const edges = await this.findEdgesByRelation("contradicts", input?.nodeId, input?.limit ?? 50); const output: ContradictionPair[] = [];
    for (const item of edges) { const from = await this.getNode(item.fromNodeId); const to = await this.getNode(item.toNodeId); if (from && to) output.push({ edge: item, from, to, summary: `${from.label} -[contradicts]-> ${to.label}` }); }
    return output;
  }

  async markContradiction(input: { fromId: string; toId: string; confidence?: number; sourceEventId?: string }): Promise<KnowledgeEdge> {
    if (input.fromId === input.toId) throw new Error("markContradiction: from and to must differ");
    if (!(await this.getNode(input.fromId)) || !(await this.getNode(input.toId))) throw new Error("markContradiction: both nodes must exist");
    const existing = (await this.findEdgesByRelation("contradicts", input.fromId, 50)).find((item) => (item.fromNodeId === input.fromId && item.toNodeId === input.toId) || (item.fromNodeId === input.toId && item.toNodeId === input.fromId));
    if (existing) return existing;
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const edge = await this.insertEdge(client, { id: randomUUID(), fromNodeId: input.fromId, relation: "contradicts", toNodeId: input.toId, confidence: input.confidence, sourceEventId: input.sourceEventId, status: "accepted", createdAt: Date.now() }); await client.query("COMMIT"); return edge; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async supersedeClaim(input: { oldClaimId: string; newClaimId: string; markOldDisputed?: boolean }): Promise<KnowledgeEdge> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const result = await this.supersedeClaimWith(client, input); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async supersedeClaimWith(client: PoolClient, input: { oldClaimId: string; newClaimId: string; markOldDisputed?: boolean }): Promise<KnowledgeEdge> {
      if (input.oldClaimId === input.newClaimId) throw new Error("supersedeClaim: old and new must differ");
      const oldNode = await this.getNodeWith(client, input.oldClaimId); const newNode = await this.getNodeWith(client, input.newClaimId);
      if (oldNode?.type !== "claim") throw new Error("supersedeClaim: oldClaimId must be a claim node"); if (newNode?.type !== "claim") throw new Error("supersedeClaim: newClaimId must be a claim node");
      const result = await this.insertEdge(client, { id: randomUUID(), fromNodeId: newNode.id, relation: "supersedes", toNodeId: oldNode.id, status: "accepted", createdAt: Date.now() });
      if (input.markOldDisputed !== false) {
        await client.query("UPDATE knowledge_nodes SET status = 'disputed', description = concat_ws('; ', description, $2::text), updated_at = now(), revision = revision + 1 WHERE id = $1", [oldNode.id, `superseded by ${newNode.id} (${newNode.label})`]);
        await this.queueProjection(client, oldNode.id, "graph", "rebuild"); await this.queueProjection(client, oldNode.id, "vector", "delete");
      }
      return result;
  }

  async listAliases(canonicalNodeId?: string): Promise<KnowledgeAlias[]> {
    const result = canonicalNodeId ? await this.pool.query("SELECT * FROM knowledge_aliases WHERE canonical_node_id = $1 ORDER BY created_at ASC", [canonicalNodeId]) : await this.pool.query("SELECT * FROM knowledge_aliases ORDER BY created_at ASC");
    return result.rows.map(alias);
  }

  async listAliasesForCanonicalIds(canonicalNodeIds: readonly string[]): Promise<KnowledgeAlias[]> {
    const ids = [...new Set(canonicalNodeIds)];
    if (!ids.length) return [];
    const result = await this.pool.query(
      "SELECT * FROM knowledge_aliases WHERE canonical_node_id = ANY($1::uuid[]) ORDER BY created_at ASC",
      [ids]
    );
    return result.rows.map(alias);
  }

  close(): void { if (this.ownsPool) void this.pool.end(); }

  private async getAlias(db: Queryable, normalized: string): Promise<KnowledgeAlias | null> {
    const result = await db.query("SELECT * FROM knowledge_aliases WHERE normalized_alias_label = $1", [normalized]); return result.rows[0] ? alias(result.rows[0]) : null;
  }

  private async findEdgesByRelation(relation: string, nodeId?: string, limit = 100): Promise<KnowledgeEdge[]> {
    const result = await this.pool.query(
      `SELECT * FROM knowledge_edges WHERE relation = $1 AND status = 'accepted' ${nodeId ? "AND (from_node_id = $2 OR to_node_id = $2)" : ""} ORDER BY created_at DESC LIMIT $${nodeId ? 3 : 2}`,
      nodeId ? [relation, nodeId, limit] : [relation, limit]
    ); return result.rows.map(edge);
  }

  private async insertEdge(db: Queryable, item: KnowledgeEdge): Promise<KnowledgeEdge> {
    const result = await db.query(
      `INSERT INTO knowledge_edges (id, from_node_id, relation, to_node_id, confidence, source_event_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0)) RETURNING *`,
      [item.id, item.fromNodeId, item.relation, item.toNodeId, item.confidence ?? null, item.sourceEventId ?? null, item.status, item.createdAt]
    );
    const created = edge(result.rows[0]);
    if (created.status === "accepted") await this.queueProjection(db, created.id, "graph", "upsert");
    return created;
  }

  private async queueProjection(db: Queryable, canonicalId: string, projection: "graph" | "vector", operation: "upsert" | "delete" | "rebuild"): Promise<void> {
    await db.query(
      `INSERT INTO knowledge_projection_outbox (canonical_id, projection, operation)
       VALUES ($1, $2, $3)`,
      [canonicalId, projection, operation]
    );
  }

  private workspace(payload: Record<string, unknown>): string | null { return payload.workspaceId !== undefined ? payload.workspaceId as string | null : this.defaultWorkspaceId ?? null; }

  private epistemicStatus(payload: Record<string, unknown>): KnowledgeEpistemicStatus {
    const value = String(payload.epistemicStatus ?? "unknown");
    if (!["observed", "supported", "inferred", "hypothesized", "assumed", "established", "unknown"].includes(value)) {
      throw new Error(`invalid epistemic status ${value}`);
    }
    return value as KnowledgeEpistemicStatus;
  }

  private confidence(payload: Record<string, unknown>): number | null {
    if (payload.confidence == null) return null;
    const value = Number(payload.confidence);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("confidence must be between 0 and 1");
    return value;
  }

  private timestamp(payload: Record<string, unknown>, field: "validFrom" | "validTo"): Date | null {
    if (payload[field] == null) return null;
    const value = typeof payload[field] === "number" ? payload[field] : Date.parse(String(payload[field]));
    if (!Number.isFinite(value)) throw new Error(`${field} must be a timestamp`);
    return new Date(value as number);
  }

  private async insertEncounter(db: Queryable, targetNodeId: string, eventId: string, payload: Record<string, unknown>, encounteredLabel?: string): Promise<void> {
    const kind = this.observationKind(payload);
    const metadata = this.observationMetadata(payload, encounteredLabel);
    const sourceNodeIds = stringArray(payload.sourceNodeIds);
    if (sourceNodeIds.length === 0) {
      await this.insertObservation(db, { targetNodeId, sourceEventId: eventId, kind, metadata });
      return;
    }
    for (const sourceNodeId of sourceNodeIds) {
      if (!UUID.test(sourceNodeId) || !(await this.getNodeWith(db, sourceNodeId))) {
        throw new Error(`acceptProposal node: unknown sourceNodeId ${sourceNodeId}`);
      }
      await this.insertObservation(db, { targetNodeId, sourceEventId: eventId, sourceNodeId, kind, metadata });
    }
  }

  private async materializeNode(db: Queryable, payload: Record<string, unknown>, eventId: string, recordEncounter = false): Promise<KnowledgeNode> {
    const type = String(payload.type ?? "concept") as KnowledgeNodeType; const labelValue = String(payload.label ?? "").trim(); if (!labelValue) throw new Error("acceptProposal node: label is required");
    const canonicalId = String(payload.canonicalId ?? payload.identityId ?? "").trim();
    if (canonicalId) {
      if (!UUID.test(canonicalId)) throw new Error("acceptProposal node: canonicalId must be a UUID");
      const existing = await this.getNodeWith(db, canonicalId);
      if (!existing || existing.status === "rejected") throw new Error(`acceptProposal node: canonicalId ${canonicalId} is not reusable`);
      if (recordEncounter) await this.insertEncounter(db, existing.id, eventId, payload, labelValue);
      return existing;
    }
    const knownAlias = await this.getAlias(db, normalizeLabel(labelValue)); if (knownAlias) { const target = await this.getNodeWith(db, knownAlias.canonicalNodeId); if (target && target.status !== "rejected") { if (recordEncounter) await this.insertEncounter(db, target.id, eventId, payload, labelValue); return target; } }
    const result = await db.query(
      `INSERT INTO knowledge_nodes
         (id, type, label, normalized_label, description, status,
          epistemic_status, confidence, workspace_id, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, 'accepted', $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        randomUUID(), type, labelValue, normalizeLabel(labelValue),
        payload.description == null ? `from event ${eventId}` : String(payload.description),
        this.epistemicStatus(payload), this.confidence(payload), this.workspace(payload),
        this.timestamp(payload, "validFrom"), this.timestamp(payload, "validTo"),
      ]
    );
    const created = node(result.rows[0]);
    await this.queueProjection(db, created.id, "graph", "upsert");
    await this.queueProjection(db, created.id, "vector", "upsert");
    if (recordEncounter) await this.insertEncounter(db, created.id, eventId, payload, labelValue);
    return created;
  }

  private observationKind(payload: Record<string, unknown>): KnowledgeObservationKind {
    const value = String(payload.observationKind ?? "observes");
    if (!["mentions", "observes", "independently_formulated", "references", "derived_from"].includes(value)) throw new Error(`invalid observation kind ${value}`);
    return value as KnowledgeObservationKind;
  }

  private observationMetadata(payload: Record<string, unknown>, encounteredLabel?: string): Record<string, unknown> {
    const supplied = payload.observationMetadata;
    const metadata = supplied && typeof supplied === "object" && !Array.isArray(supplied) ? { ...(supplied as Record<string, unknown>) } : {};
    if (payload.derivation && typeof payload.derivation === "object" && !Array.isArray(payload.derivation)) {
      metadata.derivation = payload.derivation;
    }
    if (encounteredLabel) metadata.encounteredLabel = encounteredLabel;
    return metadata;
  }

  private async insertObservation(db: Queryable, item: Omit<KnowledgeObservation, "id" | "observedAt">): Promise<void> {
    await db.query(
      `INSERT INTO knowledge_observations (id, target_node_id, source_event_id, source_node_id, kind, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), item.targetNodeId, item.sourceEventId, item.sourceNodeId ?? null, item.kind, JSON.stringify(item.metadata)]
    );
  }

  private async resolveEndpoint(db: Queryable, value: string, eventId: string): Promise<string> {
    const key = value.trim(); if (!key) throw new Error("edge endpoint is empty");
    const direct = UUID.test(key) ? await this.getNodeWith(db, key) : null; if (direct) return direct.id;
    const knownAlias = await this.getAlias(db, normalizeLabel(key)); if (knownAlias) { const target = await this.getNodeWith(db, knownAlias.canonicalNodeId); if (target && target.status !== "rejected") return target.id; }
    const candidates = await this.findIdentityCandidates(db, key);
    if (candidates.length === 1) return candidates[0].id;
    if (candidates.length > 1) throw new Error(`edge endpoint "${key}" is ambiguous; provide a canonical UUID or alias`);
    return (await this.materializeNode(db, { type: "concept", label: key }, eventId)).id;
  }

  private async materializeEdge(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<KnowledgeEdge> {
    const from = String(payload.fromId ?? payload.from ?? payload.fromLabel ?? "").trim(); const to = String(payload.toId ?? payload.to ?? payload.toLabel ?? "").trim(); if (!from || !to) throw new Error("acceptProposal edge: from and to are required");
    const confidence = payload.confidence == null ? undefined : Number(payload.confidence);
    return this.insertEdge(db, { id: randomUUID(), fromNodeId: await this.resolveEndpoint(db, from, eventId), relation: String(payload.relation ?? "about").trim() || "about", toNodeId: await this.resolveEndpoint(db, to, eventId), confidence: Number.isFinite(confidence) ? confidence : undefined, sourceEventId: eventId, status: "accepted", createdAt: Date.now() });
  }

  private async materializeEvidence(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<void> {
    const targetLabel = String(payload.targetLabel ?? payload.claimLabel ?? payload.claim ?? "").trim();
    const targetId = String(payload.targetId ?? payload.claimId ?? "").trim();
    const claimSpecific = payload.claimId != null || payload.claimLabel != null || payload.claim != null;
    if (!targetId && !targetLabel) throw new Error("acceptProposal evidence: targetId or targetLabel is required");
    const excerpt = String(payload.excerpt ?? "").trim();
    let target = targetId && UUID.test(targetId) ? await this.getNodeWith(db, targetId) : null;
    if (targetId && !target) throw new Error(`acceptProposal evidence: unknown targetId ${targetId}`);
    if (claimSpecific && target && target.type !== "claim") throw new Error("acceptProposal evidence: claimId must reference a claim");
    if (!target) {
      const targetType = claimSpecific ? "claim" : payload.targetType == null ? undefined : String(payload.targetType) as KnowledgeNodeType;
      const candidates = await this.findIdentityCandidates(db, targetLabel, targetType);
      if (candidates.length > 1) throw new Error(`evidence target "${targetLabel}" is ambiguous; provide targetId`);
      target = candidates[0] ?? null;
      if (!target && !targetType) throw new Error(`evidence target "${targetLabel}" is unknown; provide targetId or targetType`);
      target ??= await this.materializeNode(db, { type: targetType, label: targetLabel }, eventId);
    }
    const sourceId = String(payload.sourceId ?? "").trim();
    let source = sourceId && UUID.test(sourceId) ? await this.getNodeWith(db, sourceId) : null;
    if (sourceId && !source) throw new Error(`acceptProposal evidence: unknown sourceId ${sourceId}`);
    if (!source) {
      const sourceLabel = String(payload.sourceLabel ?? (excerpt.slice(0, 80) || `source-${targetLabel || target.id}`));
      source = await this.materializeNode(db, { type: "source", label: sourceLabel, description: excerpt || undefined }, eventId);
    }
    const stance = String(payload.stance ?? "supports");
    if (stance === "mentions") {
      await this.insertObservation(db, { targetNodeId: target.id, sourceEventId: eventId, sourceNodeId: source.id, kind: "mentions", metadata: { excerpt, confidence: payload.confidence } });
      return;
    }
    if (!["supports", "contradicts", "test_evidence"].includes(stance)) throw new Error(`invalid evidence stance ${stance}`);
    await db.query(
      `INSERT INTO knowledge_evidence (id, target_node_id, source_node_id, source_event_id, excerpt, stance, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), target.id, source.id, eventId, excerpt || null, stance, payload.confidence == null ? null : Number(payload.confidence)]
    );
  }

  private async materializeObservation(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<void> {
    const explicitTargetId = String(payload.targetId ?? "").trim();
    const targetLabel = String(payload.targetLabel ?? "").trim();
    if (!explicitTargetId && !targetLabel) throw new Error("acceptProposal observation: targetId or targetLabel is required");
    let target: KnowledgeNode | null = null;
    if (explicitTargetId) {
      if (!UUID.test(explicitTargetId)) throw new Error("acceptProposal observation: targetId must be a UUID");
      target = await this.getNodeWith(db, explicitTargetId);
      if (!target || target.status === "rejected") throw new Error(`acceptProposal observation: targetId ${explicitTargetId} is not reusable`);
    } else {
      const knownAlias = await this.getAlias(db, normalizeLabel(targetLabel));
      if (knownAlias) target = await this.getNodeWith(db, knownAlias.canonicalNodeId);
      if (!target || target.status === "rejected") {
        const targetType = payload.targetType == null ? undefined : String(payload.targetType) as KnowledgeNodeType;
        const candidates = await this.findIdentityCandidates(db, targetLabel, targetType);
        if (candidates.length > 1) throw new Error(`observation target "${targetLabel}" is ambiguous; provide targetId or alias`);
        target = candidates[0] ?? null;
      }
      if (!target) throw new Error(`observation target "${targetLabel}" is unknown; create the canonical identity explicitly first`);
    }
    const sourceId = String(payload.sourceId ?? "").trim();
    let source = sourceId && UUID.test(sourceId) ? await this.getNodeWith(db, sourceId) : null;
    if (sourceId && !source) throw new Error(`acceptProposal observation: unknown sourceId ${sourceId}`);
    const sourceLabel = String(payload.sourceLabel ?? "").trim();
    if (!source && sourceLabel) {
      const aliasMatch = await this.getAlias(db, normalizeLabel(sourceLabel));
      source = aliasMatch ? await this.getNodeWith(db, aliasMatch.canonicalNodeId) : null;
      if (!source) {
        const candidates = await this.findIdentityCandidates(db, sourceLabel, "source");
        if (candidates.length > 1) throw new Error(`observation source "${sourceLabel}" is ambiguous; provide sourceId`);
        source = candidates[0] ?? await this.materializeNode(db, { type: "source", label: sourceLabel }, eventId);
      }
    }
    await this.insertObservation(db, { targetNodeId: target.id, sourceEventId: eventId, sourceNodeId: source?.id, kind: this.observationKind(payload), metadata: this.observationMetadata(payload) });
  }
}

export function createPostgresCanonicalKnowledgeRepository(config: PostgresCanonicalRepositoryConfig): CanonicalKnowledgeRepository {
  return new PostgresCanonicalKnowledgeRepository(config);
}

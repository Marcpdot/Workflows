import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { labelsMatch, normalizeLabel } from "../identity.js";
import type {
  ContradictionPair,
  KnowledgeAlias,
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStatus,
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
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    createdAt: millis(row.created_at as Date),
    updatedAt: millis(row.updated_at as Date),
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
  return {
    id: String(row.id),
    sourceType: row.source_type as KnowledgeEvent["sourceType"],
    sourceRef: String(row.source_ref),
    model: row.model == null ? undefined : String(row.model),
    inputHash: row.input_hash == null ? undefined : String(row.input_hash),
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

  async createEvent(input: { sourceType: KnowledgeEvent["sourceType"]; sourceRef: string; model?: string; inputHash?: string }): Promise<KnowledgeEvent> {
    if (!input.sourceRef?.trim()) throw new Error("createEvent: sourceRef is required");
    const result = await this.pool.query(
      `INSERT INTO knowledge_events (id, source_type, source_ref, model, input_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), input.sourceType, input.sourceRef.trim(), input.model ?? null, input.inputHash ?? null]
    );
    return event(result.rows[0]);
  }

  async getEvent(id: string): Promise<KnowledgeEvent | null> {
    const result = await this.pool.query("SELECT * FROM knowledge_events WHERE id = $1", [id]);
    return result.rows[0] ? event(result.rows[0]) : null;
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
      if (current.kind === "node") await this.materializeNode(client, payload, current.eventId);
      else if (current.kind === "edge") await this.materializeEdge(client, payload, current.eventId);
      else await this.materializeEvidence(client, payload, current.eventId);
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

  private async findNodeByTypeLabel(db: Queryable, type: KnowledgeNodeType, labelValue: string, status?: KnowledgeStatus): Promise<KnowledgeNode | null> {
    const result = await db.query(
      `SELECT * FROM knowledge_nodes WHERE type = $1 AND lower(label) = lower($2) ${status ? "AND status = $3" : ""} ORDER BY created_at ASC LIMIT 1`,
      status ? [type, labelValue, status] : [type, labelValue]
    );
    return result.rows[0] ? node(result.rows[0]) : null;
  }

  private async edgesFor(db: Queryable, ids: string[], status: KnowledgeStatus): Promise<KnowledgeEdge[]> {
    if (!ids.length) return [];
    const result = await db.query(
      "SELECT * FROM knowledge_edges WHERE status = $1 AND (from_node_id = ANY($2::uuid[]) OR to_node_id = ANY($2::uuid[])) ORDER BY created_at ASC",
      [status, ids]
    );
    return result.rows.map(edge);
  }

  async getNeighborhood(nodeId: string, options?: { hops?: 1 | 2; status?: KnowledgeStatus }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    const root = await this.getNode(nodeId); if (!root) return { nodes: [], edges: [] };
    const status = options?.status ?? "accepted"; const hops = options?.hops === 2 ? 2 : 1;
    const nodes = new Map([[root.id, root]]); const edges = new Map<string, KnowledgeEdge>(); let frontier = [root.id];
    for (let i = 0; i < hops; i++) {
      const found = await this.edgesFor(this.pool, frontier, status); const next: string[] = [];
      for (const item of found) {
        edges.set(item.id, item);
        for (const id of [item.fromNodeId, item.toNodeId]) if (!nodes.has(id)) {
          const foundNode = await this.getNode(id);
          if (foundNode && foundNode.status === status) { nodes.set(id, foundNode); next.push(id); }
        }
      }
      frontier = next;
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  async getSubgraph(input?: { rootId?: string; nodeIds?: string[]; hops?: 1 | 2; status?: KnowledgeStatus; workspaceId?: string | null; limit?: number }): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; truncated: boolean }> {
    const status = input?.status ?? "accepted";
    const limit = Math.min(input?.limit && input.limit > 0 ? Math.floor(input.limit) : 250, 1000);
    let candidates: KnowledgeNode[];
    if (input?.rootId) {
      const root = await this.getNode(input.rootId);
      if (!root || root.status !== status) return { nodes: [], edges: [], truncated: false };
      candidates = (await this.getNeighborhood(root.id, { hops: input.hops === 2 ? 2 : 1, status })).nodes;
    } else if (input?.nodeIds?.length) {
      candidates = [];
      for (const id of [...new Set(input.nodeIds)]) { const item = await this.getNode(id); if (item?.status === status) candidates.push(item); }
    } else candidates = await this.findNodes({ status, workspaceId: input?.workspaceId, limit: limit + 1 });
    if (input?.workspaceId !== undefined) candidates = candidates.filter((item) => item.workspaceId === input.workspaceId);
    const truncated = candidates.length > limit; const nodes = candidates.slice(0, limit); const ids = new Set(nodes.map((item) => item.id));
    const edges = (await this.edgesFor(this.pool, [...ids], status)).filter((item) => ids.has(item.fromNodeId) && ids.has(item.toNodeId));
    return { nodes, edges, truncated };
  }

  async ensureProject(input: { label: string; description?: string; workspaceId?: string | null; createAccepted?: boolean }): Promise<KnowledgeNode> {
    const labelValue = input.label?.trim(); if (!labelValue) throw new Error("ensureProject: label is required");
    const existing = await this.findNodeByTypeLabel(this.pool, "project", labelValue, "accepted"); if (existing) return existing;
    if (input.createAccepted === false) throw new Error(`ensureProject: no accepted project "${labelValue}" and createAccepted=false`);
    const workspaceId = input.workspaceId !== undefined ? input.workspaceId : this.defaultWorkspaceId ?? null;
    const result = await this.pool.query(
      `INSERT INTO knowledge_nodes (id, type, label, normalized_label, description, status, workspace_id)
       VALUES ($1, 'project', $2, $3, $4, 'accepted', $5) RETURNING *`,
      [randomUUID(), labelValue, normalizeLabel(labelValue), input.description ?? null, workspaceId]
    );
    const created = node(result.rows[0]);
    await this.queueProjection(this.pool, created.id, "graph", "upsert");
    await this.queueProjection(this.pool, created.id, "vector", "upsert");
    return created;
  }

  async linkToProject(input: { nodeId: string; projectId: string; relation?: ProjectLinkRelation; sourceEventId?: string }): Promise<KnowledgeEdge> {
    const source = await this.getNode(input.nodeId); const project = await this.getNode(input.projectId);
    if (!source) throw new Error(`linkToProject: unknown nodeId ${input.nodeId}`);
    if (!project || project.type !== "project") throw new Error("linkToProject: projectId must be an accepted project node");
    if (project.status !== "accepted") throw new Error("linkToProject: project is not accepted");
    return this.insertEdge(this.pool, { id: randomUUID(), fromNodeId: source.id, relation: input.relation ?? "used_in", toNodeId: project.id, sourceEventId: input.sourceEventId, status: "accepted", createdAt: Date.now() });
  }

  async unlinkFromProject(input: { nodeId: string; projectId: string }): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM knowledge_edges WHERE from_node_id = $1 AND to_node_id = $2 AND relation = ANY($3::text[])", [input.nodeId, input.projectId, PROJECT_RELATIONS]);
    return (result.rowCount ?? 0) > 0;
  }

  async getProjectStatus(input: { projectId?: string; label?: string; workspaceId?: string | null; hops?: 1 | 2 }): Promise<ProjectStatus> {
    const project = input.projectId ? await this.getNode(input.projectId) : input.label ? await this.findNodeByTypeLabel(this.pool, "project", input.label, "accepted") : null;
    if (!project || project.type !== "project") throw new Error("getProjectStatus: provide projectId or label of an existing project");
    if (input.workspaceId != null && project.workspaceId && project.workspaceId !== input.workspaceId) throw new Error(`getProjectStatus: project workspace mismatch (want ${input.workspaceId})`);
    const graph = await this.getNeighborhood(project.id, { hops: input.hops === 2 ? 2 : 1, status: "accepted" });
    const linkedNodes = graph.nodes.filter((item) => item.id !== project.id);
    const claims = linkedNodes.filter((item) => item.type === "claim"); const concepts = linkedNodes.filter((item) => item.type === "concept"); const artifacts = linkedNodes.filter((item) => item.type === "artifact");
    const pending = await this.listProposals({ status: "pending" }); const needle = project.label.toLowerCase();
    const pendingProposalCount = pending.filter((item) => { const raw = JSON.stringify(item.payload).toLowerCase(); return raw.includes(needle) || raw.includes(project.id.toLowerCase()); }).length;
    const summaryLines = [`project: ${project.label} (${project.status})`, `workspace: ${project.workspaceId ?? "none"}`, `claims: ${claims.length} | concepts: ${concepts.length} | artifacts: ${artifacts.length}`, ...claims.slice(0, 8).map((item) => `- claim: ${item.label}`), `pending proposals: ${pendingProposalCount}`];
    return { project, workspaceId: project.workspaceId, linkedNodes, edges: graph.edges, claims, concepts, artifacts, pendingProposalCount, summaryLines };
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
    if (input.type) {
      const exact = await this.findNodeByTypeLabel(this.pool, input.type, raw, "accepted"); if (exact) return exact;
      return (await this.findNodes({ type: input.type, status: "accepted", limit: 100 })).find((item) => labelsMatch(item.label, raw)) ?? null;
    }
    for (const type of ["concept", "claim", "project", "artifact", "source", "event"] as KnowledgeNodeType[]) { const exact = await this.findNodeByTypeLabel(this.pool, type, raw, "accepted"); if (exact) return exact; }
    return (await this.findNodes({ status: "accepted", limit: 200 })).find((item) => labelsMatch(item.label, raw)) ?? null;
  }

  async mergeNodes(input: { fromId: string; intoId: string }): Promise<MergeNodesResult> {
    if (input.fromId === input.intoId) throw new Error("mergeNodes: fromId and intoId must differ");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); const from = await this.getNodeWith(client, input.fromId); const into = await this.getNodeWith(client, input.intoId);
      if (!from) throw new Error(`mergeNodes: unknown fromId ${input.fromId}`); if (!into) throw new Error(`mergeNodes: unknown intoId ${input.intoId}`); if (into.status === "rejected") throw new Error("mergeNodes: into node is rejected");
      const first = await client.query("UPDATE knowledge_edges SET from_node_id = $1 WHERE from_node_id = $2", [into.id, from.id]);
      const second = await client.query("UPDATE knowledge_edges SET to_node_id = $1 WHERE to_node_id = $2", [into.id, from.id]);
      await client.query("DELETE FROM knowledge_edges WHERE from_node_id = to_node_id");
      const evidenceA = await client.query("UPDATE knowledge_evidence SET claim_node_id = $1 WHERE claim_node_id = $2", [into.id, from.id]);
      const evidenceB = await client.query("UPDATE knowledge_evidence SET source_node_id = $1 WHERE source_node_id = $2", [into.id, from.id]);
      const retarget = await client.query("UPDATE knowledge_aliases SET canonical_node_id = $1 WHERE canonical_node_id = $2", [into.id, from.id]);
      let aliasCreated = false; const normalized = normalizeLabel(from.label); const existing = normalized ? await this.getAlias(client, normalized) : null;
      if (normalized && !existing) { await client.query("INSERT INTO knowledge_aliases (id, alias_label, normalized_alias_label, canonical_node_id) VALUES ($1, $2, $2, $3)", [randomUUID(), normalized, into.id]); aliasCreated = true; }
      const description = `${from.description ? `${from.description}; ` : ""}merged into ${into.id} (${into.label}) at ${Date.now()}`;
      await client.query("UPDATE knowledge_nodes SET status = 'rejected', description = $2, updated_at = now(), revision = revision + 1 WHERE id = $1", [from.id, description]);
      await this.insertEdge(client, { id: randomUUID(), fromNodeId: into.id, relation: "same_as", toNodeId: from.id, status: "accepted", createdAt: Date.now() });
      await this.queueProjection(client, into.id, "graph", "rebuild");
      await this.queueProjection(client, into.id, "vector", "upsert");
      await this.queueProjection(client, from.id, "vector", "delete");
      await client.query("COMMIT");
      return { from: (await this.getNode(from.id))!, into: (await this.getNode(into.id))!, edgesRewired: (first.rowCount ?? 0) + (second.rowCount ?? 0), evidenceRewired: (evidenceA.rowCount ?? 0) + (evidenceB.rowCount ?? 0), aliasesRetargeted: retarget.rowCount ?? 0, aliasCreated };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
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
    return this.insertEdge(this.pool, { id: randomUUID(), fromNodeId: input.fromId, relation: "contradicts", toNodeId: input.toId, confidence: input.confidence, sourceEventId: input.sourceEventId, status: "accepted", createdAt: Date.now() });
  }

  async supersedeClaim(input: { oldClaimId: string; newClaimId: string; markOldDisputed?: boolean }): Promise<KnowledgeEdge> {
    if (input.oldClaimId === input.newClaimId) throw new Error("supersedeClaim: old and new must differ");
    const oldNode = await this.getNode(input.oldClaimId); const newNode = await this.getNode(input.newClaimId);
    if (oldNode?.type !== "claim") throw new Error("supersedeClaim: oldClaimId must be a claim node"); if (newNode?.type !== "claim") throw new Error("supersedeClaim: newClaimId must be a claim node");
    const result = await this.insertEdge(this.pool, { id: randomUUID(), fromNodeId: newNode.id, relation: "supersedes", toNodeId: oldNode.id, status: "accepted", createdAt: Date.now() });
    if (input.markOldDisputed !== false) await this.pool.query("UPDATE knowledge_nodes SET status = 'disputed', description = concat_ws('; ', description, $2::text), updated_at = now(), revision = revision + 1 WHERE id = $1", [oldNode.id, `superseded by ${newNode.id} (${newNode.label})`]);
    return result;
  }

  async listAliases(canonicalNodeId?: string): Promise<KnowledgeAlias[]> {
    const result = canonicalNodeId ? await this.pool.query("SELECT * FROM knowledge_aliases WHERE canonical_node_id = $1 ORDER BY created_at ASC", [canonicalNodeId]) : await this.pool.query("SELECT * FROM knowledge_aliases ORDER BY created_at ASC");
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

  private async materializeNode(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<KnowledgeNode> {
    const type = String(payload.type ?? "concept") as KnowledgeNodeType; const labelValue = String(payload.label ?? "").trim(); if (!labelValue) throw new Error("acceptProposal node: label is required");
    const knownAlias = await this.getAlias(db, normalizeLabel(labelValue)); if (knownAlias) { const target = await this.getNodeWith(db, knownAlias.canonicalNodeId); if (target && target.status !== "rejected") return target; }
    const exact = await this.findNodeByTypeLabel(db, type, labelValue, "accepted"); if (exact) return exact;
    const fuzzy = (await this.findNodesWith(db, { type, status: "accepted", limit: 100 })).find((item) => labelsMatch(item.label, labelValue)); if (fuzzy) return fuzzy;
    const result = await db.query(
      `INSERT INTO knowledge_nodes (id, type, label, normalized_label, description, status, workspace_id)
       VALUES ($1, $2, $3, $4, $5, 'accepted', $6) RETURNING *`,
      [randomUUID(), type, labelValue, normalizeLabel(labelValue), payload.description == null ? `from event ${eventId}` : String(payload.description), this.workspace(payload)]
    );
    const created = node(result.rows[0]);
    await this.queueProjection(db, created.id, "graph", "upsert");
    await this.queueProjection(db, created.id, "vector", "upsert");
    return created;
  }

  private async resolveEndpoint(db: Queryable, value: string, eventId: string): Promise<string> {
    const key = value.trim(); if (!key) throw new Error("edge endpoint is empty");
    const direct = UUID.test(key) ? await this.getNodeWith(db, key) : null; if (direct) return direct.id;
    const knownAlias = await this.getAlias(db, normalizeLabel(key)); if (knownAlias) { const target = await this.getNodeWith(db, knownAlias.canonicalNodeId); if (target && target.status !== "rejected") return target.id; }
    for (const type of ["concept", "claim", "project", "artifact", "source", "event"] as KnowledgeNodeType[]) { const exact = await this.findNodeByTypeLabel(db, type, key, "accepted"); if (exact) return exact.id; }
    const fuzzy = (await this.findNodesWith(db, { status: "accepted", limit: 200 })).find((item) => labelsMatch(item.label, key)); if (fuzzy) return fuzzy.id;
    return (await this.materializeNode(db, { type: "concept", label: key }, eventId)).id;
  }

  private async materializeEdge(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<KnowledgeEdge> {
    const from = String(payload.from ?? payload.fromLabel ?? "").trim(); const to = String(payload.to ?? payload.toLabel ?? "").trim(); if (!from || !to) throw new Error("acceptProposal edge: from and to are required");
    const confidence = payload.confidence == null ? undefined : Number(payload.confidence);
    return this.insertEdge(db, { id: randomUUID(), fromNodeId: await this.resolveEndpoint(db, from, eventId), relation: String(payload.relation ?? "about").trim() || "about", toNodeId: await this.resolveEndpoint(db, to, eventId), confidence: Number.isFinite(confidence) ? confidence : undefined, sourceEventId: eventId, status: "accepted", createdAt: Date.now() });
  }

  private async materializeEvidence(db: Queryable, payload: Record<string, unknown>, eventId: string): Promise<void> {
    const claimLabel = String(payload.claimLabel ?? payload.claim ?? "").trim(); if (!claimLabel) throw new Error("acceptProposal evidence: claimLabel is required"); const excerpt = String(payload.excerpt ?? "").trim();
    let claim = await this.findNodeByTypeLabel(db, "claim", claimLabel, "accepted") ?? await this.findNodeByTypeLabel(db, "claim", claimLabel); if (!claim) claim = await this.materializeNode(db, { type: "claim", label: claimLabel }, eventId);
    const sourceLabel = excerpt.slice(0, 80) || `source-${claimLabel}`; let source = await this.findNodeByTypeLabel(db, "source", sourceLabel, "accepted"); if (!source) source = await this.materializeNode(db, { type: "source", label: sourceLabel, description: excerpt || undefined }, eventId);
    await db.query(
      `INSERT INTO knowledge_evidence (id, claim_node_id, source_node_id, source_event_id, excerpt, stance, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), claim.id, source.id, eventId, excerpt || null, String(payload.stance ?? "mentions"), payload.confidence == null ? null : Number(payload.confidence)]
    );
  }
}

export function createPostgresCanonicalKnowledgeRepository(config: PostgresCanonicalRepositoryConfig): CanonicalKnowledgeRepository {
  return new PostgresCanonicalKnowledgeRepository(config);
}

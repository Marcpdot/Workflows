/**
 * SQLite persistence for semantic knowledge graph (M11).
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeEvidence,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStatus,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kn_type ON knowledge_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kn_label ON knowledge_nodes(label);
CREATE INDEX IF NOT EXISTS idx_kn_workspace ON knowledge_nodes(workspace_id);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  confidence REAL,
  source_event_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_ke_from ON knowledge_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_ke_to ON knowledge_edges(to_node_id);

CREATE TABLE IF NOT EXISTS knowledge_events (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  model TEXT,
  input_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_evidence (
  id TEXT PRIMARY KEY,
  claim_node_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  excerpt TEXT,
  stance TEXT NOT NULL,
  confidence REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_proposals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kp_status ON knowledge_proposals(status);
CREATE INDEX IF NOT EXISTS idx_kp_event ON knowledge_proposals(event_id);

CREATE TABLE IF NOT EXISTS knowledge_aliases (
  id TEXT PRIMARY KEY,
  alias_label TEXT NOT NULL,
  canonical_node_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(alias_label),
  FOREIGN KEY (canonical_node_id) REFERENCES knowledge_nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_ka_canonical ON knowledge_aliases(canonical_node_id);
`;

export class KnowledgeSqliteStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    try {
      const dir = dirname(dbPath);
      if (dir && dir !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
      this.db.exec(SCHEMA);
    } catch (err) {
      throw new Error(
        `Failed to open knowledge database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  close(): void {
    this.db.close();
  }

  insertEvent(ev: KnowledgeEvent): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_events (id, source_type, source_ref, model, input_hash, created_at)
         VALUES (@id, @sourceType, @sourceRef, @model, @inputHash, @createdAt)`
      )
      .run({
        id: ev.id,
        sourceType: ev.sourceType,
        sourceRef: ev.sourceRef,
        model: ev.model ?? null,
        inputHash: ev.inputHash ?? null,
        createdAt: ev.createdAt,
      });
  }

  getEvent(id: string): KnowledgeEvent | null {
    const row = this.db
      .prepare(
        `SELECT id, source_type AS sourceType, source_ref AS sourceRef, model,
                input_hash AS inputHash, created_at AS createdAt
         FROM knowledge_events WHERE id = ?`
      )
      .get(id) as KnowledgeEvent | undefined;
    return row ?? null;
  }

  insertProposal(p: KnowledgeProposal): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_proposals (id, event_id, kind, payload, status, created_at, resolved_at)
         VALUES (@id, @eventId, @kind, @payload, @status, @createdAt, @resolvedAt)`
      )
      .run({
        id: p.id,
        eventId: p.eventId,
        kind: p.kind,
        payload: JSON.stringify(p.payload),
        status: p.status,
        createdAt: p.createdAt,
        resolvedAt: p.resolvedAt ?? null,
      });
  }

  getProposal(id: string): KnowledgeProposal | null {
    const row = this.db
      .prepare(
        `SELECT id, event_id AS eventId, kind, payload, status,
                created_at AS createdAt, resolved_at AS resolvedAt
         FROM knowledge_proposals WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          eventId: string;
          kind: KnowledgeProposal["kind"];
          payload: string;
          status: KnowledgeProposal["status"];
          createdAt: number;
          resolvedAt: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.eventId,
      kind: row.kind,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? undefined,
    };
  }

  listProposals(filter?: {
    status?: KnowledgeProposal["status"];
    eventId?: string;
  }): KnowledgeProposal[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.eventId) {
      clauses.push("event_id = ?");
      params.push(filter.eventId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, event_id AS eventId, kind, payload, status,
                created_at AS createdAt, resolved_at AS resolvedAt
         FROM knowledge_proposals ${where}
         ORDER BY created_at ASC`
      )
      .all(...params) as Array<{
      id: string;
      eventId: string;
      kind: KnowledgeProposal["kind"];
      payload: string;
      status: KnowledgeProposal["status"];
      createdAt: number;
      resolvedAt: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      kind: row.kind,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? undefined,
    }));
  }

  updateProposalStatus(
    id: string,
    status: KnowledgeProposal["status"],
    resolvedAt: number
  ): void {
    this.db
      .prepare(
        `UPDATE knowledge_proposals SET status = ?, resolved_at = ? WHERE id = ?`
      )
      .run(status, resolvedAt, id);
  }

  insertNode(n: KnowledgeNode): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_nodes
         (id, type, label, description, status, workspace_id, created_at, updated_at)
         VALUES (@id, @type, @label, @description, @status, @workspaceId, @createdAt, @updatedAt)`
      )
      .run({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description ?? null,
        status: n.status,
        workspaceId: n.workspaceId ?? null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      });
  }

  getNode(id: string): KnowledgeNode | null {
    const row = this.db
      .prepare(
        `SELECT id, type, label, description, status,
                workspace_id AS workspaceId, created_at AS createdAt, updated_at AS updatedAt
         FROM knowledge_nodes WHERE id = ?`
      )
      .get(id) as
      | {
          id: string;
          type: KnowledgeNodeType;
          label: string;
          description: string | null;
          status: KnowledgeStatus;
          workspaceId: string | null;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      description: row.description ?? undefined,
      status: row.status,
      workspaceId: row.workspaceId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  findNodeByTypeLabel(
    type: KnowledgeNodeType,
    label: string,
    status?: KnowledgeStatus
  ): KnowledgeNode | null {
    if (status) {
      const row = this.db
        .prepare(
          `SELECT id FROM knowledge_nodes
           WHERE type = ? AND LOWER(label) = LOWER(?) AND status = ?
           LIMIT 1`
        )
        .get(type, label, status) as { id: string } | undefined;
      return row ? this.getNode(row.id) : null;
    }
    const row = this.db
      .prepare(
        `SELECT id FROM knowledge_nodes
         WHERE type = ? AND LOWER(label) = LOWER(?)
         LIMIT 1`
      )
      .get(type, label) as { id: string } | undefined;
    return row ? this.getNode(row.id) : null;
  }

  findNodes(query: {
    type?: KnowledgeNodeType;
    label?: string;
    workspaceId?: string | null;
    status?: KnowledgeStatus;
    limit?: number;
  }): KnowledgeNode[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.type) {
      clauses.push("type = ?");
      params.push(query.type);
    }
    if (query.label) {
      clauses.push("LOWER(label) LIKE LOWER(?)");
      params.push(`%${query.label}%`);
    }
    if (query.workspaceId !== undefined) {
      if (query.workspaceId === null) {
        clauses.push("workspace_id IS NULL");
      } else {
        clauses.push("workspace_id = ?");
        params.push(query.workspaceId);
      }
    }
    if (query.status) {
      clauses.push("status = ?");
      params.push(query.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit =
      query.limit && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : 50;
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id FROM knowledge_nodes ${where}
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...params) as Array<{ id: string }>;
    return rows
      .map((r) => this.getNode(r.id))
      .filter((n): n is KnowledgeNode => n != null);
  }

  insertEdge(e: KnowledgeEdge): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_edges
         (id, from_node_id, relation, to_node_id, confidence, source_event_id, status, created_at)
         VALUES (@id, @fromNodeId, @relation, @toNodeId, @confidence, @sourceEventId, @status, @createdAt)`
      )
      .run({
        id: e.id,
        fromNodeId: e.fromNodeId,
        relation: e.relation,
        toNodeId: e.toNodeId,
        confidence: e.confidence ?? null,
        sourceEventId: e.sourceEventId ?? null,
        status: e.status,
        createdAt: e.createdAt,
      });
  }

  insertEvidence(ev: KnowledgeEvidence): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_evidence
         (id, claim_node_id, source_node_id, excerpt, stance, confidence, created_at)
         VALUES (@id, @claimNodeId, @sourceNodeId, @excerpt, @stance, @confidence, @createdAt)`
      )
      .run({
        id: ev.id,
        claimNodeId: ev.claimNodeId,
        sourceNodeId: ev.sourceNodeId,
        excerpt: ev.excerpt ?? null,
        stance: ev.stance,
        confidence: ev.confidence ?? null,
        createdAt: ev.createdAt,
      });
  }

  deleteEdgeBetween(
    fromNodeId: string,
    toNodeId: string,
    relations?: string[]
  ): number {
    if (relations && relations.length > 0) {
      const ph = relations.map(() => "?").join(",");
      const r = this.db
        .prepare(
          `DELETE FROM knowledge_edges
           WHERE from_node_id = ? AND to_node_id = ?
             AND relation IN (${ph})`
        )
        .run(fromNodeId, toNodeId, ...relations);
      return r.changes;
    }
    const r = this.db
      .prepare(
        `DELETE FROM knowledge_edges
         WHERE from_node_id = ? AND to_node_id = ?`
      )
      .run(fromNodeId, toNodeId);
    return r.changes;
  }

  getEdgesFromOrTo(
    nodeIds: string[],
    status?: KnowledgeStatus
  ): KnowledgeEdge[] {
    if (nodeIds.length === 0) return [];
    const placeholders = nodeIds.map(() => "?").join(",");
    const statusClause = status ? " AND status = ?" : "";
    const params: unknown[] = [...nodeIds, ...nodeIds];
    if (status) params.push(status);
    const rows = this.db
      .prepare(
        `SELECT id, from_node_id AS fromNodeId, relation, to_node_id AS toNodeId,
                confidence, source_event_id AS sourceEventId, status, created_at AS createdAt
         FROM knowledge_edges
         WHERE (from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders}))
         ${statusClause}`
      )
      .all(...params) as Array<{
      id: string;
      fromNodeId: string;
      relation: string;
      toNodeId: string;
      confidence: number | null;
      sourceEventId: string | null;
      status: KnowledgeStatus;
      createdAt: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      fromNodeId: r.fromNodeId,
      relation: r.relation,
      toNodeId: r.toNodeId,
      confidence: r.confidence ?? undefined,
      sourceEventId: r.sourceEventId ?? undefined,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /** M15: list edges by relation (optionally involving a node). */
  findEdgesByRelation(
    relation: string,
    options?: { nodeId?: string; status?: KnowledgeStatus; limit?: number }
  ): KnowledgeEdge[] {
    const clauses: string[] = ["relation = ?"];
    const params: unknown[] = [relation];
    if (options?.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    if (options?.nodeId) {
      clauses.push("(from_node_id = ? OR to_node_id = ?)");
      params.push(options.nodeId, options.nodeId);
    }
    const limit =
      options?.limit && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : 100;
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT id, from_node_id AS fromNodeId, relation, to_node_id AS toNodeId,
                confidence, source_event_id AS sourceEventId, status, created_at AS createdAt
         FROM knowledge_edges
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(...params) as Array<{
      id: string;
      fromNodeId: string;
      relation: string;
      toNodeId: string;
      confidence: number | null;
      sourceEventId: string | null;
      status: KnowledgeStatus;
      createdAt: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      fromNodeId: r.fromNodeId,
      relation: r.relation,
      toNodeId: r.toNodeId,
      confidence: r.confidence ?? undefined,
      sourceEventId: r.sourceEventId ?? undefined,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  updateNodeStatus(
    id: string,
    status: KnowledgeStatus,
    updatedAt: number,
    description?: string | null
  ): void {
    if (description !== undefined) {
      this.db
        .prepare(
          `UPDATE knowledge_nodes
           SET status = ?, updated_at = ?, description = ?
           WHERE id = ?`
        )
        .run(status, updatedAt, description, id);
    } else {
      this.db
        .prepare(
          `UPDATE knowledge_nodes SET status = ?, updated_at = ? WHERE id = ?`
        )
        .run(status, updatedAt, id);
    }
  }

  /** Point all edges that reference fromId at intoId (merge rewire). */
  rewireEdges(fromId: string, intoId: string): number {
    const a = this.db
      .prepare(
        `UPDATE knowledge_edges SET from_node_id = ? WHERE from_node_id = ?`
      )
      .run(intoId, fromId);
    const b = this.db
      .prepare(
        `UPDATE knowledge_edges SET to_node_id = ? WHERE to_node_id = ?`
      )
      .run(intoId, fromId);
    return a.changes + b.changes;
  }

  /** Remove edges where from == to (self-loops after merge). */
  deleteSelfLoopEdges(): number {
    const r = this.db
      .prepare(
        `DELETE FROM knowledge_edges WHERE from_node_id = to_node_id`
      )
      .run();
    return r.changes;
  }

  rewireEvidence(fromId: string, intoId: string): number {
    const a = this.db
      .prepare(
        `UPDATE knowledge_evidence SET claim_node_id = ? WHERE claim_node_id = ?`
      )
      .run(intoId, fromId);
    const b = this.db
      .prepare(
        `UPDATE knowledge_evidence SET source_node_id = ? WHERE source_node_id = ?`
      )
      .run(intoId, fromId);
    return a.changes + b.changes;
  }

  insertAlias(row: {
    id: string;
    aliasLabel: string;
    canonicalNodeId: string;
    createdAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO knowledge_aliases (id, alias_label, canonical_node_id, created_at)
         VALUES (@id, @aliasLabel, @canonicalNodeId, @createdAt)`
      )
      .run(row);
  }

  getAlias(aliasLabel: string): {
    id: string;
    aliasLabel: string;
    canonicalNodeId: string;
    createdAt: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, alias_label AS aliasLabel, canonical_node_id AS canonicalNodeId,
                created_at AS createdAt
         FROM knowledge_aliases WHERE alias_label = ?`
      )
      .get(aliasLabel) as
      | {
          id: string;
          aliasLabel: string;
          canonicalNodeId: string;
          createdAt: number;
        }
      | undefined;
    return row ?? null;
  }

  retargetAliases(fromCanonicalId: string, intoCanonicalId: string): number {
    const r = this.db
      .prepare(
        `UPDATE knowledge_aliases
         SET canonical_node_id = ?
         WHERE canonical_node_id = ?`
      )
      .run(intoCanonicalId, fromCanonicalId);
    return r.changes;
  }

  listAliases(canonicalNodeId?: string): Array<{
    id: string;
    aliasLabel: string;
    canonicalNodeId: string;
    createdAt: number;
  }> {
    if (canonicalNodeId) {
      return this.db
        .prepare(
          `SELECT id, alias_label AS aliasLabel, canonical_node_id AS canonicalNodeId,
                  created_at AS createdAt
           FROM knowledge_aliases WHERE canonical_node_id = ?
           ORDER BY created_at ASC`
        )
        .all(canonicalNodeId) as Array<{
        id: string;
        aliasLabel: string;
        canonicalNodeId: string;
        createdAt: number;
      }>;
    }
    return this.db
      .prepare(
        `SELECT id, alias_label AS aliasLabel, canonical_node_id AS canonicalNodeId,
                created_at AS createdAt
         FROM knowledge_aliases
         ORDER BY created_at ASC`
      )
      .all() as Array<{
      id: string;
      aliasLabel: string;
      canonicalNodeId: string;
      createdAt: number;
    }>;
  }
}

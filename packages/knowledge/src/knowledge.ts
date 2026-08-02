/**
 * High-level KnowledgeStore API (Milestone 11).
 */

import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { KnowledgeSqliteStore } from "./store.js";
import type {
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStatus,
  KnowledgeStore,
  KnowledgeStoreConfig,
} from "./types.js";

function mergePayload(
  base: Record<string, unknown>,
  edits?: Record<string, unknown>
): Record<string, unknown> {
  if (!edits) return { ...base };
  return { ...base, ...edits };
}

class SqliteKnowledgeStore implements KnowledgeStore {
  private readonly store: KnowledgeSqliteStore;

  constructor(config: KnowledgeStoreConfig) {
    if (!config.dbPath?.trim()) {
      throw new Error("KnowledgeStoreConfig.dbPath is required");
    }
    this.store = new KnowledgeSqliteStore(config.dbPath);
  }

  async createEvent(input: {
    sourceType: KnowledgeEvent["sourceType"];
    sourceRef: string;
    model?: string;
    inputHash?: string;
  }): Promise<KnowledgeEvent> {
    if (!input.sourceRef?.trim()) {
      throw new Error("createEvent: sourceRef is required");
    }
    const ev: KnowledgeEvent = {
      id: randomUUID(),
      sourceType: input.sourceType,
      sourceRef: input.sourceRef.trim(),
      model: input.model,
      inputHash: input.inputHash,
      createdAt: Date.now(),
    };
    this.store.insertEvent(ev);
    return ev;
  }

  async addProposals(
    eventId: string,
    items: Array<{
      kind: KnowledgeProposal["kind"];
      payload: Record<string, unknown>;
    }>
  ): Promise<KnowledgeProposal[]> {
    if (!this.store.getEvent(eventId)) {
      throw new Error(`addProposals: unknown eventId ${eventId}`);
    }
    const now = Date.now();
    const out: KnowledgeProposal[] = [];
    for (const item of items) {
      const p: KnowledgeProposal = {
        id: randomUUID(),
        eventId,
        kind: item.kind,
        payload: item.payload,
        status: "pending",
        createdAt: now,
      };
      this.store.insertProposal(p);
      out.push(p);
    }
    return out;
  }

  async listProposals(filter?: {
    status?: KnowledgeProposal["status"];
    eventId?: string;
  }): Promise<KnowledgeProposal[]> {
    return this.store.listProposals(filter);
  }

  async acceptProposal(
    id: string,
    edits?: Record<string, unknown>
  ): Promise<void> {
    const proposal = this.store.getProposal(id);
    if (!proposal) {
      throw new Error(`acceptProposal: unknown id ${id}`);
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `acceptProposal: proposal ${id} is already ${proposal.status}`
      );
    }

    const payload = mergePayload(proposal.payload, edits);
    const now = Date.now();

    if (proposal.kind === "node") {
      this.materializeNode(payload, proposal.eventId, now);
    } else if (proposal.kind === "edge") {
      this.materializeEdge(payload, proposal.eventId, now);
    } else if (proposal.kind === "evidence") {
      this.materializeEvidence(payload, now);
    }

    this.store.updateProposalStatus(id, "accepted", now);
  }

  async rejectProposal(id: string): Promise<void> {
    const proposal = this.store.getProposal(id);
    if (!proposal) {
      throw new Error(`rejectProposal: unknown id ${id}`);
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `rejectProposal: proposal ${id} is already ${proposal.status}`
      );
    }
    this.store.updateProposalStatus(id, "rejected", Date.now());
  }

  async getNode(id: string): Promise<KnowledgeNode | null> {
    return this.store.getNode(id);
  }

  async findNodes(query: {
    type?: KnowledgeNodeType;
    label?: string;
    workspaceId?: string | null;
    status?: KnowledgeStatus;
    limit?: number;
  }): Promise<KnowledgeNode[]> {
    return this.store.findNodes(query);
  }

  async getNeighborhood(
    nodeId: string,
    options?: { hops?: 1 | 2; status?: KnowledgeStatus }
  ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    const root = this.store.getNode(nodeId);
    if (!root) {
      return { nodes: [], edges: [] };
    }
    const hops = options?.hops === 2 ? 2 : 1;
    const status = options?.status ?? "accepted";

    const nodeMap = new Map<string, KnowledgeNode>();
    nodeMap.set(root.id, root);
    let frontier = [root.id];
    const allEdges: KnowledgeEdge[] = [];
    const edgeIds = new Set<string>();

    for (let h = 0; h < hops; h++) {
      const edges = this.store.getEdgesFromOrTo(frontier, status);
      const next: string[] = [];
      for (const e of edges) {
        if (!edgeIds.has(e.id)) {
          edgeIds.add(e.id);
          allEdges.push(e);
        }
        for (const nid of [e.fromNodeId, e.toNodeId]) {
          if (!nodeMap.has(nid)) {
            const n = this.store.getNode(nid);
            if (n && (!status || n.status === status || n.id === root.id)) {
              // Include endpoints that match status filter (or root)
              if (n.status === status || n.id === root.id) {
                nodeMap.set(nid, n);
                next.push(nid);
              }
            }
          }
        }
      }
      frontier = next;
    }

    return {
      nodes: [...nodeMap.values()],
      edges: allEdges,
    };
  }

  close(): void {
    this.store.close();
  }

  private materializeNode(
    payload: Record<string, unknown>,
    eventId: string,
    now: number
  ): KnowledgeNode {
    const type = String(payload.type ?? "concept") as KnowledgeNodeType;
    const label = String(payload.label ?? "").trim();
    if (!label) {
      throw new Error("acceptProposal node: label is required");
    }
    // Identity: reuse accepted concept/claim with same type+label
    const existing = this.store.findNodeByTypeLabel(type, label, "accepted");
    if (existing) {
      return existing;
    }
    const node: KnowledgeNode = {
      id: randomUUID(),
      type,
      label,
      description:
        payload.description != null
          ? String(payload.description)
          : undefined,
      status: "accepted",
      workspaceId:
        payload.workspaceId === undefined
          ? null
          : (payload.workspaceId as string | null),
      createdAt: now,
      updatedAt: now,
    };
    // Provenance: attach source event in description meta if missing
    if (!node.description && eventId) {
      node.description = `from event ${eventId}`;
    }
    this.store.insertNode(node);
    return node;
  }

  private resolveEndpoint(
    labelOrId: string,
    preferType: KnowledgeNodeType,
    eventId: string,
    now: number
  ): string {
    const key = labelOrId.trim();
    if (!key) {
      throw new Error("edge endpoint is empty");
    }
    // Prefer id if exists
    const byId = this.store.getNode(key);
    if (byId) return byId.id;

    const accepted = this.store.findNodeByTypeLabel(
      preferType,
      key,
      "accepted"
    );
    if (accepted) return accepted.id;

    // Any type match by label accepted
    for (const t of [
      "concept",
      "claim",
      "project",
      "artifact",
      "source",
      "event",
    ] as KnowledgeNodeType[]) {
      const n = this.store.findNodeByTypeLabel(t, key, "accepted");
      if (n) return n.id;
    }

    // Create concept node on the fly for missing endpoint
    const created = this.materializeNode(
      { type: preferType, label: key },
      eventId,
      now
    );
    return created.id;
  }

  private materializeEdge(
    payload: Record<string, unknown>,
    eventId: string,
    now: number
  ): KnowledgeEdge {
    const fromLabel = String(payload.from ?? payload.fromLabel ?? "").trim();
    const toLabel = String(payload.to ?? payload.toLabel ?? "").trim();
    const relation = String(payload.relation ?? "about").trim() || "about";
    if (!fromLabel || !toLabel) {
      throw new Error("acceptProposal edge: from and to are required");
    }
    const fromNodeId = this.resolveEndpoint(
      fromLabel,
      "concept",
      eventId,
      now
    );
    const toNodeId = this.resolveEndpoint(toLabel, "concept", eventId, now);
    const conf =
      payload.confidence != null ? Number(payload.confidence) : undefined;
    const edge: KnowledgeEdge = {
      id: randomUUID(),
      fromNodeId,
      relation,
      toNodeId,
      confidence: Number.isFinite(conf) ? conf : undefined,
      sourceEventId: eventId,
      status: "accepted",
      createdAt: now,
    };
    this.store.insertEdge(edge);
    return edge;
  }

  private materializeEvidence(
    payload: Record<string, unknown>,
    now: number
  ): void {
    const claimLabel = String(
      payload.claimLabel ?? payload.claim ?? ""
    ).trim();
    const excerpt = String(payload.excerpt ?? "").trim();
    const stance = String(payload.stance ?? "mentions") as
      | "supports"
      | "contradicts"
      | "mentions";
    if (!claimLabel) {
      throw new Error("acceptProposal evidence: claimLabel is required");
    }
    let claim =
      this.store.findNodeByTypeLabel("claim", claimLabel, "accepted") ??
      this.store.findNodeByTypeLabel("claim", claimLabel);
    if (!claim) {
      claim = this.materializeNode(
        { type: "claim", label: claimLabel },
        "manual",
        now
      );
    }
    // Source node from excerpt fingerprint
    const sourceLabel =
      excerpt.slice(0, 80) || `source-${claimLabel}`;
    let source = this.store.findNodeByTypeLabel(
      "source",
      sourceLabel,
      "accepted"
    );
    if (!source) {
      source = this.materializeNode(
        {
          type: "source",
          label: sourceLabel,
          description: excerpt || undefined,
        },
        "manual",
        now
      );
    }
    this.store.insertEvidence({
      id: randomUUID(),
      claimNodeId: claim.id,
      sourceNodeId: source.id,
      excerpt: excerpt || undefined,
      stance,
      confidence:
        payload.confidence != null
          ? Number(payload.confidence)
          : undefined,
      createdAt: now,
    });
  }
}

export function createKnowledgeStore(
  config: KnowledgeStoreConfig
): KnowledgeStore {
  return new SqliteKnowledgeStore(config);
}

/**
 * Resolve DB path:
 * 1. KNOWLEDGE_DB_PATH
 * 2. PERSONAL_CONTEXT_DIR/knowledge.db
 * 3. ./data/knowledge.db
 */
export function resolveKnowledgeDbPath(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.KNOWLEDGE_DB_PATH?.trim()) {
    return resolve(cwd, env.KNOWLEDGE_DB_PATH.trim());
  }
  if (env.PERSONAL_CONTEXT_DIR?.trim()) {
    return resolve(env.PERSONAL_CONTEXT_DIR.trim(), "knowledge.db");
  }
  return resolve(cwd, "./data/knowledge.db");
}

export function hashInput(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

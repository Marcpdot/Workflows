/**
 * High-level KnowledgeStore API (Milestone 11).
 */

import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { labelsMatch, normalizeLabel } from "./identity.js";
import { KnowledgeSqliteStore } from "./store.js";
import type {
  ContradictionPair,
  KnowledgeAlias,
  KnowledgeEdge,
  KnowledgeEvent,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStatus,
  KnowledgeStore,
  KnowledgeStoreConfig,
  MergeNodesResult,
  ProjectLinkRelation,
  ProjectStatus,
} from "./types.js";
import type {
  CanonicalKnowledgeRepository,
  RepositoryHealth,
} from "./storage/contracts.js";

const PROJECT_LINK_RELATIONS: ProjectLinkRelation[] = [
  "used_in",
  "about",
  "part_of",
];

function mergePayload(
  base: Record<string, unknown>,
  edits?: Record<string, unknown>
): Record<string, unknown> {
  if (!edits) return { ...base };
  return { ...base, ...edits };
}

class SqliteKnowledgeStore implements CanonicalKnowledgeRepository {
  readonly backend = "sqlite" as const;
  private readonly store: KnowledgeSqliteStore;
  private readonly defaultWorkspaceId: string | null | undefined;

  constructor(config: KnowledgeStoreConfig) {
    if (!config.dbPath?.trim()) {
      throw new Error("KnowledgeStoreConfig.dbPath is required");
    }
    this.store = new KnowledgeSqliteStore(config.dbPath);
    this.defaultWorkspaceId = config.defaultWorkspaceId;
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

  async healthCheck(): Promise<RepositoryHealth> {
    try {
      this.store.db.prepare("SELECT 1").get();
      return { backend: this.backend, ok: true };
    } catch (error) {
      return {
        backend: this.backend,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getEvent(id: string): Promise<KnowledgeEvent | null> {
    return this.store.getEvent(id);
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

  async getSubgraph(input?: {
    rootId?: string;
    nodeIds?: string[];
    hops?: 1 | 2;
    status?: KnowledgeStatus;
    workspaceId?: string | null;
    limit?: number;
  }): Promise<{
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    truncated: boolean;
  }> {
    const status = input?.status ?? "accepted";
    const requestedLimit =
      input?.limit && Number.isFinite(input.limit) && input.limit > 0
        ? Math.floor(input.limit)
        : 250;
    const limit = Math.min(requestedLimit, 1000);

    let candidates: KnowledgeNode[];
    if (input?.rootId) {
      const root = this.store.getNode(input.rootId);
      if (!root || root.status !== status) {
        return { nodes: [], edges: [], truncated: false };
      }
      const neighborhood = await this.getNeighborhood(root.id, {
        hops: input.hops === 2 ? 2 : 1,
        status,
      });
      candidates = neighborhood.nodes;
    } else if (input?.nodeIds?.length) {
      const uniqueIds = [...new Set(input.nodeIds.map((id) => id.trim()).filter(Boolean))];
      candidates = uniqueIds
        .map((id) => this.store.getNode(id))
        .filter(
          (node): node is KnowledgeNode =>
            node != null &&
            node.status === status &&
            (input.workspaceId === undefined ||
              node.workspaceId === input.workspaceId)
        );
    } else {
      candidates = this.store.findNodes({
        status,
        workspaceId: input?.workspaceId,
        limit: limit + 1,
      });
    }

    if (input?.workspaceId !== undefined) {
      candidates = candidates.filter(
        (node) => node.workspaceId === input.workspaceId
      );
    }

    const truncated = candidates.length > limit;
    const nodes = candidates.slice(0, limit);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = this.store
      .getEdgesFromOrTo([...nodeIds], status)
      .filter(
        (edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)
      );
    return { nodes, edges, truncated };
  }

  async ensureProject(input: {
    label: string;
    description?: string;
    workspaceId?: string | null;
    createAccepted?: boolean;
  }): Promise<KnowledgeNode> {
    const label = input.label?.trim();
    if (!label) {
      throw new Error("ensureProject: label is required");
    }
    const existing = this.store.findNodeByTypeLabel(
      "project",
      label,
      "accepted"
    );
    if (existing) return existing;

    const createAccepted = input.createAccepted !== false;
    if (!createAccepted) {
      throw new Error(
        `ensureProject: no accepted project "${label}" and createAccepted=false`
      );
    }

    const now = Date.now();
    const workspaceId =
      input.workspaceId !== undefined
        ? input.workspaceId
        : this.defaultWorkspaceId !== undefined
          ? this.defaultWorkspaceId
          : null;

    const node: KnowledgeNode = {
      id: randomUUID(),
      type: "project",
      label,
      description: input.description,
      status: "accepted",
      workspaceId,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertNode(node);
    return node;
  }

  async linkToProject(input: {
    nodeId: string;
    projectId: string;
    relation?: ProjectLinkRelation;
    sourceEventId?: string;
  }): Promise<KnowledgeEdge> {
    const node = this.store.getNode(input.nodeId);
    if (!node) {
      throw new Error(`linkToProject: unknown nodeId ${input.nodeId}`);
    }
    const project = this.store.getNode(input.projectId);
    if (!project || project.type !== "project") {
      throw new Error(
        `linkToProject: projectId must be an accepted project node`
      );
    }
    if (project.status !== "accepted") {
      throw new Error(`linkToProject: project is not accepted`);
    }
    const relation = input.relation ?? "used_in";
    const edge: KnowledgeEdge = {
      id: randomUUID(),
      fromNodeId: node.id,
      relation,
      toNodeId: project.id,
      sourceEventId: input.sourceEventId,
      status: "accepted",
      createdAt: Date.now(),
    };
    this.store.insertEdge(edge);
    return edge;
  }

  async unlinkFromProject(input: {
    nodeId: string;
    projectId: string;
  }): Promise<boolean> {
    const n = this.store.deleteEdgeBetween(
      input.nodeId,
      input.projectId,
      PROJECT_LINK_RELATIONS
    );
    return n > 0;
  }

  async getProjectStatus(input: {
    projectId?: string;
    label?: string;
    workspaceId?: string | null;
    hops?: 1 | 2;
  }): Promise<ProjectStatus> {
    let project: KnowledgeNode | null = null;
    if (input.projectId) {
      project = this.store.getNode(input.projectId);
    } else if (input.label?.trim()) {
      project = this.store.findNodeByTypeLabel(
        "project",
        input.label.trim(),
        "accepted"
      );
      if (!project) {
        // try without status filter
        project = this.store.findNodeByTypeLabel(
          "project",
          input.label.trim()
        );
      }
    }
    if (!project || project.type !== "project") {
      throw new Error(
        "getProjectStatus: provide projectId or label of an existing project"
      );
    }
    if (
      input.workspaceId !== undefined &&
      input.workspaceId !== null &&
      project.workspaceId &&
      project.workspaceId !== input.workspaceId
    ) {
      throw new Error(
        `getProjectStatus: project workspace mismatch (want ${input.workspaceId})`
      );
    }

    const hops = input.hops === 2 ? 2 : 1;
    const neigh = await this.getNeighborhood(project.id, {
      hops: hops as 1 | 2,
      status: "accepted",
    });

    // Linked nodes: exclude the project itself for classification lists
    const linkedNodes = neigh.nodes.filter((n) => n.id !== project!.id);
    const edges = neigh.edges;
    const claims = linkedNodes.filter((n) => n.type === "claim");
    const concepts = linkedNodes.filter((n) => n.type === "concept");
    const artifacts = linkedNodes.filter((n) => n.type === "artifact");

    // Cheap pending count: payload mentions project label or id
    const pending = this.store.listProposals({ status: "pending" });
    const needle = project.label.toLowerCase();
    const pendingProposalCount = pending.filter((p) => {
      const raw = JSON.stringify(p.payload).toLowerCase();
      return raw.includes(needle) || raw.includes(project!.id.toLowerCase());
    }).length;

    const summaryLines = [
      `project: ${project.label} (${project.status})`,
      `workspace: ${project.workspaceId ?? "none"}`,
      `claims: ${claims.length} | concepts: ${concepts.length} | artifacts: ${artifacts.length}`,
    ];
    for (const c of claims.slice(0, 8)) {
      summaryLines.push(`- claim: ${c.label}`);
    }
    for (const e of edges.slice(0, 8)) {
      const from =
        neigh.nodes.find((n) => n.id === e.fromNodeId)?.label ??
        e.fromNodeId.slice(0, 8);
      const to =
        neigh.nodes.find((n) => n.id === e.toNodeId)?.label ??
        e.toNodeId.slice(0, 8);
      summaryLines.push(`- ${from} -[${e.relation}]-> ${to}`);
    }
    summaryLines.push(`pending proposals: ${pendingProposalCount}`);

    return {
      project,
      workspaceId: project.workspaceId,
      linkedNodes,
      edges,
      claims,
      concepts,
      artifacts,
      pendingProposalCount,
      summaryLines,
    };
  }

  async addAlias(input: {
    aliasLabel: string;
    canonicalNodeId: string;
  }): Promise<KnowledgeAlias> {
    const aliasLabel = normalizeLabel(input.aliasLabel);
    if (!aliasLabel) {
      throw new Error("addAlias: aliasLabel is required");
    }
    const canonical = this.store.getNode(input.canonicalNodeId);
    if (!canonical) {
      throw new Error(`addAlias: unknown node ${input.canonicalNodeId}`);
    }
    if (canonical.status === "rejected") {
      throw new Error("addAlias: canonical node is rejected");
    }
    const existing = this.store.getAlias(aliasLabel);
    if (existing) {
      if (existing.canonicalNodeId === canonical.id) {
        return {
          id: existing.id,
          aliasLabel: existing.aliasLabel,
          canonicalNodeId: existing.canonicalNodeId,
          createdAt: existing.createdAt,
        };
      }
      throw new Error(
        `addAlias: alias "${aliasLabel}" already points to ${existing.canonicalNodeId}`
      );
    }
    // If alias equals another accepted node's label of same type, prefer merge
    const row: KnowledgeAlias = {
      id: randomUUID(),
      aliasLabel,
      canonicalNodeId: canonical.id,
      createdAt: Date.now(),
    };
    this.store.insertAlias(row);
    return row;
  }

  async resolveCanonical(input: {
    label: string;
    type?: KnowledgeNodeType;
  }): Promise<KnowledgeNode | null> {
    const raw = input.label?.trim();
    if (!raw) return null;
    // Direct id
    const byId = this.store.getNode(raw);
    if (byId && byId.status !== "rejected") return byId;

    const norm = normalizeLabel(raw);
    const alias = this.store.getAlias(norm);
    if (alias) {
      const n = this.store.getNode(alias.canonicalNodeId);
      if (n && n.status !== "rejected") return n;
    }

    if (input.type) {
      const hit = this.store.findNodeByTypeLabel(input.type, raw, "accepted");
      if (hit) return hit;
      // normalized scan among accepted of type
      const candidates = this.store.findNodes({
        type: input.type,
        status: "accepted",
        limit: 100,
      });
      const match = candidates.find((n) => labelsMatch(n.label, raw));
      if (match) return match;
      return null;
    }

    for (const t of [
      "concept",
      "claim",
      "project",
      "artifact",
      "source",
      "event",
    ] as KnowledgeNodeType[]) {
      const hit = this.store.findNodeByTypeLabel(t, raw, "accepted");
      if (hit) return hit;
    }
    const any = this.store.findNodes({ status: "accepted", limit: 200 });
    return any.find((n) => labelsMatch(n.label, raw)) ?? null;
  }

  async mergeNodes(input: {
    fromId: string;
    intoId: string;
  }): Promise<MergeNodesResult> {
    if (input.fromId === input.intoId) {
      throw new Error("mergeNodes: fromId and intoId must differ");
    }
    const from = this.store.getNode(input.fromId);
    const into = this.store.getNode(input.intoId);
    if (!from) throw new Error(`mergeNodes: unknown fromId ${input.fromId}`);
    if (!into) throw new Error(`mergeNodes: unknown intoId ${input.intoId}`);
    if (into.status === "rejected") {
      throw new Error("mergeNodes: into node is rejected");
    }

    const edgesRewired = this.store.rewireEdges(from.id, into.id);
    this.store.deleteSelfLoopEdges();
    const evidenceRewired = this.store.rewireEvidence(from.id, into.id);
    const aliasesRetargeted = this.store.retargetAliases(from.id, into.id);

    // Alias for the merged-away label → into
    let aliasCreated = false;
    const norm = normalizeLabel(from.label);
    if (norm) {
      const existingAlias = this.store.getAlias(norm);
      if (!existingAlias) {
        this.store.insertAlias({
          id: randomUUID(),
          aliasLabel: norm,
          canonicalNodeId: into.id,
          createdAt: Date.now(),
        });
        aliasCreated = true;
      }
    }

    const now = Date.now();
    const note = `merged into ${into.id} (${into.label}) at ${now}`;
    const desc = from.description ? `${from.description}; ${note}` : note;
    this.store.updateNodeStatus(from.id, "rejected", now, desc);

    // Provenance edge kept on into graph: into -[same_as]-> from (historical)
    // Prefer from -[same_as]-> into but from is rejected; store edge into → from label via relation for audit
    this.store.insertEdge({
      id: randomUUID(),
      fromNodeId: into.id,
      relation: "same_as",
      toNodeId: from.id,
      status: "accepted",
      createdAt: now,
      sourceEventId: undefined,
    });

    const updatedInto = this.store.getNode(into.id)!;
    const updatedFrom = this.store.getNode(from.id)!;
    return {
      from: updatedFrom,
      into: updatedInto,
      edgesRewired,
      evidenceRewired,
      aliasesRetargeted,
      aliasCreated,
    };
  }

  async findContradictions(input?: {
    nodeId?: string;
    limit?: number;
  }): Promise<ContradictionPair[]> {
    const edges = this.store.findEdgesByRelation("contradicts", {
      nodeId: input?.nodeId,
      status: "accepted",
      limit: input?.limit ?? 50,
    });
    const out: ContradictionPair[] = [];
    for (const edge of edges) {
      const from = this.store.getNode(edge.fromNodeId);
      const to = this.store.getNode(edge.toNodeId);
      if (!from || !to) continue;
      out.push({
        edge,
        from,
        to,
        summary: `${from.label} -[contradicts]-> ${to.label}`,
      });
    }
    return out;
  }

  async markContradiction(input: {
    fromId: string;
    toId: string;
    confidence?: number;
    sourceEventId?: string;
  }): Promise<KnowledgeEdge> {
    if (input.fromId === input.toId) {
      throw new Error("markContradiction: from and to must differ");
    }
    const from = this.store.getNode(input.fromId);
    const to = this.store.getNode(input.toId);
    if (!from || !to) {
      throw new Error("markContradiction: both nodes must exist");
    }
    // Avoid exact duplicate open contradicts
    const existing = this.store.findEdgesByRelation("contradicts", {
      nodeId: input.fromId,
      status: "accepted",
      limit: 50,
    });
    const dup = existing.find(
      (e) =>
        (e.fromNodeId === input.fromId && e.toNodeId === input.toId) ||
        (e.fromNodeId === input.toId && e.toNodeId === input.fromId)
    );
    if (dup) return dup;

    const edge: KnowledgeEdge = {
      id: randomUUID(),
      fromNodeId: input.fromId,
      relation: "contradicts",
      toNodeId: input.toId,
      confidence: input.confidence,
      sourceEventId: input.sourceEventId,
      status: "accepted",
      createdAt: Date.now(),
    };
    this.store.insertEdge(edge);
    return edge;
  }

  async supersedeClaim(input: {
    oldClaimId: string;
    newClaimId: string;
    markOldDisputed?: boolean;
  }): Promise<KnowledgeEdge> {
    if (input.oldClaimId === input.newClaimId) {
      throw new Error("supersedeClaim: old and new must differ");
    }
    const oldN = this.store.getNode(input.oldClaimId);
    const newN = this.store.getNode(input.newClaimId);
    if (!oldN || oldN.type !== "claim") {
      throw new Error("supersedeClaim: oldClaimId must be a claim node");
    }
    if (!newN || newN.type !== "claim") {
      throw new Error("supersedeClaim: newClaimId must be a claim node");
    }
    const now = Date.now();
    const edge: KnowledgeEdge = {
      id: randomUUID(),
      fromNodeId: newN.id,
      relation: "supersedes",
      toNodeId: oldN.id,
      status: "accepted",
      createdAt: now,
    };
    this.store.insertEdge(edge);
    if (input.markOldDisputed !== false) {
      const note = `superseded by ${newN.id} (${newN.label})`;
      const desc = oldN.description ? `${oldN.description}; ${note}` : note;
      this.store.updateNodeStatus(oldN.id, "disputed", now, desc);
    }
    return edge;
  }

  async listAliases(canonicalNodeId?: string): Promise<KnowledgeAlias[]> {
    return this.store.listAliases(canonicalNodeId);
  }

  close(): void {
    this.store.close();
  }

  private resolveWorkspaceId(
    payload: Record<string, unknown>
  ): string | null {
    if (payload.workspaceId !== undefined) {
      return payload.workspaceId as string | null;
    }
    if (this.defaultWorkspaceId !== undefined) {
      return this.defaultWorkspaceId;
    }
    return null;
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
    // M15: alias → canonical
    const alias = this.store.getAlias(normalizeLabel(label));
    if (alias) {
      const canon = this.store.getNode(alias.canonicalNodeId);
      if (canon && canon.status !== "rejected") return canon;
    }
    // Identity: reuse accepted same type+label (case-insensitive)
    const existing = this.store.findNodeByTypeLabel(type, label, "accepted");
    if (existing) {
      return existing;
    }
    // Normalized match among accepted of same type (whitespace/diacritics)
    const candidates = this.store.findNodes({
      type,
      status: "accepted",
      limit: 100,
    });
    const fuzzy = candidates.find((n) => labelsMatch(n.label, label));
    if (fuzzy) {
      return fuzzy;
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
      workspaceId: this.resolveWorkspaceId(payload),
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

    const alias = this.store.getAlias(normalizeLabel(key));
    if (alias) {
      const n = this.store.getNode(alias.canonicalNodeId);
      if (n && n.status !== "rejected") return n.id;
    }

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

    // Normalized label match
    const any = this.store.findNodes({ status: "accepted", limit: 200 });
    const fuzzy = any.find((n) => labelsMatch(n.label, key));
    if (fuzzy) return fuzzy.id;

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

export function createSqliteKnowledgeRepository(
  config: KnowledgeStoreConfig
): CanonicalKnowledgeRepository {
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

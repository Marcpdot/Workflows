/**
 * Milestone 17 — stable read surface over M11–M16 store APIs.
 * No new truth model; pure query helpers + DTO shapes for CLI/HTTP/UI.
 */

import type {
  ContradictionPair,
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeNodeType,
  KnowledgeProposal,
  KnowledgeStatus,
  KnowledgeStore,
  ProjectStatus,
} from "./types.js";

/** Stable node DTO for JSON (full ids). */
export interface KnowledgeNodeDto {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  description?: string;
  status: KnowledgeStatus;
  workspaceId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeEdgeDto {
  id: string;
  fromNodeId: string;
  relation: string;
  toNodeId: string;
  confidence?: number;
  sourceEventId?: string;
  status: KnowledgeStatus;
  createdAt: number;
}

export interface NeighborhoodRead {
  rootId: string;
  hops: 1 | 2;
  nodes: KnowledgeNodeDto[];
  edges: KnowledgeEdgeDto[];
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
  complete: boolean;
  truncation: { nodes: boolean; edges: boolean };
  limits: { nodes: number; edges: number };
}

export interface SearchRead {
  query: {
    label?: string;
    type?: KnowledgeNodeType;
    status?: KnowledgeStatus;
    workspaceId?: string | null;
    limit: number;
  };
  nodes: KnowledgeNodeDto[];
  count: number;
}

export interface SubgraphRead {
  query: {
    rootId?: string;
    nodeIds?: string[];
    hops: 1 | 2;
    status: KnowledgeStatus;
    workspaceId?: string | null;
    limit: number;
  };
  nodes: KnowledgeNodeDto[];
  edges: KnowledgeEdgeDto[];
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
}

export interface ContradictionsRead {
  nodeId?: string;
  pairs: Array<{
    edge: KnowledgeEdgeDto;
    from: KnowledgeNodeDto;
    to: KnowledgeNodeDto;
    summary: string;
  }>;
  count: number;
}

export interface ProposalsRead {
  status: KnowledgeProposal["status"];
  proposals: Array<{
    id: string;
    eventId: string;
    kind: KnowledgeProposal["kind"];
    payload: Record<string, unknown>;
    status: KnowledgeProposal["status"];
    createdAt: number;
    resolvedAt?: number;
  }>;
  count: number;
}

export function toNodeDto(n: KnowledgeNode): KnowledgeNodeDto {
  return {
    id: n.id,
    type: n.type,
    label: n.label,
    description: n.description,
    status: n.status,
    workspaceId: n.workspaceId,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export function toEdgeDto(e: KnowledgeEdge): KnowledgeEdgeDto {
  return {
    id: e.id,
    fromNodeId: e.fromNodeId,
    relation: e.relation,
    toNodeId: e.toNodeId,
    confidence: e.confidence,
    sourceEventId: e.sourceEventId,
    status: e.status,
    createdAt: e.createdAt,
  };
}

/**
 * Thin read facade — same methods as store, stable return envelopes for clients.
 */
export function createKnowledgeReader(store: KnowledgeStore) {
  return {
    async getNode(id: string): Promise<KnowledgeNodeDto | null> {
      const n = await store.getNode(id);
      return n ? toNodeDto(n) : null;
    },

    async search(query: {
      label?: string;
      type?: KnowledgeNodeType;
      status?: KnowledgeStatus;
      workspaceId?: string | null;
      limit?: number;
    }): Promise<SearchRead> {
      const limit =
        query.limit && Number.isFinite(query.limit) && query.limit > 0
          ? Math.floor(query.limit)
          : 20;
      const nodes = await store.findNodes({
        label: query.label,
        type: query.type,
        status: query.status ?? "accepted",
        workspaceId: query.workspaceId,
        limit,
      });
      return {
        query: {
          label: query.label,
          type: query.type,
          status: query.status ?? "accepted",
          workspaceId: query.workspaceId,
          limit,
        },
        nodes: nodes.map(toNodeDto),
        count: nodes.length,
      };
    },

    async getNeighborhood(
      nodeId: string,
      options?: { hops?: 1 | 2; status?: KnowledgeStatus; nodeLimit?: number; edgeLimit?: number }
    ): Promise<NeighborhoodRead> {
      const hops = options?.hops === 2 ? 2 : 1;
      const neigh = await store.getNeighborhood(nodeId, {
        hops: hops as 1 | 2,
        status: options?.status ?? "accepted",
        nodeLimit: options?.nodeLimit,
        edgeLimit: options?.edgeLimit,
      });
      return {
        rootId: nodeId,
        hops: hops as 1 | 2,
        nodes: neigh.nodes.map(toNodeDto),
        edges: neigh.edges.map(toEdgeDto),
        nodeCount: neigh.nodes.length,
        edgeCount: neigh.edges.length,
        truncated: neigh.truncated,
        complete: neigh.complete,
        truncation: neigh.truncation,
        limits: neigh.limits,
      };
    },

    async getSubgraph(input?: {
      rootId?: string;
      nodeIds?: string[];
      hops?: 1 | 2;
      status?: KnowledgeStatus;
      workspaceId?: string | null;
      limit?: number;
    }): Promise<SubgraphRead> {
      const hops = input?.hops === 2 ? 2 : 1;
      const status = input?.status ?? "accepted";
      const requestedLimit =
        input?.limit && Number.isFinite(input.limit) && input.limit > 0
          ? Math.floor(input.limit)
          : 250;
      const limit = Math.min(requestedLimit, 1000);
      const graph = await store.getSubgraph({
        rootId: input?.rootId,
        nodeIds: input?.nodeIds,
        hops,
        status,
        workspaceId: input?.workspaceId,
        limit,
      });
      return {
        query: {
          rootId: input?.rootId,
          nodeIds: input?.nodeIds,
          hops,
          status,
          workspaceId: input?.workspaceId,
          limit,
        },
        nodes: graph.nodes.map(toNodeDto),
        edges: graph.edges.map(toEdgeDto),
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        truncated: graph.truncated,
      };
    },

    async getProjectStatus(input: {
      projectId?: string;
      label?: string;
      workspaceId?: string | null;
      hops?: 1 | 2;
    }): Promise<ProjectStatus> {
      return store.getProjectStatus(input);
    },

    async findContradictions(input?: {
      nodeId?: string;
      limit?: number;
    }): Promise<ContradictionsRead> {
      const pairs = await store.findContradictions(input);
      return {
        nodeId: input?.nodeId,
        pairs: pairs.map((p: ContradictionPair) => ({
          edge: toEdgeDto(p.edge),
          from: toNodeDto(p.from),
          to: toNodeDto(p.to),
          summary: p.summary,
        })),
        count: pairs.length,
      };
    },

    async listProposals(filter?: {
      status?: KnowledgeProposal["status"];
      eventId?: string;
    }): Promise<ProposalsRead> {
      const status = filter?.status ?? "pending";
      const list = await store.listProposals({
        status,
        eventId: filter?.eventId,
      });
      return {
        status,
        proposals: list.map((p) => ({
          id: p.id,
          eventId: p.eventId,
          kind: p.kind,
          payload: p.payload,
          status: p.status,
          createdAt: p.createdAt,
          resolvedAt: p.resolvedAt,
        })),
        count: list.length,
      };
    },
  };
}

export type KnowledgeReader = ReturnType<typeof createKnowledgeReader>;

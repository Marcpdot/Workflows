/**
 * Milestone 11 — semantic knowledge model types.
 */

export type KnowledgeNodeType =
  | "concept"
  | "claim"
  | "event"
  | "source"
  | "project"
  | "artifact";

export type KnowledgeStatus =
  | "proposed"
  | "accepted"
  | "disputed"
  | "rejected";

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  description?: string;
  status: KnowledgeStatus;
  workspaceId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Core relation vocabulary for M11 — string allowed for forward-compat */
export type KnowledgeRelation =
  | "requires"
  | "limits"
  | "causes"
  | "increases"
  | "reduces"
  | "measures"
  | "controls"
  | "supports"
  | "contradicts"
  | "used_in"
  | "part_of"
  | "about";

export interface KnowledgeEdge {
  id: string;
  fromNodeId: string;
  relation: KnowledgeRelation | string;
  toNodeId: string;
  confidence?: number;
  sourceEventId?: string;
  status: KnowledgeStatus;
  createdAt: number;
}

export interface KnowledgeEvidence {
  id: string;
  claimNodeId: string;
  sourceNodeId: string;
  excerpt?: string;
  stance: "supports" | "contradicts" | "mentions";
  confidence?: number;
  createdAt: number;
}

export interface KnowledgeEvent {
  id: string;
  sourceType: "conversation" | "file" | "project" | "manual";
  sourceRef: string;
  model?: string;
  inputHash?: string;
  createdAt: number;
}

export interface KnowledgeProposal {
  id: string;
  eventId: string;
  kind: "node" | "edge" | "evidence";
  payload: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  resolvedAt?: number;
}

export interface KnowledgeStoreConfig {
  dbPath: string;
}

export interface KnowledgeStore {
  createEvent(input: {
    sourceType: KnowledgeEvent["sourceType"];
    sourceRef: string;
    model?: string;
    inputHash?: string;
  }): Promise<KnowledgeEvent>;

  addProposals(
    eventId: string,
    items: Array<{
      kind: KnowledgeProposal["kind"];
      payload: Record<string, unknown>;
    }>
  ): Promise<KnowledgeProposal[]>;

  listProposals(filter?: {
    status?: KnowledgeProposal["status"];
    eventId?: string;
  }): Promise<KnowledgeProposal[]>;

  acceptProposal(
    id: string,
    edits?: Record<string, unknown>
  ): Promise<void>;

  rejectProposal(id: string): Promise<void>;

  getNode(id: string): Promise<KnowledgeNode | null>;

  findNodes(query: {
    type?: KnowledgeNodeType;
    label?: string;
    workspaceId?: string | null;
    status?: KnowledgeStatus;
    limit?: number;
  }): Promise<KnowledgeNode[]>;

  getNeighborhood(
    nodeId: string,
    options?: { hops?: 1 | 2; status?: KnowledgeStatus }
  ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>;

  close(): void;
}

/** Structured extraction output (from model or fixture). */
export interface ExtractionResult {
  concepts: Array<{ label: string; description?: string }>;
  claims: Array<{
    label: string;
    description?: string;
    confidence?: number;
  }>;
  relations: Array<{
    from: string;
    relation: string;
    to: string;
    confidence?: number;
  }>;
  evidence?: Array<{
    claimLabel: string;
    excerpt: string;
    stance: "supports" | "contradicts" | "mentions";
  }>;
}

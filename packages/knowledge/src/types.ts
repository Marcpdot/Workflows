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

/** Core relation vocabulary for M11+ — string allowed for forward-compat */
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
  | "about"
  | "same_as"
  | "alias_of"
  | "supersedes";

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
  /** Applied to new nodes on accept when payload omits workspaceId (M13) */
  defaultWorkspaceId?: string | null;
}

/** Project status summary for tools/CLI (M13) */
export interface ProjectStatus {
  project: KnowledgeNode;
  workspaceId?: string | null;
  linkedNodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  claims: KnowledgeNode[];
  concepts: KnowledgeNode[];
  artifacts: KnowledgeNode[];
  pendingProposalCount: number;
  summaryLines: string[];
}

export type ProjectLinkRelation = "used_in" | "about" | "part_of";

/** M15 alias row */
export interface KnowledgeAlias {
  id: string;
  aliasLabel: string;
  canonicalNodeId: string;
  createdAt: number;
}

/** M15 merge result */
export interface MergeNodesResult {
  from: KnowledgeNode;
  into: KnowledgeNode;
  edgesRewired: number;
  evidenceRewired: number;
  aliasesRetargeted: number;
  aliasCreated: boolean;
}

/** M15 contradiction pair (accepted contradicts edges) */
export interface ContradictionPair {
  edge: KnowledgeEdge;
  from: KnowledgeNode;
  to: KnowledgeNode;
  summary: string;
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

  /** M13: find or create accepted project node */
  ensureProject(input: {
    label: string;
    description?: string;
    workspaceId?: string | null;
    /** default true for CLI/tools; false only returns existing or throws if missing */
    createAccepted?: boolean;
  }): Promise<KnowledgeNode>;

  /** M13: edge node → project (used_in | about | part_of) */
  linkToProject(input: {
    nodeId: string;
    projectId: string;
    relation?: ProjectLinkRelation;
    sourceEventId?: string;
  }): Promise<KnowledgeEdge>;

  unlinkFromProject(input: {
    nodeId: string;
    projectId: string;
  }): Promise<boolean>;

  getProjectStatus(input: {
    projectId?: string;
    label?: string;
    workspaceId?: string | null;
    hops?: 1 | 2;
  }): Promise<ProjectStatus>;

  /** M15: map alias label → existing accepted canonical node */
  addAlias(input: {
    aliasLabel: string;
    canonicalNodeId: string;
  }): Promise<KnowledgeAlias>;

  /** M15: resolve label via alias table or accepted exact/normalized node */
  resolveCanonical(input: {
    label: string;
    type?: KnowledgeNodeType;
  }): Promise<KnowledgeNode | null>;

  /** M15: rewire edges/evidence from → into; mark from rejected; keep history */
  mergeNodes(input: {
    fromId: string;
    intoId: string;
  }): Promise<MergeNodesResult>;

  /** M15: list accepted contradicts edges */
  findContradictions(input?: {
    nodeId?: string;
    limit?: number;
  }): Promise<ContradictionPair[]>;

  /** M15: record contradicts edge (explicit; no auto-arbitration) */
  markContradiction(input: {
    fromId: string;
    toId: string;
    confidence?: number;
    sourceEventId?: string;
  }): Promise<KnowledgeEdge>;

  /** M15: new claim supersedes old (edge supersedes; old kept, optionally disputed) */
  supersedeClaim(input: {
    oldClaimId: string;
    newClaimId: string;
    markOldDisputed?: boolean;
  }): Promise<KnowledgeEdge>;

  listAliases(canonicalNodeId?: string): Promise<KnowledgeAlias[]>;

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

/**
 * Milestone 11 — semantic knowledge model types.
 */

export type KnowledgeNodeType =
  | "concept"
  | "claim"
  | "event"
  | "source"
  | "project"
  | "artifact"
  | "chunk"
  | (string & {});

export type KnowledgeStatus =
  | "proposed"
  | "accepted"
  | "disputed"
  | "rejected";

/** Independent of proposal/lifecycle status: how strongly the content is known. */
export type KnowledgeEpistemicStatus =
  | "observed"
  | "supported"
  | "inferred"
  | "hypothesized"
  | "assumed"
  | "established"
  | "unknown";

export interface KnowledgeInformationLoss {
  occurred: boolean;
  description?: string;
}

export interface KnowledgeTransformation {
  method: string;
  model?: string;
  assumptions?: string[];
  confidence?: number;
  uncertainty?: string;
  representationScope?: string;
  informationLoss?: KnowledgeInformationLoss;
  validFrom?: number;
  validTo?: number;
}

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  description?: string;
  status: KnowledgeStatus;
  epistemicStatus: KnowledgeEpistemicStatus;
  confidence?: number;
  validFrom?: number;
  validTo?: number;
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
  targetNodeId: string;
  sourceNodeId: string;
  sourceEventId?: string;
  excerpt?: string;
  stance: "supports" | "contradicts" | "test_evidence";
  confidence?: number;
  createdAt: number;
}

export type KnowledgeObservationKind = "mentions" | "observes" | "independently_formulated" | "references" | "derived_from";

export interface KnowledgeObservation {
  id: string;
  targetNodeId: string;
  sourceEventId?: string;
  sourceNodeId?: string;
  kind: KnowledgeObservationKind;
  observedAt: number;
  metadata: Record<string, unknown>;
}

export interface KnowledgeEvent {
  id: string;
  sourceType: "conversation" | "file" | "project" | "manual";
  sourceRef: string;
  /**
   * Fallback source snapshot for events without durable experience backing.
   * When sourceExperienceIds is non-empty, those experiences are authoritative
   * and this field is absent.
   */
  sourceContent?: string;
  sourceExperienceIds: string[];
  model?: string;
  inputHash?: string;
  transformation?: KnowledgeTransformation;
  invalidatedAt?: number;
  invalidationReason?: string;
  createdAt: number;
}

export interface KnowledgeDerivation extends KnowledgeTransformation {
  id: string;
  targetNodeId: string;
  sourceEventId?: string;
  sourceNodeId?: string;
  createdAt: number;
  depth: number;
}

export interface ClaimLineage {
  claim: KnowledgeNode;
  derivations: KnowledgeDerivation[];
  sourceNodes: KnowledgeNode[];
  sourceEvents: KnowledgeEvent[];
  evidence: KnowledgeEvidence[];
  maxDepth: number;
  truncated: boolean;
}

export interface DependentClaim {
  claim: KnowledgeNode;
  depth: number;
  derivationIds: string[];
}

export interface KnowledgeProposal {
  id: string;
  eventId: string;
  kind:
    | "node"
    | "edge"
    | "evidence"
    | "observation"
    | "merge"
    | "supersede"
    | "representation_gap";
  payload: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  resolvedAt?: number;
}

/** Operator-gated ingest unit. Material is not canonical until the job is accepted. */
export type TransformJobStatus =
  | "awaiting_accept"
  | "accepted"
  | "rejected"
  | "failed";

export interface TransformJob {
  id: string;
  status: TransformJobStatus;
  sourceKind: string;
  sourcePath?: string;
  sourceRef: string;
  workspaceId?: string | null;
  error?: string;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

/** Preserved source bytes/text for one transform job. Does not rewrite meaning. */
export interface KnowledgeAsIs {
  id: string;
  jobId: string;
  path: string;
  contentHash: string;
  mediaType: string;
  text?: string;
  byteLength: number;
  workspaceId?: string | null;
  createdAt: number;
}

/** Stable slice of as-is material. Index records point here rather than restating meaning. */
export interface KnowledgeChunk {
  id: string;
  jobId: string;
  asIsId: string;
  path: string;
  contentHash: string;
  ordinal: number;
  charStart: number;
  charEnd: number;
  byteStart?: number;
  byteEnd?: number;
  text: string;
  workspaceId?: string | null;
  createdAt: number;
}

export interface PutTransformJobInput {
  id?: string;
  status?: Extract<TransformJobStatus, "awaiting_accept" | "failed">;
  sourceKind: string;
  sourcePath?: string;
  sourceRef?: string;
  workspaceId?: string | null;
  error?: string;
}

export interface PutAsIsInput {
  id?: string;
  jobId: string;
  path: string;
  contentHash: string;
  mediaType: string;
  text?: string;
  bytes?: Uint8Array;
  byteLength?: number;
  workspaceId?: string | null;
}

export interface PutChunkInput {
  id?: string;
  jobId: string;
  asIsId: string;
  path: string;
  contentHash: string;
  ordinal: number;
  charStart: number;
  charEnd: number;
  byteStart?: number;
  byteEnd?: number;
  text: string;
  workspaceId?: string | null;
}

export interface ListTransformJobsFilter {
  status?: TransformJobStatus;
  workspaceId?: string | null;
  limit?: number;
  newestFirst?: boolean;
}

export interface ListChunksFilter {
  jobId?: string;
  chunkId?: string;
  asIsId?: string;
  pathPrefix?: string;
  workspaceId?: string | null;
  /** When true (default), only chunks from accepted jobs are returned. */
  canonicalOnly?: boolean;
  limit?: number;
}

/** Optional real-world geometry attached on accept. Never required for text/PDF ingest. */
export interface KnowledgeGeometry {
  type: string;
  coordinates: unknown;
  [key: string]: unknown;
}

export interface AcceptTransformJobOptions {
  geometry?: KnowledgeGeometry;
  geometryProperties?: Record<string, unknown>;
}

/** Fixed knowledge-local work kinds; deliberately not a generic job model. */
export type KnowledgeBackgroundWorkKind =
  | "semantic_consolidation"
  | "representation_gap_retry"
  | "claim_reconsideration";

export type KnowledgeBackgroundWorkStatus =
  | "pending"
  | "waiting"
  | "completed"
  | "escalated";

export interface KnowledgeBackgroundWork {
  id: string;
  kind: KnowledgeBackgroundWorkKind;
  workKey: string;
  sourceExperienceId?: string;
  sourceEventId?: string;
  targetProposalId?: string;
  targetNodeId?: string;
  payload: Record<string, unknown>;
  status: KnowledgeBackgroundWorkStatus;
  attemptCount: number;
  availableAt: number;
  completedAt?: number;
  escalatedAt?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Non-authoritative, privacy-safe facts about committed knowledge changes.
 * The sink is optional and failures must never affect canonical transactions.
 */
export interface KnowledgeDiagnosticRecord {
  action:
    | "event_created"
    | "proposals_created"
    | "proposal_accepted"
    | "proposal_rejected"
    | "event_invalidated";
  eventId?: string;
  proposalIds?: string[];
  proposalKind?: KnowledgeProposal["kind"];
  canonicalIds?: string[];
  sourceExperienceIds?: string[];
  epistemicStatus?: KnowledgeEpistemicStatus;
  transformationMethod?: string;
  gapId?: string;
  resolutionMethod?: string;
  oldClaimId?: string;
  revisedClaimId?: string;
  contradictionId?: string;
}

export type KnowledgeDiagnosticSink = (
  record: KnowledgeDiagnosticRecord
) => void;

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
  topologyComplete?: boolean;
  topologyTruncated?: boolean;
  topologyTruncation?: { nodes: boolean; edges: boolean };
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
  observationsRewired: number;
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
    /** Non-authoritative fallback used only when sourceExperienceIds is empty. */
    sourceContent?: string;
    sourceExperienceIds?: string[];
    model?: string;
    inputHash?: string;
    transformation?: KnowledgeTransformation;
  }): Promise<KnowledgeEvent>;

  getEvent(id: string): Promise<KnowledgeEvent | null>;

  invalidateEvent(id: string, reason: string): Promise<KnowledgeEvent>;

  /** Persist one fixed, idempotent unit for a finite knowledge background pass. */
  enqueueBackgroundWork(input: {
    kind: KnowledgeBackgroundWorkKind;
    workKey: string;
    sourceExperienceId?: string;
    sourceEventId?: string;
    targetProposalId?: string;
    targetNodeId?: string;
    payload?: Record<string, unknown>;
    status?: Extract<KnowledgeBackgroundWorkStatus, "pending" | "waiting">;
  }): Promise<{ work: KnowledgeBackgroundWork; created: boolean }>;

  /** Bounded audit/read surface for background progress and escalation. */
  listBackgroundWork(filter?: {
    kind?: KnowledgeBackgroundWorkKind;
    status?: KnowledgeBackgroundWorkStatus;
    limit?: number;
    newestFirst?: boolean;
  }): Promise<KnowledgeBackgroundWork[]>;

  getBackgroundWork(id: string): Promise<KnowledgeBackgroundWork | null>;

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
    kind?: KnowledgeProposal["kind"];
    limit?: number;
    newestFirst?: boolean;
  }): Promise<KnowledgeProposal[]>;

  getProposal(id: string): Promise<KnowledgeProposal | null>;

  acceptProposal(
    id: string,
    edits?: Record<string, unknown>
  ): Promise<void>;

  rejectProposal(id: string): Promise<void>;

  listEvidence(targetNodeId: string, limit?: number): Promise<KnowledgeEvidence[]>;

  listObservations(targetNodeId: string, limit?: number): Promise<KnowledgeObservation[]>;

  getClaimLineage(
    claimId: string,
    options?: { maxDepth?: number }
  ): Promise<ClaimLineage>;

  findDependentClaims(input: {
    sourceNodeId?: string;
    sourceEventId?: string;
    maxDepth?: number;
  }): Promise<DependentClaim[]>;

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
    options?: { hops?: 1 | 2; status?: KnowledgeStatus; nodeLimit?: number; edgeLimit?: number }
  ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; truncated: boolean; complete: boolean; truncation: { nodes: boolean; edges: boolean }; limits: { nodes: number; edges: number } }>;

  /** Bulk/induced subgraph for network clients. Defaults to accepted nodes, capped. */
  getSubgraph(input?: {
    rootId?: string;
    nodeIds?: string[];
    hops?: 1 | 2;
    status?: KnowledgeStatus;
    workspaceId?: string | null;
    limit?: number;
    edgeLimit?: number;
  }): Promise<{
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    truncated: boolean;
    complete: boolean;
    truncation: { nodes: boolean; edges: boolean };
  }>;

  /** M13: find or create accepted project node */
  ensureProject(input: {
    /** Explicit identity to reuse; label alone never proves sameness. */
    canonicalId?: string;
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
    sourceEventId?: string;
  }): Promise<KnowledgeEdge>;

  listAliases(canonicalNodeId?: string): Promise<KnowledgeAlias[]>;
  /** Bounded alias hydration for an already bounded canonical candidate set. */
  listAliasesForCanonicalIds(canonicalNodeIds: readonly string[]): Promise<KnowledgeAlias[]>;

  /** Create or update an ingest job that is still awaiting accept (or record a failed ingest). */
  putTransformJob(input: PutTransformJobInput): Promise<TransformJob>;
  getTransformJob(id: string): Promise<TransformJob | null>;
  listTransformJobs(filter?: ListTransformJobsFilter): Promise<TransformJob[]>;
  /** Preserve source bytes/text for a job. Does not rewrite meaning. */
  putAsIs(input: PutAsIsInput): Promise<KnowledgeAsIs>;
  getAsIs(id: string): Promise<KnowledgeAsIs | null>;
  getAsIsForJob(jobId: string): Promise<KnowledgeAsIs | null>;
  /** Replace the stable chunks for one job. */
  putChunks(inputs: readonly PutChunkInput[]): Promise<KnowledgeChunk[]>;
  getChunk(id: string): Promise<KnowledgeChunk | null>;
  /**
   * Retrieve chunks. `canonicalOnly` defaults to true so unaccepted jobs stay
   * out of the canonical read path.
   */
  listChunks(filter?: ListChunksFilter): Promise<KnowledgeChunk[]>;
  /** Operator gate: accepted material is visible to canonical retrieve and queued for projection. */
  acceptTransformJob(id: string, options?: AcceptTransformJobOptions): Promise<TransformJob>;
  rejectTransformJob(id: string): Promise<TransformJob>;

  close(): void | Promise<void>;
}

/** Structured extraction output (from model or fixture). */
export interface ExtractionResult {
  concepts: Array<{ label: string; description?: string }>;
  claims: Array<{
    label: string;
    description?: string;
    confidence?: number;
    epistemicStatus?: KnowledgeEpistemicStatus;
    assumptions?: string[];
    uncertainty?: string;
    derivationMethod?: string;
    representationScope?: string;
    informationLoss?: KnowledgeInformationLoss;
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
  assumptions?: string[];
  openQuestions?: string[];
}

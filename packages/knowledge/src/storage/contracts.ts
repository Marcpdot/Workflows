import type {
  KnowledgeEdge,
  KnowledgeNode,
  KnowledgeStatus,
  KnowledgeStore,
} from "../types.js";

export type KnowledgeRepositoryBackend =
  | "postgresql"
  | "graph"
  | "vector"
  | "spatial"
  | (string & {});

export interface RepositoryHealth {
  backend: KnowledgeRepositoryBackend;
  ok: boolean;
  detail?: string;
}

/**
 * Authoritative structured knowledge boundary. Implementations must preserve
 * proposal resolution, provenance, identity, workspace and history semantics.
 */
export interface CanonicalKnowledgeRepository extends KnowledgeStore {
  readonly backend: KnowledgeRepositoryBackend;
  healthCheck(): Promise<RepositoryHealth>;
  /** Repeatable-read, keyset-paginated traversal of the complete accepted state. */
  scanAcceptedNodes(options?: { pageSize?: number }): AsyncIterable<readonly KnowledgeNode[]>;
  scanAcceptedTopology(options?: { pageSize?: number }): AsyncIterable<{
    nodes?: readonly KnowledgeNode[];
    edges?: readonly KnowledgeEdge[];
  }>;
  getEdge(id: string): Promise<KnowledgeEdge | null>;
}

export interface GraphTraversalOptions {
  hops?: number;
  relation?: string;
  status?: KnowledgeStatus;
  workspaceId?: string | null;
  limit?: number;
}

export interface GraphPath {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

/** Reconstructable topology projection. Canonical SQL remains authoritative. */
export interface GraphRepository {
  readonly backend: KnowledgeRepositoryBackend;
  healthCheck(): Promise<RepositoryHealth>;
  replaceAcceptedProjection(input: {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
  }): Promise<void>;
  upsertNode(node: KnowledgeNode): Promise<void>;
  upsertEdge(input: { edge: KnowledgeEdge; from: KnowledgeNode; to: KnowledgeNode }): Promise<void>;
  deleteCanonicalId(canonicalId: string): Promise<void>;
  getNode(canonicalNodeId: string): Promise<KnowledgeNode | null>;
  expand(
    canonicalNodeId: string,
    options?: GraphTraversalOptions
  ): Promise<GraphPath>;
  findPath(input: {
    fromCanonicalNodeId: string;
    toCanonicalNodeId: string;
    maxHops?: number;
    workspaceId?: string | null;
  }): Promise<GraphPath | null>;
  close(): Promise<void>;
}

export interface SemanticVectorRecord {
  id: string;
  canonicalId: string;
  sourceId?: string;
  chunkId?: string;
  workspaceId?: string | null;
  entityType?: string;
  model: string;
  modelVersion: string;
  dimension: number;
  vector: readonly number[];
  contentHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SemanticVectorHit {
  record: SemanticVectorRecord;
  score: number;
}

/** Derived semantic index; records always point back to canonical identities. */
export interface VectorRepository {
  readonly backend: KnowledgeRepositoryBackend;
  healthCheck(): Promise<RepositoryHealth>;
  upsert(record: SemanticVectorRecord): Promise<void>;
  get(id: string): Promise<SemanticVectorRecord | null>;
  deleteByCanonicalId(canonicalId: string): Promise<number>;
  /** Atomically replace one model/version projection after embeddings exist. */
  replaceProjection(input: {
    model: string;
    modelVersion: string;
    records: readonly SemanticVectorRecord[];
  }): Promise<void>;
  search(
    queryVector: readonly number[],
    options: {
      limit?: number;
      minScore?: number;
      workspaceId?: string | null;
      canonicalIds?: string[];
      entityTypes?: string[];
      model: string;
      modelVersion: string;
      sourceIds?: string[];
      chunkIds?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<SemanticVectorHit[]>;
  close(): Promise<void>;
}

export type GeoJsonGeometry = Record<string, unknown> & {
  type: string;
  coordinates: unknown;
};

export interface SpatialRecord {
  canonicalId: string;
  geometry: GeoJsonGeometry;
  properties?: Record<string, unknown>;
  updatedAt: number;
}

export interface SpatialHit extends SpatialRecord {
  distanceMeters?: number;
}

/** Canonical PostGIS capability; geometry is attached to canonical entities. */
export interface SpatialRepository {
  readonly backend: KnowledgeRepositoryBackend;
  healthCheck(): Promise<RepositoryHealth>;
  upsert(record: SpatialRecord): Promise<void>;
  get(canonicalId: string): Promise<SpatialRecord | null>;
  withinDistance(input: {
    longitude: number;
    latitude: number;
    distanceMeters: number;
    workspaceId?: string | null;
    limit?: number;
  }): Promise<SpatialHit[]>;
  delete(canonicalId: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface KnowledgeRepositories {
  canonical: CanonicalKnowledgeRepository;
  graph?: GraphRepository;
  vector?: VectorRepository;
  spatial?: SpatialRepository;
}

import type { CanonicalKnowledgeRepository, GraphRepository, SpatialHit, SpatialRepository, VectorRepository } from "./storage/contracts.js";
import type { KnowledgeEdge, KnowledgeEvent, KnowledgeEvidence, KnowledgeNode, KnowledgeNodeType, KnowledgeObservation } from "./types.js";

export type RetrievalOrigin = "exact" | "structured_candidate" | "graph" | "semantic" | "project" | "spatial";
export type RetrievalStrategyState = "ran" | "skipped" | "unavailable" | "degraded";
export interface RetrievalStrategyReport { state: RetrievalStrategyState; detail?: string; candidates?: number; }

export interface HybridRetrievalRequest {
  canonicalIds?: string[];
  identityQueries?: Array<{ label: string; type?: KnowledgeNodeType }>;
  candidateCanonicalIds?: string[];
  graphRootIds?: string[];
  projectId?: string;
  workspaceId?: string | null;
  entityTypes?: string[];
  graphRelation?: string;
  graphHops?: number;
  semanticGraphHops?: number;
  queryVector?: readonly number[];
  embeddingModel?: string;
  embeddingModelVersion?: string;
  semanticLimit?: number;
  overallLimit?: number;
  contextBudget?: number;
  maxEdges?: number;
  includeEvidence?: boolean;
  includeObservations?: boolean;
  includeSources?: boolean;
  evidencePerIdentity?: number;
  observationsPerIdentity?: number;
  sourcesPerIdentity?: number;
  spatial?: { longitude: number; latitude: number; distanceMeters: number; limit?: number };
}

export interface HybridRetrievalItem {
  node: KnowledgeNode;
  origins: RetrievalOrigin[];
  semanticScore?: number;
  rankScore: number;
  graphRootIds: string[];
  graphEdgeIds: string[];
  evidence: KnowledgeEvidence[];
  observations: KnowledgeObservation[];
  sources: KnowledgeNode[];
  events: KnowledgeEvent[];
  spatial?: SpatialHit;
}

export interface HybridRetrievalResult {
  items: HybridRetrievalItem[];
  edges: KnowledgeEdge[];
  strategies: { exact: RetrievalStrategyReport; graph: RetrievalStrategyReport; semantic: RetrievalStrategyReport; spatial: RetrievalStrategyReport; hydration: RetrievalStrategyReport };
  bounds: { overallLimit: number; graphHops: number; semanticLimit: number; contextBudget: number; budgetUsed: number; truncated: boolean };
}

export interface HybridRetrievalDependencies { canonical: CanonicalKnowledgeRepository; graph?: GraphRepository; vector?: VectorRepository; spatial?: SpatialRepository; }
export class CanonicalRetrievalUnavailableError extends Error { constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "CanonicalRetrievalUnavailableError"; } }

const bounded = (value: number | undefined, fallback: number, max: number) => Math.min(Math.max(Math.floor(value ?? fallback), 0), max);
const unique = (values: readonly string[] = []) => [...new Set(values.filter(Boolean))];
const workspaceMatches = (node: KnowledgeNode, workspaceId: string | null | undefined) => workspaceId === undefined || node.workspaceId == null || node.workspaceId === workspaceId;

export class HybridKnowledgeRetrievalService {
  constructor(private readonly repositories: HybridRetrievalDependencies) {}

  async retrieve(request: HybridRetrievalRequest): Promise<HybridRetrievalResult> {
    const overallLimit = bounded(request.overallLimit, 12, 100); const semanticLimit = bounded(request.semanticLimit, 20, 100);
    const graphHops = bounded(request.graphHops, 1, 4); const semanticGraphHops = bounded(request.semanticGraphHops, 0, 2);
    const maxEdges = bounded(request.maxEdges, 50, 250); const contextBudget = bounded(request.contextBudget, 300, 5000);
    const evidenceLimit = bounded(request.evidencePerIdentity, 5, 20); const observationLimit = bounded(request.observationsPerIdentity, 8, 50); const sourceLimit = bounded(request.sourcesPerIdentity, 8, 25);
    const strategies = { exact: { state: "skipped" } as RetrievalStrategyReport, graph: { state: this.repositories.graph ? "skipped" : "unavailable" } as RetrievalStrategyReport, semantic: { state: this.repositories.vector ? "skipped" : "unavailable" } as RetrievalStrategyReport, spatial: { state: this.repositories.spatial ? "skipped" : "unavailable" } as RetrievalStrategyReport, hydration: { state: "skipped" } as RetrievalStrategyReport };
    const origins = new Map<string, Set<RetrievalOrigin>>(); const semanticScores = new Map<string, number>(); const graphRoots = new Map<string, Set<string>>();
    const canonicalNodes = new Map<string, KnowledgeNode>(); const graphEdges = new Map<string, KnowledgeEdge>();
    const spatialHits = new Map<string, SpatialHit>();
    const mark = (id: string, origin: RetrievalOrigin) => { const set = origins.get(id) ?? new Set<RetrievalOrigin>(); set.add(origin); origins.set(id, set); };
    const canonical = this.repositories.canonical;

    try {
      const exactIds = unique([...(request.canonicalIds ?? []), ...(request.candidateCanonicalIds ?? []), ...(request.projectId ? [request.projectId] : [])]);
      for (const id of exactIds) { const node = await canonical.getNode(id); if (node) { canonicalNodes.set(id, node); mark(id, request.projectId === id ? "project" : request.candidateCanonicalIds?.includes(id) ? "structured_candidate" : "exact"); } }
      for (const query of request.identityQueries ?? []) { const node = await canonical.resolveCanonical(query); if (node) { canonicalNodes.set(node.id, node); mark(node.id, "exact"); } }
      if (exactIds.length || request.identityQueries?.length) strategies.exact = { state: "ran", candidates: canonicalNodes.size };
    } catch (error) { throw new CanonicalRetrievalUnavailableError("canonical PostgreSQL retrieval failed", { cause: error }); }

    const roots = unique([...(request.graphRootIds ?? []), ...(request.projectId ? [request.projectId] : [])]);
    let graphSucceeded = false;
    if (roots.length && this.repositories.graph) {
      try {
        for (const root of roots) {
          const path = await this.repositories.graph.expand(root, { hops: Math.max(graphHops, 1), relation: request.graphRelation, workspaceId: request.workspaceId, status: "accepted", limit: maxEdges });
          for (const node of path.nodes) { mark(node.id, "graph"); const set = graphRoots.get(node.id) ?? new Set<string>(); set.add(root); graphRoots.set(node.id, set); }
          for (const edge of path.edges) graphEdges.set(edge.id, edge);
        }
        graphSucceeded = true; strategies.graph = { state: "ran", candidates: [...origins].filter(([, value]) => value.has("graph")).length };
      } catch (error) { strategies.graph = { state: "degraded", detail: error instanceof Error ? error.message : String(error) }; }
    }

    let spatialSucceeded = false;
    if (request.spatial && this.repositories.spatial) {
      try {
        const hits = await this.repositories.spatial.withinDistance({ ...request.spatial, workspaceId: request.workspaceId, limit: bounded(request.spatial.limit, 50, 250) });
        for (const hit of hits) { spatialHits.set(hit.canonicalId, hit); mark(hit.canonicalId, "spatial"); }
        spatialSucceeded = true; strategies.spatial = { state: "ran", candidates: hits.length };
      } catch (error) { strategies.spatial = { state: "degraded", detail: error instanceof Error ? error.message : String(error) }; }
    }

    const semanticRequested = request.queryVector != null;
    if (semanticRequested && this.repositories.vector) {
      const graphScopeRequired = roots.length > 0; const spatialScopeRequired = request.spatial != null;
      if (((graphScopeRequired && !graphSucceeded) || (spatialScopeRequired && !spatialSucceeded)) && !(request.candidateCanonicalIds?.length)) strategies.semantic = { state: "skipped", detail: "required narrowing scope unavailable; refusing unscoped semantic widening" };
      else {
        let candidateIds: string[] | undefined;
        const explicitCandidates = request.candidateCanonicalIds?.length ? new Set(request.candidateCanonicalIds) : null;
        const graphCandidates = graphSucceeded ? new Set([...origins].filter(([, value]) => value.has("graph")).map(([id]) => id)) : null;
        const spatialCandidates = spatialSucceeded ? new Set(spatialHits.keys()) : null;
        const scopes = [explicitCandidates, graphCandidates, spatialCandidates].filter((scope): scope is Set<string> => scope != null);
        if (scopes.length) candidateIds = [...scopes[0]!].filter((id) => scopes.slice(1).every((scope) => scope.has(id)));
        if (candidateIds && candidateIds.length === 0) strategies.semantic = { state: "ran", detail: "empty narrowed candidate scope", candidates: 0 };
        else try {
          if (!request.embeddingModel || !request.embeddingModelVersion) throw new Error("semantic retrieval requires embeddingModel and embeddingModelVersion");
          const hits = await this.repositories.vector.search(request.queryVector!, { model: request.embeddingModel, modelVersion: request.embeddingModelVersion, limit: semanticLimit, workspaceId: request.workspaceId, canonicalIds: candidateIds, entityTypes: request.entityTypes });
          for (const hit of hits) { mark(hit.record.canonicalId, "semantic"); semanticScores.set(hit.record.canonicalId, Math.max(semanticScores.get(hit.record.canonicalId) ?? -Infinity, hit.score)); }
          strategies.semantic = { state: "ran", candidates: hits.length };
        } catch (error) { strategies.semantic = { state: "degraded", detail: error instanceof Error ? error.message : String(error) }; }
      }
    }

    if (semanticScores.size && semanticGraphHops > 0 && this.repositories.graph) {
      try {
        for (const id of [...semanticScores.keys()].slice(0, semanticLimit)) {
          const path = await this.repositories.graph.expand(id, { hops: semanticGraphHops, workspaceId: request.workspaceId, status: "accepted", limit: maxEdges });
          for (const node of path.nodes) { mark(node.id, "graph"); const set = graphRoots.get(node.id) ?? new Set<string>(); set.add(id); graphRoots.set(node.id, set); }
          for (const edge of path.edges) graphEdges.set(edge.id, edge);
        }
        strategies.graph = { state: "ran", detail: roots.length ? "root expansion and semantic enrichment" : "semantic-first enrichment", candidates: [...origins].filter(([, value]) => value.has("graph")).length };
      } catch (error) { strategies.graph = { state: "degraded", detail: error instanceof Error ? error.message : String(error) }; }
    }

    try {
      for (const id of origins.keys()) if (!canonicalNodes.has(id)) { const node = await canonical.getNode(id); if (node) canonicalNodes.set(id, node); }
    } catch (error) { throw new CanonicalRetrievalUnavailableError("canonical hydration failed", { cause: error }); }
    const eligible = [...canonicalNodes.values()].filter((node) => node.status === "accepted" && workspaceMatches(node, request.workspaceId) && (!request.entityTypes?.length || request.entityTypes.includes(node.type)));
    const scored = eligible.map((node) => { const source = origins.get(node.id) ?? new Set<RetrievalOrigin>(); const semanticScore = semanticScores.get(node.id); const rankScore = (source.has("exact") ? 3 : 0) + (source.has("project") ? 3 : 0) + (source.has("structured_candidate") ? 2 : 0) + (source.has("graph") ? 1 : 0) + (source.has("spatial") ? 1 : 0) + (semanticScore == null ? 0 : Math.max(0, semanticScore) * 2); return { node, source, semanticScore, rankScore }; }).sort((a, b) => b.rankScore - a.rankScore || (b.semanticScore ?? -Infinity) - (a.semanticScore ?? -Infinity) || a.node.id.localeCompare(b.node.id));

    let budgetUsed = 0; let truncated = scored.length > overallLimit; const items: HybridRetrievalItem[] = [];
    for (const entry of scored.slice(0, overallLimit)) {
      if (budgetUsed + 10 > contextBudget) { truncated = true; break; } budgetUsed += 10;
      let evidence: KnowledgeEvidence[] = []; let observations: KnowledgeObservation[] = []; const sources: KnowledgeNode[] = []; const events: KnowledgeEvent[] = [];
      try {
        if (request.includeEvidence) { const found = await canonical.listEvidence(entry.node.id, evidenceLimit); const allowed = Math.min(found.length, Math.floor((contextBudget - budgetUsed) / 3)); evidence = found.slice(0, allowed); budgetUsed += evidence.length * 3; if (allowed < found.length) truncated = true; }
        if (request.includeObservations) { const found = await canonical.listObservations(entry.node.id, observationLimit); const allowed = Math.min(found.length, Math.floor((contextBudget - budgetUsed) / 2)); observations = found.slice(0, allowed); budgetUsed += observations.length * 2; if (allowed < found.length) truncated = true; }
        if (request.includeSources) {
          const sourceIds = unique([...evidence.map((value) => value.sourceNodeId), ...observations.map((value) => value.sourceNodeId ?? "")]).slice(0, sourceLimit);
          for (const id of sourceIds) { if (budgetUsed + 5 > contextBudget) { truncated = true; break; } const source = await canonical.getNode(id); if (source) { sources.push(source); budgetUsed += 5; } }
          const eventIds = unique([...evidence.map((value) => value.sourceEventId ?? ""), ...observations.map((value) => value.sourceEventId ?? "")]).slice(0, sourceLimit);
          for (const id of eventIds) { if (budgetUsed + 2 > contextBudget) { truncated = true; break; } const event = await canonical.getEvent(id); if (event) { events.push(event); budgetUsed += 2; } }
        }
      } catch (error) { throw new CanonicalRetrievalUnavailableError(`canonical provenance hydration failed for ${entry.node.id}`, { cause: error }); }
      items.push({ node: entry.node, origins: [...entry.source].sort(), semanticScore: entry.semanticScore, rankScore: entry.rankScore, graphRootIds: [...(graphRoots.get(entry.node.id) ?? [])], graphEdgeIds: [...graphEdges.values()].filter((edge) => edge.fromNodeId === entry.node.id || edge.toNodeId === entry.node.id).map((edge) => edge.id).slice(0, maxEdges), evidence, observations, sources, events, spatial: spatialHits.get(entry.node.id) });
    }
    strategies.hydration = { state: "ran", candidates: items.length };
    const selectedIds = new Set(items.map((item) => item.node.id)); const edges: KnowledgeEdge[] = [];
    for (const edge of graphEdges.values()) { if (edges.length >= maxEdges || budgetUsed + 2 > contextBudget) { truncated = true; break; } if (selectedIds.has(edge.fromNodeId) || selectedIds.has(edge.toNodeId)) { edges.push(edge); budgetUsed += 2; } }
    return { items, edges, strategies, bounds: { overallLimit, graphHops, semanticLimit, contextBudget, budgetUsed, truncated } };
  }
}

export function createHybridKnowledgeRetrievalService(repositories: HybridRetrievalDependencies): HybridKnowledgeRetrievalService { return new HybridKnowledgeRetrievalService(repositories); }

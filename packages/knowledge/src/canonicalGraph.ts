import type { CanonicalKnowledgeRepository, GraphPath } from "./storage/contracts.js";
import type { KnowledgeEdge, KnowledgeNode } from "./types.js";

export interface CanonicalGraphValidation {
  graph: GraphPath;
  valid: boolean;
  invalidNodeIds: string[];
  invalidEdgeIds: string[];
}

/** Neo4j supplies candidate topology; PostgreSQL decides current visibility. */
export async function validateCanonicalGraph(
  canonical: CanonicalKnowledgeRepository,
  candidate: GraphPath,
  options: { requireAccepted?: boolean; requireCompletePath?: boolean } = {}
): Promise<CanonicalGraphValidation> {
  const requireAccepted = options.requireAccepted !== false;
  const hydrated = await Promise.all(candidate.nodes.map((node) => canonical.getNode(node.id)));
  const validNodes = new Map<string, KnowledgeNode>();
  const invalidNodeIds: string[] = [];
  hydrated.forEach((node, index) => {
    const candidateId = candidate.nodes[index]!.id;
    if (node && (!requireAccepted || node.status === "accepted")) validNodes.set(node.id, node);
    else invalidNodeIds.push(candidateId);
  });

  const hydratedEdges = await Promise.all(candidate.edges.map((edge) => canonical.getEdge(edge.id)));
  const edges: KnowledgeEdge[] = [];
  const invalidEdgeIds: string[] = [];
  hydratedEdges.forEach((edge, index) => {
    const candidateEdge = candidate.edges[index]!;
    if (edge && (!requireAccepted || edge.status === "accepted") && validNodes.has(edge.fromNodeId) && validNodes.has(edge.toNodeId)) edges.push(edge);
    else invalidEdgeIds.push(candidateEdge.id);
  });

  const complete = invalidNodeIds.length === 0 && invalidEdgeIds.length === 0;
  if (options.requireCompletePath && !complete) {
    return { graph: { nodes: [], edges: [] }, valid: false, invalidNodeIds, invalidEdgeIds };
  }
  return { graph: { nodes: [...validNodes.values()], edges }, valid: complete, invalidNodeIds, invalidEdgeIds };
}

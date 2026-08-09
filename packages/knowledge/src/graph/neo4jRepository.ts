import neo4j, { type Driver, type ManagedTransaction, type Node, type Path, type Relationship } from "neo4j-driver";
import type { GraphPath, GraphRepository, GraphTraversalOptions, RepositoryHealth } from "../storage/contracts.js";
import type { KnowledgeEdge, KnowledgeNode, KnowledgeStatus } from "../types.js";
import type { Neo4jGraphConfig } from "./config.js";

type Props = Record<string, unknown>;

function compact(properties: Props): Props { return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined && value !== null)); }
function nodeProps(item: KnowledgeNode): Props { return compact({ canonicalId: item.id, type: item.type, label: item.label, description: item.description, status: item.status, workspaceId: item.workspaceId, createdAt: item.createdAt, updatedAt: item.updatedAt }); }
function edgeProps(item: KnowledgeEdge): Props { return compact({ canonicalId: item.id, fromCanonicalId: item.fromNodeId, toCanonicalId: item.toNodeId, relation: item.relation, confidence: item.confidence, sourceEventId: item.sourceEventId, status: item.status, createdAt: item.createdAt }); }

function mappedNode(value: Node): KnowledgeNode {
  const p = value.properties as Props;
  return { id: String(p.canonicalId), type: String(p.type), label: String(p.label), description: p.description == null ? undefined : String(p.description), status: String(p.status) as KnowledgeStatus, workspaceId: p.workspaceId == null ? null : String(p.workspaceId), createdAt: Number(p.createdAt), updatedAt: Number(p.updatedAt) };
}
function mappedEdge(value: Relationship): KnowledgeEdge {
  const p = value.properties as Props;
  return { id: String(p.canonicalId), fromNodeId: String(p.fromCanonicalId), toNodeId: String(p.toCanonicalId), relation: String(p.relation), confidence: p.confidence == null ? undefined : Number(p.confidence), sourceEventId: p.sourceEventId == null ? undefined : String(p.sourceEventId), status: String(p.status) as KnowledgeStatus, createdAt: Number(p.createdAt) };
}
function graphPath(paths: Path[], roots: Node[] = []): GraphPath {
  const nodes = new Map<string, KnowledgeNode>(); const edges = new Map<string, KnowledgeEdge>();
  for (const root of roots) { const item = mappedNode(root); nodes.set(item.id, item); }
  for (const path of paths) for (const segment of path.segments) {
    for (const raw of [segment.start, segment.end]) { const item = mappedNode(raw); nodes.set(item.id, item); }
    const item = mappedEdge(segment.relationship); edges.set(item.id, item);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export class Neo4jGraphRepository implements GraphRepository {
  readonly backend = "graph" as const;
  private readonly driver: Driver;
  private readonly database: string;

  constructor(config: Neo4jGraphConfig, driver?: Driver) {
    this.driver = driver ?? neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), { disableLosslessIntegers: true });
    this.database = config.database;
  }

  private session() { return this.driver.session({ database: this.database }); }
  private async schema(): Promise<void> {
    const session = this.session();
    try {
      await session.run("CREATE CONSTRAINT canonical_node_id IF NOT EXISTS FOR (n:CanonicalNode) REQUIRE n.canonicalId IS UNIQUE");
      await session.run("CREATE INDEX canonical_node_workspace IF NOT EXISTS FOR (n:CanonicalNode) ON (n.workspaceId)");
      await session.run("CREATE INDEX canonical_edge_id IF NOT EXISTS FOR ()-[r:CANONICAL_RELATION]-() ON (r.canonicalId)");
      await session.run("CREATE INDEX canonical_edge_relation IF NOT EXISTS FOR ()-[r:CANONICAL_RELATION]-() ON (r.relation)");
    } finally { await session.close(); }
  }

  async healthCheck(): Promise<RepositoryHealth> {
    try { await this.driver.verifyConnectivity(); await this.schema(); return { backend: this.backend, ok: true }; }
    catch (error) { return { backend: this.backend, ok: false, detail: error instanceof Error ? error.message : String(error) }; }
  }

  private async writeNodes(tx: ManagedTransaction, nodes: readonly KnowledgeNode[]): Promise<void> {
    if (!nodes.length) return;
    await tx.run("UNWIND $rows AS row MERGE (n:CanonicalNode {canonicalId: row.canonicalId}) SET n = row", { rows: nodes.map(nodeProps) });
  }
  private async writeEdges(tx: ManagedTransaction, edges: readonly KnowledgeEdge[]): Promise<void> {
    if (!edges.length) return;
    await tx.run(
      `UNWIND $rows AS row
       MATCH (a:CanonicalNode {canonicalId: row.fromCanonicalId}), (b:CanonicalNode {canonicalId: row.toCanonicalId})
       CREATE (a)-[r:CANONICAL_RELATION]->(b) SET r = row`,
      { rows: edges.map(edgeProps) }
    );
  }

  async replaceAcceptedProjection(input: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }): Promise<void> {
    const nodes = input.nodes.filter((item) => item.status === "accepted");
    const acceptedIds = new Set(nodes.map((item) => item.id));
    const edges = input.edges.filter((item) => item.status === "accepted" && acceptedIds.has(item.fromNodeId) && acceptedIds.has(item.toNodeId));
    await this.schema(); const session = this.session();
    try { await session.executeWrite(async (tx) => { await tx.run("MATCH (n:CanonicalNode) DETACH DELETE n"); await this.writeNodes(tx, nodes); await this.writeEdges(tx, edges); }); }
    finally { await session.close(); }
  }

  async upsertNode(item: KnowledgeNode): Promise<void> {
    const session = this.session(); try { await session.executeWrite((tx) => item.status === "accepted" ? this.writeNodes(tx, [item]) : tx.run("MATCH (n:CanonicalNode {canonicalId: $id}) DETACH DELETE n", { id: item.id }).then(() => undefined)); } finally { await session.close(); }
  }

  async upsertEdge(input: { edge: KnowledgeEdge; from: KnowledgeNode; to: KnowledgeNode }): Promise<void> {
    const session = this.session();
    try { await session.executeWrite(async (tx) => {
      await tx.run("MATCH ()-[r:CANONICAL_RELATION {canonicalId: $id}]-() DELETE r", { id: input.edge.id });
      if (input.edge.status !== "accepted" || input.from.status !== "accepted" || input.to.status !== "accepted") return;
      await this.writeNodes(tx, [input.from, input.to]); await this.writeEdges(tx, [input.edge]);
    }); } finally { await session.close(); }
  }

  async deleteCanonicalId(canonicalId: string): Promise<void> {
    const session = this.session();
    try { await session.executeWrite(async (tx) => { await tx.run("MATCH ()-[r:CANONICAL_RELATION {canonicalId: $id}]-() DELETE r", { id: canonicalId }); await tx.run("MATCH (n:CanonicalNode {canonicalId: $id}) DETACH DELETE n", { id: canonicalId }); }); }
    finally { await session.close(); }
  }

  async getNode(canonicalNodeId: string): Promise<KnowledgeNode | null> {
    const session = this.session();
    try { const result = await session.run("MATCH (n:CanonicalNode {canonicalId: $id}) RETURN n LIMIT 1", { id: canonicalNodeId }); return result.records[0] ? mappedNode(result.records[0].get("n") as Node) : null; }
    finally { await session.close(); }
  }

  async expand(canonicalNodeId: string, options: GraphTraversalOptions = {}): Promise<GraphPath> {
    if (options.status && options.status !== "accepted") return { nodes: [], edges: [] };
    const hops = Math.min(Math.max(Math.floor(options.hops ?? 1), 1), 10); const limit = Math.min(Math.max(Math.floor(options.limit ?? 250), 1), 5000);
    const workspaceEnabled = options.workspaceId !== undefined;
    const session = this.session();
    try {
      const rootResult = await session.run("MATCH (root:CanonicalNode {canonicalId: $id}) WHERE NOT $workspaceEnabled OR root.workspaceId IS NULL OR root.workspaceId = $workspace RETURN root", { id: canonicalNodeId, workspaceEnabled, workspace: options.workspaceId ?? null });
      if (!rootResult.records.length) return { nodes: [], edges: [] };
      const relationClause = options.relation ? "AND all(r IN relationships(p) WHERE r.relation = $relation)" : "";
      const result = await session.run(
        `MATCH p=(root:CanonicalNode {canonicalId: $id})-[*1..${hops}]-(other:CanonicalNode)
         WHERE (NOT $workspaceEnabled OR all(n IN nodes(p) WHERE n.workspaceId IS NULL OR n.workspaceId = $workspace)) ${relationClause}
         RETURN p LIMIT ${limit}`,
        { id: canonicalNodeId, workspaceEnabled, workspace: options.workspaceId ?? null, relation: options.relation ?? null }
      );
      return graphPath(result.records.map((item) => item.get("p") as Path), [rootResult.records[0]!.get("root") as Node]);
    } finally { await session.close(); }
  }

  async findPath(input: { fromCanonicalNodeId: string; toCanonicalNodeId: string; maxHops?: number; workspaceId?: string | null }): Promise<GraphPath | null> {
    const maxHops = Math.min(Math.max(Math.floor(input.maxHops ?? 6), 1), 20); const workspaceEnabled = input.workspaceId !== undefined;
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (a:CanonicalNode {canonicalId: $from}), (b:CanonicalNode {canonicalId: $to})
         MATCH p=shortestPath((a)-[*1..${maxHops}]->(b))
         WHERE NOT $workspaceEnabled OR all(n IN nodes(p) WHERE n.workspaceId IS NULL OR n.workspaceId = $workspace)
         RETURN p LIMIT 1`,
        { from: input.fromCanonicalNodeId, to: input.toCanonicalNodeId, workspaceEnabled, workspace: input.workspaceId ?? null }
      );
      return result.records[0] ? graphPath([result.records[0].get("p") as Path]) : null;
    } finally { await session.close(); }
  }

  async close(): Promise<void> { await this.driver.close(); }
}

export function createNeo4jGraphRepository(config: Neo4jGraphConfig): GraphRepository { return new Neo4jGraphRepository(config); }

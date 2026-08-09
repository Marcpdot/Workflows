import type { Pool } from "pg";
import type { CanonicalKnowledgeRepository, GraphRepository } from "./storage/contracts.js";
import type { KnowledgeEdge, KnowledgeNode } from "./types.js";

export interface GraphProjectionResult { nodes: number; edges: number; }
export interface GraphOutboxResult { processed: number; failed: number; }

export async function rebuildGraphProjection(input: {
  canonical: CanonicalKnowledgeRepository;
  graph: GraphRepository;
  pageSize?: number;
}): Promise<GraphProjectionResult> {
  const nodes: KnowledgeNode[] = []; const edges: KnowledgeEdge[] = [];
  for await (const page of input.canonical.scanAcceptedTopology({ pageSize: input.pageSize })) {
    if (page.nodes) nodes.push(...page.nodes);
    if (page.edges) edges.push(...page.edges);
  }
  const acceptedNodeIds = new Set(nodes.map((item) => item.id));
  const eligibleEdges = edges.filter((item) => acceptedNodeIds.has(item.fromNodeId) && acceptedNodeIds.has(item.toNodeId));
  await input.graph.replaceAcceptedProjection({ nodes, edges: eligibleEdges });
  return { nodes: nodes.length, edges: eligibleEdges.length };
}

export async function processGraphProjectionOutbox(input: {
  pool: Pool;
  canonical: CanonicalKnowledgeRepository;
  graph: GraphRepository;
  limit?: number;
}): Promise<GraphOutboxResult> {
  const client = await input.pool.connect(); const lockId = 8_214_701_935; let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockId]);
    locked = lock.rows[0]?.locked === true; if (!locked) return { processed: 0, failed: 0 };
    const jobs = await client.query<{ id: string; canonical_id: string; operation: "upsert" | "delete" | "rebuild"; sequence_id: string }>(
      `SELECT * FROM (SELECT DISTINCT ON (canonical_id) id::text, canonical_id::text, operation, sequence_id::text, available_at
       FROM knowledge_projection_outbox WHERE projection = 'graph' AND processed_at IS NULL
       ORDER BY canonical_id, sequence_id DESC) latest
       WHERE available_at <= now() ORDER BY sequence_id ASC LIMIT $1`,
      [Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000)]
    );
    let processed = 0; let failed = 0;
    for (const job of jobs.rows) {
      try {
        if (job.operation === "rebuild") await rebuildGraphProjection(input);
        else if (job.operation === "delete") await input.graph.deleteCanonicalId(job.canonical_id);
        else {
          const node = await input.canonical.getNode(job.canonical_id);
          if (node) { if (node.status === "accepted") await input.graph.upsertNode(node); else await input.graph.deleteCanonicalId(node.id); }
          else {
            const edge = await input.canonical.getEdge(job.canonical_id);
            if (!edge || edge.status !== "accepted") await input.graph.deleteCanonicalId(job.canonical_id);
            else {
              const from = await input.canonical.getNode(edge.fromNodeId); const to = await input.canonical.getNode(edge.toNodeId);
              if (!from || !to) throw new Error(`graph edge ${edge.id} has unresolved canonical endpoints`);
              if (from.status !== "accepted" || to.status !== "accepted") await input.graph.deleteCanonicalId(edge.id); else await input.graph.upsertEdge({ edge, from, to });
            }
          }
        }
        await client.query("UPDATE knowledge_projection_outbox SET processed_at = now(), last_error = NULL WHERE id = $1 AND processed_at IS NULL", [job.id]); processed++;
        await client.query("UPDATE knowledge_projection_outbox SET processed_at = now(), last_error = $4 WHERE projection = 'graph' AND canonical_id = $1 AND processed_at IS NULL AND sequence_id < $2 AND id <> $3", [job.canonical_id, job.sequence_id, job.id, `superseded by newer successful job ${job.id}`]);
      } catch (error) {
        await client.query(
          `UPDATE knowledge_projection_outbox SET attempt_count = attempt_count + 1,
           last_error = $2, available_at = now() + interval '1 minute' WHERE id = $1 AND processed_at IS NULL`,
          [job.id, error instanceof Error ? error.message : String(error)]
        ); failed++;
      }
    }
    return { processed, failed };
  } finally { if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lockId]); client.release(); }
}

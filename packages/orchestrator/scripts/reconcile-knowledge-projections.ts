import { createKnowledgePostgresPool, createKnowledgeStore, createNeo4jGraphRepository, createPostgresVectorRepository, processGraphProjectionOutbox, processVectorProjectionOutbox, rebuildGraphProjection, rebuildSemanticVectorProjection, resolveNeo4jGraphConfig, resolvePostgresKnowledgeConfig } from "@workflows/knowledge";
import { createConfiguredKnowledgeEmbeddingProvider } from "../src/knowledgeEmbedding.js";

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "incremental"; if (!['incremental', 'rebuild'].includes(mode)) throw new Error("Usage: npm run knowledge:projections -- incremental|rebuild");
  const config = resolvePostgresKnowledgeConfig(); const pool = createKnowledgePostgresPool(config); const canonical = createKnowledgeStore({ postgresConfig: config, pool }); const graph = createNeo4jGraphRepository(resolveNeo4jGraphConfig()); const vector = createPostgresVectorRepository({ ...config, pool }); const embedder = createConfiguredKnowledgeEmbeddingProvider();
  try {
    if (mode === "rebuild") { const graphResult = await rebuildGraphProjection({ canonical, graph }); const vectorResult = await rebuildSemanticVectorProjection({ canonical, vector, embedder }); console.log(JSON.stringify({ mode, graph: graphResult, vector: vectorResult })); return; }
    let graphProcessed = 0; let vectorProcessed = 0; let failed = 0;
    for (;;) { const [g, v] = await Promise.all([processGraphProjectionOutbox({ pool, canonical, graph }), processVectorProjectionOutbox({ pool, canonical, vector, embedder })]); graphProcessed += g.processed; vectorProcessed += v.processed; failed += g.failed + v.failed; if (g.processed + g.failed + v.processed + v.failed === 0 || g.failed + v.failed > 0) break; }
    console.log(JSON.stringify({ mode, graphProcessed, vectorProcessed, failed })); if (failed) process.exitCode = 1;
  } finally { await graph.close(); await vector.close(); await pool.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

import {
  createKnowledgePostgresPool,
  createKnowledgeStore,
  createNeo4jGraphRepository,
  createPostgresVectorRepository,
  resolveNeo4jGraphConfig,
  resolvePostgresKnowledgeConfig,
  runKnowledgeBackgroundPass,
} from "@workflows/knowledge";
import { createMemory } from "@workflows/memory";
import { createConfiguredKnowledgeEmbeddingProvider } from "../src/knowledgeEmbedding.js";

async function main(): Promise<void> {
  const config = resolvePostgresKnowledgeConfig();
  const pool = createKnowledgePostgresPool(config);
  const canonical = createKnowledgeStore({ postgresConfig: config, pool });
  const memory = createMemory({ dbPath: process.env.MEMORY_DB_PATH ?? "./data/memory.db" });
  const graph = createNeo4jGraphRepository(resolveNeo4jGraphConfig());
  const vector = createPostgresVectorRepository({ ...config, pool });
  const embedder = createConfiguredKnowledgeEmbeddingProvider();
  try {
    const result = await runKnowledgeBackgroundPass({
      pool,
      canonical,
      experiences: memory,
      graph,
      vector,
      embedder,
      limits: {
        maxItems: Number(process.env.CC_BACKGROUND_MAX_ITEMS ?? 20),
        maxModelCalls: Number(process.env.CC_BACKGROUND_MAX_MODEL_CALLS ?? 0),
      },
    });
    console.log(JSON.stringify(result));
    if (result.failures.length) process.exitCode = 1;
  } finally {
    memory.close();
    await graph.close();
    await vector.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

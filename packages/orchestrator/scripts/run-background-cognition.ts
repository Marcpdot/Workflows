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
import { createObserverFromEnv, emitSafely } from "@workflows/observability";
import { randomUUID } from "node:crypto";
import { createConfiguredKnowledgeEmbeddingProvider } from "../src/knowledgeEmbedding.js";
import { observeBackgroundPass } from "../src/cognitiveObservability.js";

async function main(): Promise<void> {
  const config = resolvePostgresKnowledgeConfig();
  const pool = createKnowledgePostgresPool(config);
  const canonical = createKnowledgeStore({ postgresConfig: config, pool });
  const memory = createMemory({ dbPath: process.env.MEMORY_DB_PATH ?? "./data/memory.db" });
  const graph = createNeo4jGraphRepository(resolveNeo4jGraphConfig());
  const vector = createPostgresVectorRepository({ ...config, pool });
  const embedder = createConfiguredKnowledgeEmbeddingProvider();
  const observer = createObserverFromEnv(process.env);
  try {
    const limits = {
      maxItems: Number(process.env.CC_BACKGROUND_MAX_ITEMS ?? 20),
      maxModelCalls: Number(process.env.CC_BACKGROUND_MAX_MODEL_CALLS ?? 0),
    };
    const pending = [
      ...(await canonical.listBackgroundWork({ status: "pending", limit: limits.maxItems })),
      ...(await canonical.listBackgroundWork({ status: "waiting", limit: limits.maxItems })),
    ].slice(0, limits.maxItems);
    const passId = randomUUID();
    const result = await runKnowledgeBackgroundPass({
      pool,
      canonical,
      experiences: memory,
      graph,
      vector,
      embedder,
      limits,
    });
    const currentWork = await Promise.all(
      pending.map((item) => canonical.getBackgroundWork(item.id))
    );
    const background = observeBackgroundPass(passId, result, {
      limits,
      workIds: pending.map((item) => item.id),
      work: pending.map((item) => {
        const current = currentWork.find((candidate) => candidate?.id === item.id) ?? item;
        return {
          id: current.id,
          kind: current.kind,
          status: current.status,
          sourceExperienceId: current.sourceExperienceId,
          sourceEventId: current.sourceEventId,
          targetId: current.targetProposalId ?? current.targetNodeId,
        };
      }),
      sourceExperienceIds: [
        ...new Set(
          pending
            .map((item) => item.sourceExperienceId)
            .filter((id): id is string => Boolean(id))
        ),
      ],
    });
    emitSafely(observer, {
      ts: new Date().toISOString(),
      kind: "background",
      background,
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

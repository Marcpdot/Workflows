import {
  createKnowledgePostgresPool, createKnowledgeStore, createPostgresVectorRepository,
  KNOWLEDGE_VECTOR_DIMENSION, processVectorProjectionOutbox,
  rebuildSemanticVectorProjection, resolvePostgresKnowledgeConfig,
  semanticVectorRecordId, type SemanticEmbeddingProvider, type SemanticVectorRecord,
} from "@workflows/knowledge";
import { randomUUID } from "node:crypto";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`ASSERT: ${message}`); }
function vector(...entries: Array<[number, number]>): number[] { const value = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0); for (const [index, number] of entries) value[index] = number; return value; }

function fixtureEmbedder(fail = false): SemanticEmbeddingProvider {
  return {
    model: "fixture-semantic", modelVersion: "v1", dimension: KNOWLEDGE_VECTOR_DIMENSION,
    async embed(texts) {
      if (fail) throw new Error("fixture embedding failure");
      return texts.map((text) => { const index = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 32; return vector([index, 1], [(index + 1) % 32, 0.25]); });
    },
  };
}

async function acceptedNode(store: ReturnType<typeof createKnowledgeStore>, eventId: string, type: string, label: string) {
  const proposal = (await store.addProposals(eventId, [{ kind: "node", payload: { type, label } }]))[0];
  await store.acceptProposal(proposal.id);
  return (await store.findNodes({ type, label, status: "accepted" }))[0];
}

async function main(): Promise<void> {
  const runtime = await startKnowledgePostgresTest();
  const base = resolvePostgresKnowledgeConfig();
  const pool = createKnowledgePostgresPool({ ...base, connectionString: runtime.connectionString, applicationName: `${base.applicationName}-vector-test` });
  const canonical = createKnowledgeStore({ postgresConfig: { ...base, connectionString: runtime.connectionString }, pool });
  const vectors = createPostgresVectorRepository({ ...base, connectionString: runtime.connectionString, pool });
  try {
    const indexes = await pool.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname = 'knowledge_semantic_vectors_embedding_hnsw_idx'");
    assert(indexes.rows[0]?.indexdef.toLowerCase().includes("using hnsw"), "semantic vectors use a PostgreSQL HNSW index");

    const event = await canonical.createEvent({ sourceType: "manual", sourceRef: "vector-integration" });
    const alpha = await acceptedNode(canonical, event.id, "idea", "Alpha cooling idea");
    const beta = await acceptedNode(canonical, event.id, "idea", "Beta cooling idea");
    const gamma = await acceptedNode(canonical, event.id, "artifact", "Gamma fixture");
    const source = await acceptedNode(canonical, event.id, "source", "Fixture source");
    const chunk = await acceptedNode(canonical, event.id, "chunk", "Fixture chunk 1");
    const now = Date.now();
    const make = (id: string, canonicalId: string, embedding: number[], extra: Partial<SemanticVectorRecord> = {}): SemanticVectorRecord => ({
      id, canonicalId, model: "fixture-semantic", modelVersion: "v1", dimension: KNOWLEDGE_VECTOR_DIMENSION,
      vector: embedding, entityType: "idea", workspaceId: "workspace-a", metadata: { language: "en" },
      contentHash: `hash-${canonicalId}`, createdAt: now, updatedAt: now, ...extra,
    });
    const alphaId = randomUUID(); const betaId = randomUUID(); const gammaId = randomUUID();
    await vectors.upsert(make(alphaId, alpha.id, vector([0, 1]), { sourceId: source.id, chunkId: chunk.id }));
    await vectors.upsert(make(betaId, beta.id, vector([0, 0.9], [1, 0.1])));
    await vectors.upsert(make(gammaId, gamma.id, vector([2, 1]), { entityType: "artifact", workspaceId: "workspace-b", metadata: { language: "no" } }));
    const stored = await vectors.get(alphaId);
    assert(stored?.canonicalId === alpha.id && stored.sourceId === source.id && stored.chunkId === chunk.id, "vector read retains canonical/source/chunk IDs");

    const ranked = await vectors.search(vector([0, 1]), { model: "fixture-semantic", modelVersion: "v1", limit: 3 });
    assert(ranked[0]?.record.canonicalId === alpha.id && ranked[1]?.record.canonicalId === beta.id, "pgvector cosine search ranks similar vectors");
    assert(new Set(ranked.slice(0, 2).map((hit) => hit.record.canonicalId)).size === 2, "similar vectors do not merge canonical identities");
    const filtered = await vectors.search(vector([0, 1]), { model: "fixture-semantic", modelVersion: "v1", canonicalIds: [beta.id], entityTypes: ["idea"], workspaceId: "workspace-a", metadata: { language: "en" } });
    assert(filtered.length === 1 && filtered[0].record.canonicalId === beta.id, "canonical and metadata filters execute in vector search");
    const sourceFiltered = await vectors.search(vector([0, 1]), { model: "fixture-semantic", modelVersion: "v1", sourceIds: [source.id], chunkIds: [chunk.id] });
    assert(sourceFiltered.length === 1 && sourceFiltered[0].record.id === alphaId, "source/chunk candidate filters work");

    await vectors.upsert(make(alphaId, alpha.id, vector([3, 1]), { contentHash: "updated" }));
    assert((await vectors.get(alphaId))?.contentHash === "updated", "same canonical vector record updates safely");
    let dimensionFailed = false; try { await vectors.upsert({ ...make(randomUUID(), alpha.id, [1, 0]), dimension: 2 }); } catch { dimensionFailed = true; }
    assert(dimensionFailed, "incompatible embedding dimension fails clearly");
    let modelFailed = false; try { await vectors.upsert({ ...make(randomUUID(), alpha.id, vector([0, 1])), modelVersion: "" }); } catch { modelFailed = true; }
    assert(modelFailed, "missing embedding model version fails clearly");

    assert(await vectors.deleteByCanonicalId(alpha.id) === 1 && await vectors.get(alphaId) === null, "vector delete lifecycle works");
    const rebuilt = await rebuildSemanticVectorProjection({ canonical, vector: vectors, embedder: fixtureEmbedder() });
    assert(rebuilt.projected >= 5, "projection rebuild embeds accepted canonical state");
    assert(await vectors.get(semanticVectorRecordId(alpha.id, "fixture-semantic", "v1")) !== null, "deleted projection rebuilds deterministically from canonical state");

    await pool.query(
      `INSERT INTO knowledge_projection_outbox (id, canonical_id, projection, operation)
       VALUES ($1, $2, 'vector', 'delete')`,
      [randomUUID(), beta.id]
    );
    const deleteResult = await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder: fixtureEmbedder(), limit: 100 });
    assert(deleteResult.processed > 0 && await vectors.get(semanticVectorRecordId(beta.id, "fixture-semantic", "v1")) === null, "vector outbox delete removes derived canonical projection");

    const outboxNode = await acceptedNode(canonical, event.id, "future_type", "Outbox projected identity");
    const outboxResult = await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder: fixtureEmbedder(), limit: 100 });
    assert(outboxResult.processed > 0 && await vectors.get(semanticVectorRecordId(outboxNode.id, "fixture-semantic", "v1")) !== null, "vector outbox upsert projects canonical identity");
    const failureNode = await acceptedNode(canonical, event.id, "idea", "Canonical survives vector failure");
    const failure = await processVectorProjectionOutbox({ pool, canonical, vector: vectors, embedder: fixtureEmbedder(true), limit: 100 });
    assert(failure.failed > 0 && (await canonical.getNode(failureNode.id))?.status === "accepted", "canonical write remains valid when projection processing fails");
    const failedJob = await pool.query("SELECT last_error, processed_at FROM knowledge_projection_outbox WHERE canonical_id = $1 AND projection = 'vector' ORDER BY created_at DESC LIMIT 1", [failureNode.id]);
    assert(String(failedJob.rows[0]?.last_error).includes("fixture embedding failure") && failedJob.rows[0]?.processed_at == null, "failed projection remains retryable with error state");
    console.log("PostgreSQL pgvector semantic projection checks passed.");
  } finally { await vectors.close(); await pool.end(); await runtime.dispose(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });

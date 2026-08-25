import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { CanonicalKnowledgeRepository, SemanticVectorRecord, VectorRepository } from "./storage/contracts.js";
import type { KnowledgeNode } from "./types.js";
import { KNOWLEDGE_VECTOR_DIMENSION } from "./postgres/vectorRepository.js";

export interface SemanticEmbeddingProvider {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface VectorProjectionResult {
  projected: number;
  model: string;
  modelVersion: string;
}

export interface VectorOutboxResult {
  processed: number;
  failed: number;
}

export function canonicalSemanticText(node: KnowledgeNode): string {
  return [node.type, node.label, node.description].filter((value) => value?.trim()).join("\n");
}

function hash(text: string): string { return createHash("sha256").update(text).digest("hex"); }

export function semanticVectorRecordId(canonicalId: string, model: string, modelVersion: string): string {
  const hex = hash(`${canonicalId}\0${model}\0${modelVersion}`).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertProvider(provider: SemanticEmbeddingProvider): void {
  if (!provider.model.trim() || !provider.modelVersion.trim()) throw new Error("embedding provider model and modelVersion are required");
  if (provider.dimension !== KNOWLEDGE_VECTOR_DIMENSION) throw new Error(`embedding provider dimension ${provider.dimension} is incompatible; expected ${KNOWLEDGE_VECTOR_DIMENSION}`);
}

async function embeddingText(
  node: KnowledgeNode,
  canonical: CanonicalKnowledgeRepository
): Promise<{ text: string; sourceId?: string; chunkId?: string; contentHash?: string }> {
  if (node.type === "chunk") {
    const chunk = await canonical.getChunk(node.id);
    if (chunk?.text) {
      return {
        text: chunk.text,
        sourceId: chunk.asIsId,
        chunkId: chunk.id,
        contentHash: chunk.contentHash,
      };
    }
  }
  return { text: canonicalSemanticText(node), sourceId: node.type === "source" ? node.id : undefined };
}

async function embedNodes(
  nodes: readonly KnowledgeNode[],
  provider: SemanticEmbeddingProvider,
  canonical: CanonicalKnowledgeRepository
): Promise<SemanticVectorRecord[]> {
  assertProvider(provider);
  const resolved: Array<{ text: string; sourceId?: string; chunkId?: string; contentHash?: string }> = [];
  for (const node of nodes) resolved.push(await embeddingText(node, canonical));
  const texts = resolved.map((item) => item.text);
  const vectors = await provider.embed(texts);
  if (vectors.length !== nodes.length) throw new Error(`embedding provider returned ${vectors.length} vectors for ${nodes.length} inputs`);
  return nodes.map((node, index) => ({
    id: semanticVectorRecordId(node.id, provider.model, provider.modelVersion),
    canonicalId: node.id,
    sourceId: resolved[index]!.sourceId,
    chunkId: resolved[index]!.chunkId,
    workspaceId: node.workspaceId,
    entityType: node.type,
    model: provider.model,
    modelVersion: provider.modelVersion,
    dimension: provider.dimension,
    vector: vectors[index]!,
    contentHash: resolved[index]!.contentHash ?? hash(texts[index]!),
    metadata: {},
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }));
}

/** Rebuilds only from accepted canonical nodes; embedding happens before atomic replacement. */
export async function rebuildSemanticVectorProjection(input: {
  canonical: CanonicalKnowledgeRepository;
  vector: VectorRepository;
  embedder: SemanticEmbeddingProvider;
  pageSize?: number;
}): Promise<VectorProjectionResult> {
  const records: SemanticVectorRecord[] = [];
  for await (const page of input.canonical.scanAcceptedNodes({ pageSize: input.pageSize })) {
    records.push(...await embedNodes(page, input.embedder, input.canonical));
  }
  await input.vector.replaceProjection({ model: input.embedder.model, modelVersion: input.embedder.modelVersion, records });
  return { projected: records.length, model: input.embedder.model, modelVersion: input.embedder.modelVersion };
}

/** Processes only vector outbox rows. Graph projection remains a later workstream. */
export async function processVectorProjectionOutbox(input: {
  pool: Pool;
  canonical: CanonicalKnowledgeRepository;
  vector: VectorRepository;
  embedder: SemanticEmbeddingProvider;
  limit?: number;
}): Promise<VectorOutboxResult> {
  assertProvider(input.embedder);
  const client = await input.pool.connect();
  const lockId = 8_214_701_934;
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockId]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { processed: 0, failed: 0 };
    const pending = await client.query<{ id: string; canonical_id: string; operation: "upsert" | "delete" | "rebuild"; sequence_id: string }>(
      `SELECT * FROM (SELECT DISTINCT ON (canonical_id) id::text, canonical_id::text, operation, sequence_id, available_at
       FROM knowledge_projection_outbox WHERE projection = 'vector' AND processed_at IS NULL
       ORDER BY canonical_id, sequence_id DESC) latest
       WHERE available_at <= now() ORDER BY sequence_id ASC LIMIT $1`,
      [Math.min(Math.max(Math.floor(input.limit ?? 100), 1), 1000)]
    );
    let processed = 0; let failed = 0;
    for (const job of pending.rows) {
      try {
        if (job.operation === "delete") await input.vector.deleteByCanonicalId(job.canonical_id);
        else if (job.operation === "rebuild") await rebuildSemanticVectorProjection(input);
        else {
          const node = await input.canonical.getNode(job.canonical_id);
          if (!node || node.status !== "accepted") await input.vector.deleteByCanonicalId(job.canonical_id);
          else {
            const [item] = await embedNodes([node], input.embedder, input.canonical);
            await input.vector.upsert(item!);
          }
        }
        await client.query("UPDATE knowledge_projection_outbox SET processed_at = now(), last_error = NULL WHERE id = $1 AND processed_at IS NULL", [job.id]);
        await client.query("UPDATE knowledge_projection_outbox SET processed_at = now(), last_error = $4 WHERE projection = 'vector' AND canonical_id = $1 AND processed_at IS NULL AND sequence_id < $2 AND id <> $3", [job.canonical_id, job.sequence_id, job.id, `superseded by newer successful job ${job.id}`]);
        processed++;
      } catch (error) {
        await client.query(
          `UPDATE knowledge_projection_outbox SET attempt_count = attempt_count + 1,
           last_error = $2, available_at = now() + interval '1 minute' WHERE id = $1 AND processed_at IS NULL`,
          [job.id, error instanceof Error ? error.message : String(error)]
        );
        failed++;
      }
    }
    return { processed, failed };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
    client.release();
  }
}

/**
 * LLM-free retrieve over ingested chunks. Canonical-only by default:
 * unaccepted jobs cannot appear unless the caller opts out.
 */

import type { VectorRepository } from "./storage/contracts.js";
import type { KnowledgeChunk, KnowledgeStore, ListChunksFilter } from "./types.js";

export type ChunkRetrieveOrigin = "list" | "keyword" | "semantic";

export interface RetrieveChunksRequest {
  jobId?: string;
  chunkId?: string;
  asIsId?: string;
  pathPrefix?: string;
  query?: string;
  queryVector?: readonly number[];
  embeddingModel?: string;
  embeddingModelVersion?: string;
  workspaceId?: string | null;
  canonicalOnly?: boolean;
  limit?: number;
}

export interface ChunkRetrieveHit {
  chunk: KnowledgeChunk;
  origin: ChunkRetrieveOrigin;
  score?: number;
}

export interface RetrieveChunksResult {
  hits: ChunkRetrieveHit[];
  semantic: "ran" | "skipped" | "unavailable" | "degraded";
  detail?: string;
}

function scoped(request: RetrieveChunksRequest): boolean {
  return Boolean(
    request.jobId ||
    request.chunkId ||
    request.asIsId ||
    request.pathPrefix?.trim() ||
    request.query?.trim()
  );
}

function listFilter(request: RetrieveChunksRequest, extra?: Partial<ListChunksFilter>): ListChunksFilter {
  return {
    jobId: request.jobId,
    chunkId: request.chunkId,
    asIsId: request.asIsId,
    pathPrefix: request.pathPrefix,
    query: extra?.query ?? request.query,
    workspaceId: request.workspaceId,
    canonicalOnly: request.canonicalOnly,
    limit: extra?.limit ?? request.limit,
  };
}

export async function retrieveChunks(input: {
  store: KnowledgeStore;
  vector?: VectorRepository;
  request: RetrieveChunksRequest;
}): Promise<RetrieveChunksResult> {
  const limit = Math.min(Math.max(Math.floor(input.request.limit ?? 20), 1), 200);
  const hits = new Map<string, ChunkRetrieveHit>();
  const hasScope = scoped(input.request);
  const listed = hasScope || input.request.queryVector == null
    ? await input.store.listChunks(listFilter(input.request, { limit }))
    : [];
  for (const chunk of listed) {
    hits.set(chunk.id, {
      chunk,
      origin: input.request.query?.trim() ? "keyword" : "list",
    });
  }

  let semantic: RetrieveChunksResult["semantic"] = "skipped";
  let detail: string | undefined;
  if (input.request.queryVector != null) {
    if (!input.vector) {
      semantic = "unavailable";
      detail = "vector repository is not configured";
    } else if (!input.request.embeddingModel?.trim() || !input.request.embeddingModelVersion?.trim()) {
      semantic = "degraded";
      detail = "semantic retrieve requires embeddingModel and embeddingModelVersion";
    } else if (hasScope && listed.length === 0) {
      semantic = "skipped";
      detail = "required chunk scope is empty; refusing unscoped semantic widening";
    } else {
      try {
        const vectorHits = await input.vector.search(input.request.queryVector, {
          model: input.request.embeddingModel.trim(),
          modelVersion: input.request.embeddingModelVersion.trim(),
          limit,
          workspaceId: input.request.workspaceId,
          entityTypes: ["chunk"],
          chunkIds: hasScope ? listed.map((item) => item.id) : undefined,
        });
        for (const hit of vectorHits) {
          const chunkId = hit.record.chunkId ?? hit.record.canonicalId;
          const accepted = await input.store.listChunks({
            chunkId,
            canonicalOnly: input.request.canonicalOnly,
            workspaceId: input.request.workspaceId,
            limit: 1,
          });
          const chunk = accepted[0];
          if (!chunk) continue;
          const current = hits.get(chunk.id);
          if (!current || (hit.score ?? 0) >= (current.score ?? -Infinity)) {
            hits.set(chunk.id, { chunk, origin: "semantic", score: hit.score });
          }
        }
        semantic = "ran";
      } catch (error) {
        semantic = "degraded";
        detail = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const ranked = [...hits.values()].sort((a, b) => {
    const score = (b.score ?? -Infinity) - (a.score ?? -Infinity);
    if (score !== 0 && Number.isFinite(score)) return score;
    if (a.chunk.path !== b.chunk.path) return a.chunk.path.localeCompare(b.chunk.path);
    return a.chunk.ordinal - b.chunk.ordinal;
  });
  return { hits: ranked.slice(0, limit), semantic, detail };
}

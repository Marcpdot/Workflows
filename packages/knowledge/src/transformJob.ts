/**
 * Operator accept/reject for transform jobs.
 * Canonical commit and projection execution stay decoupled: graph/vector
 * failure cannot undo an accepted job.
 */

import type { Pool } from "pg";
import type {
  CanonicalKnowledgeRepository,
  GraphRepository,
  VectorRepository,
} from "./storage/contracts.js";
import {
  processGraphProjectionOutbox,
  type GraphOutboxResult,
} from "./graphProjection.js";
import {
  processVectorProjectionOutbox,
  type SemanticEmbeddingProvider,
  type VectorOutboxResult,
} from "./semanticProjection.js";
import type {
  AcceptTransformJobOptions,
  KnowledgeStore,
  TransformJob,
} from "./types.js";

export interface AcceptJobInput extends AcceptTransformJobOptions {
  store: KnowledgeStore;
  jobId: string;
  embedder?: SemanticEmbeddingProvider;
  vector?: VectorRepository;
  graph?: GraphRepository;
  pool?: Pool;
}

export interface AcceptJobResult {
  job: TransformJob;
  vector?: VectorOutboxResult;
  graph?: GraphOutboxResult;
}

export async function acceptJob(input: AcceptJobInput): Promise<AcceptJobResult> {
  if (input.embedder && (!input.vector || !input.pool)) {
    throw new Error("acceptJob: embedding provider requires vector repository and pool");
  }
  const job = await input.store.acceptTransformJob(input.jobId, {
    geometry: input.geometry,
    geometryProperties: input.geometryProperties,
  });
  const result: AcceptJobResult = { job };
  const canonical = input.store as CanonicalKnowledgeRepository;

  if (input.embedder && input.vector && input.pool) {
    try {
      result.vector = await processVectorProjectionOutbox({
        pool: input.pool,
        canonical,
        vector: input.vector,
        embedder: input.embedder,
      });
    } catch {
      // Canonical accept already committed. Outbox rows remain retryable.
    }
  }

  if (input.graph && input.pool) {
    try {
      result.graph = await processGraphProjectionOutbox({
        pool: input.pool,
        canonical,
        graph: input.graph,
      });
    } catch {
      // Graph projection stays reconstructable and non-canonical.
    }
  }

  return result;
}

export async function rejectJob(store: KnowledgeStore, jobId: string): Promise<TransformJob> {
  return store.rejectTransformJob(jobId);
}

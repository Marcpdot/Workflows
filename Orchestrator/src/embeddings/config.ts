/**
 * Env → embeddings stack. Default disabled so system works without embed models.
 */

import { resolve } from "node:path";
import { OllamaEmbedder } from "./ollamaEmbedder.js";
import { SqliteVectorStore } from "./store.js";
import type { Embedder, EmbeddingConfig, VectorStore } from "./types.js";

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function resolveVectorDbPath(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.VECTOR_DB_PATH?.trim()) {
    return resolve(cwd, env.VECTOR_DB_PATH.trim());
  }
  // Keep personal vectors with LTM dir when set
  if (env.PERSONAL_CONTEXT_DIR?.trim()) {
    return resolve(env.PERSONAL_CONTEXT_DIR.trim(), "vectors.db");
  }
  return resolve(cwd, "./data/vectors.db");
}

export function loadEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingConfig {
  return {
    enabled: envFlagTrue(env.EMBEDDINGS_ENABLED),
    model: env.EMBEDDING_MODEL?.trim() || "nomic-embed-text",
    ollamaBaseUrl:
      env.OLLAMA_BASE_URL?.trim() ||
      env.OLLAMA_HOST?.trim() ||
      "http://127.0.0.1:11434",
    vectorDbPath: resolveVectorDbPath(process.cwd(), env),
    minScore: (() => {
      const n = Number(env.EMBEDDINGS_MIN_SCORE ?? "0.3");
      return Number.isFinite(n) ? n : 0.3;
    })(),
    timeoutMs: (() => {
      const n = Number(env.EMBEDDING_TIMEOUT_MS ?? "60000");
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60_000;
    })(),
  };
}

export interface EmbeddingsRuntime {
  enabled: true;
  config: EmbeddingConfig;
  embedder: Embedder;
  store: VectorStore;
}

/**
 * Returns null when embeddings are disabled (keyword-only path).
 */
export function createEmbeddingsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingsRuntime | null {
  const config = loadEmbeddingConfig(env);
  if (!config.enabled) return null;

  const embedder = new OllamaEmbedder({
    model: config.model,
    baseUrl: config.ollamaBaseUrl,
    timeoutMs: config.timeoutMs,
  });
  const store = new SqliteVectorStore(config.vectorDbPath);
  return { enabled: true, config, embedder, store };
}

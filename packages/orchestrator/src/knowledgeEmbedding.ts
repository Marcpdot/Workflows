import { OllamaEmbedder } from "@workflows/embeddings";
import { KNOWLEDGE_VECTOR_DIMENSION, type SemanticEmbeddingProvider } from "@workflows/knowledge";

export interface KnowledgeEmbeddingConfig { provider: "ollama"; model: string; modelVersion: string; dimension: number; baseUrl?: string; }

export function resolveKnowledgeEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): KnowledgeEmbeddingConfig {
  const provider = env.KNOWLEDGE_EMBEDDING_PROVIDER?.trim().toLowerCase() || "ollama";
  if (provider !== "ollama") throw new Error(`Unsupported KNOWLEDGE_EMBEDDING_PROVIDER: ${provider}`);
  const model = env.KNOWLEDGE_EMBEDDING_MODEL?.trim() || "qwen3-embedding:0.6b";
  const dimension = Number(env.KNOWLEDGE_VECTOR_DIMENSION ?? KNOWLEDGE_VECTOR_DIMENSION);
  if (!Number.isInteger(dimension) || dimension <= 0) throw new Error("KNOWLEDGE_VECTOR_DIMENSION must be a positive integer");
  if (dimension !== KNOWLEDGE_VECTOR_DIMENSION) throw new Error(`KNOWLEDGE_VECTOR_DIMENSION ${dimension} does not match the configured pgvector schema dimension ${KNOWLEDGE_VECTOR_DIMENSION}`);
  return { provider, model, modelVersion: env.KNOWLEDGE_EMBEDDING_MODEL_VERSION?.trim() || model, dimension, baseUrl: env.OLLAMA_BASE_URL?.trim() || undefined };
}

export function createConfiguredKnowledgeEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): SemanticEmbeddingProvider {
  const config = resolveKnowledgeEmbeddingConfig(env); const client = new OllamaEmbedder({ model: config.model, baseUrl: config.baseUrl, dimensions: config.dimension });
  return { model: config.model, modelVersion: config.modelVersion, dimension: config.dimension, async embed(texts) { const vectors = await client.embed([...texts]); for (const vector of vectors) if (vector.length !== config.dimension) throw new Error(`Ollama embedding model ${config.model} returned dimension ${vector.length}; KNOWLEDGE_VECTOR_DIMENSION is ${config.dimension}`); return vectors; } };
}

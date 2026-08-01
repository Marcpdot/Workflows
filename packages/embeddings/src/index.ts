export type {
  Embedder,
  EmbeddingConfig,
  SemanticSearchDeps,
  VectorHit,
  VectorRecord,
  VectorSearchOptions,
  VectorStore,
} from "./types.js";
export { cosineSimilarity, vectorToBlob, blobToVector } from "./cosine.js";
export { MockEmbedder } from "./mockEmbedder.js";
export { OllamaEmbedder } from "./ollamaEmbedder.js";
export { SqliteVectorStore } from "./store.js";
export { semanticSearch } from "./search.js";
export { indexProjectContext } from "./indexContext.js";
export { createEmbeddingsFromEnv, resolveVectorDbPath } from "./config.js";

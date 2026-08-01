export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorRecord {
  id: string;
  source: "ltm" | "context" | "session" | string;
  /** fact id, file path, message id, … */
  refId: string;
  /** original snippet (for display) */
  text: string;
  vector: number[];
  createdAt: number;
}

export interface VectorHit {
  record: VectorRecord;
  /** higher = more similar (cosine) */
  score: number;
}

export interface VectorSearchOptions {
  limit?: number;
  source?: string;
  minScore?: number;
}

export interface VectorStore {
  upsert(
    record: Omit<VectorRecord, "createdAt"> & { createdAt?: number }
  ): Promise<void>;
  deleteByRef(source: string, refId: string): Promise<void>;
  search(
    queryVector: number[],
    options?: VectorSearchOptions
  ): Promise<VectorHit[]>;
  /** Approximate count of rows (optional source filter) */
  count(source?: string): number;
  close(): void;
}

export interface EmbeddingConfig {
  enabled: boolean;
  model: string;
  ollamaBaseUrl: string;
  vectorDbPath: string;
  minScore: number;
  timeoutMs: number;
}

export interface SemanticSearchDeps {
  embedder: Embedder;
  store: VectorStore;
}

/**
 * Long-term memory types. Optional embeddings use structural interfaces
 * (no dependency on packages/embeddings yet).
 */

export interface MemoryFact {
  id: string;
  key?: string;
  content: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  source?: string;
}

export interface RememberInput {
  content: string;
  key?: string;
  tags?: string[];
  source?: string;
}

export interface RecallQuery {
  key?: string;
  /** Keyword match on content */
  text?: string;
  tags?: string[];
  limit?: number;
}

export interface LongTermMemory {
  remember(input: RememberInput): Promise<MemoryFact>;
  recall(query: RecallQuery): Promise<MemoryFact[]>;
  list(limit?: number): Promise<MemoryFact[]>;
  forget(idOrKey: string): Promise<boolean>;
  close(): void;
}

/** Minimal embedder surface used by optional LTM semantic path. */
export interface MemoryEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** Minimal vector store surface used by optional LTM semantic path. */
export interface MemoryVectorStore {
  upsert(record: {
    id: string;
    source: string;
    refId: string;
    text: string;
    vector: number[];
    createdAt?: number;
  }): Promise<void>;
  deleteByRef(source: string, refId: string): Promise<void>;
  search(
    queryVector: number[],
    options?: { limit?: number; source?: string; minScore?: number }
  ): Promise<
    Array<{
      record: { refId: string };
      score: number;
    }>
  >;
}

export interface LongTermMemoryConfig {
  /** Path to SQLite file (created if missing). Parent dirs created. */
  dbPath: string;
  /**
   * Optional M4 semantic layer. When set, remember/forget/recall(text)
   * also use vector search. Keyword path always remains.
   */
  embeddings?: {
    embedder: MemoryEmbedder;
    store: MemoryVectorStore;
    minScore?: number;
  };
}

export interface LongTermSettings {
  dbPath: string;
  /** When true, top recall hits may be injected into handle() system prompt */
  autoInject: boolean;
  injectMaxChars: number;
  injectLimit: number;
}

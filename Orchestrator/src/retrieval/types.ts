import type { ChatMessage } from "../types.js";
import type { Embedder, VectorStore } from "../embeddings/types.js";

export type RetrievalSource = "session" | "project_context";

export interface RetrievedChunk {
  source: RetrievalSource;
  /** e.g. message index or relative path */
  id: string;
  /** Already truncated snippet */
  text: string;
  /** Higher = more relevant */
  score: number;
}

export interface RetrieveOptions {
  /** Max chunks to return. Default 4 */
  limit?: number;
  /** Max total characters across all chunks. Default 2000 */
  maxChars?: number;
  /** Enable session keyword search. Default true */
  session?: boolean;
  /** Enable context/ file search. Default true */
  projectContext?: boolean;
  /** Absolute or cwd-relative path to context dir */
  contextDir?: string;
  /** Full session history to search (caller provides from memory) */
  sessionMessages?: ChatMessage[];
  /** Max chars per individual chunk snippet. Default 600 */
  maxChunkChars?: number;
  /**
   * M4: optional semantic search over indexed context vectors.
   * When set, merges with keyword hits (or fills when keyword empty).
   */
  embeddings?: {
    embedder: Embedder;
    store: VectorStore;
    minScore?: number;
  };
}

export interface RetrievalSettings {
  limit: number;
  maxChars: number;
  maxChunkChars: number;
  contextDir: string;
  disabled?: boolean;
}

export const DEFAULT_RETRIEVE_OPTIONS = {
  limit: 4,
  maxChars: 2000,
  maxChunkChars: 600,
  session: true,
  projectContext: true,
} as const;

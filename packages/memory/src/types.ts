/**
 * Short-term memory types (package-local; compatible with Orchestrator ChatMessage).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface MemoryConfig {
  /** Path to the SQLite database file. Parent dirs are created if missing. */
  dbPath: string;
  /** Default max messages returned by getHistory. Default: 50 */
  defaultLimit?: number;
}

export interface Memory {
  /** Append a message to a session. */
  add(sessionId: string, message: ChatMessage): Promise<void>;

  /**
   * Load history for a session (oldest first).
   * @param limit max number of messages (default from config / 50)
   */
  getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]>;

  /** Delete all messages for a session. */
  clear(sessionId: string): Promise<void>;

  /**
   * Distinct session ids present in the store (Milestone 9).
   * @param prefix when set, only ids that start with this prefix (workspace namespace)
   */
  listSessions(prefix?: string): Promise<string[]>;

  /** Close the database connection. */
  close(): void;
}

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: ChatMessage["role"];
  content: string;
  createdAt: number;
}

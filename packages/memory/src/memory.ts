/**
 * High-level memory API used by the orchestrator / CLI.
 */

import { MessageStore } from "./store.js";
import type {
  ChatMessage,
  Memory,
  MemoryConfig,
  SessionState,
} from "./types.js";

class SqliteMemory implements Memory {
  private readonly store: MessageStore;
  private readonly defaultLimit: number;

  constructor(config: MemoryConfig) {
    if (!config.dbPath?.trim()) {
      throw new Error("MemoryConfig.dbPath is required");
    }
    this.store = new MessageStore(config.dbPath);
    this.defaultLimit = config.defaultLimit ?? 50;
  }

  async add(sessionId: string, message: ChatMessage): Promise<void> {
    this.store.insert(sessionId, message);
  }

  async getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    const rows = this.store.listBySession(
      sessionId,
      limit ?? this.defaultLimit
    );
    return rows.map((r) => ({
      role: r.role,
      content: r.content,
    }));
  }

  async clear(sessionId: string): Promise<void> {
    this.store.deleteBySession(sessionId);
  }

  async listSessions(prefix?: string): Promise<string[]> {
    return this.store.listSessionIds(prefix);
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    return this.store.getSessionState(sessionId);
  }

  async updateSessionState(
    sessionId: string,
    patch: Partial<
      Pick<
        SessionState,
        | "interactionMode"
        | "proposalsEnabled"
        | "lastExtractTurnId"
        | "maxProposalsPerTurn"
        | "minUserMessageLength"
      >
    >
  ): Promise<SessionState> {
    const current = this.store.getSessionState(sessionId);
    const next: SessionState = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: Date.now(),
    };
    this.store.upsertSessionState(next);
    return next;
  }

  close(): void {
    this.store.close();
  }
}

/** Create a SQLite-backed Memory instance. */
export function createMemory(config: MemoryConfig): Memory {
  return new SqliteMemory(config);
}

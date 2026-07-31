/**
 * High-level memory API used by the orchestrator / CLI.
 */

import type { ChatMessage } from "../types.js";
import { MessageStore } from "./store.js";
import type { Memory, MemoryConfig } from "./types.js";

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

  close(): void {
    this.store.close();
  }
}

/** Create a SQLite-backed Memory instance. */
export function createMemory(config: MemoryConfig): Memory {
  return new SqliteMemory(config);
}

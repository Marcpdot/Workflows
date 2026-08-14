/**
 * High-level memory API used by the orchestrator / CLI.
 */

import { MessageStore } from "./store.js";
import type {
  ChatMessage,
  ExperienceQuery,
  ExperienceRecord,
  Memory,
  MemoryConfig,
  RecordExperienceInput,
  SessionState,
  StoredMessage,
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

  async addMessage(
    sessionId: string,
    message: ChatMessage,
    context?: {
      workspaceId?: string;
      source?: { type: string; ref?: string };
      parentExperienceIds?: string[];
      metadata?: Record<string, unknown>;
      createdAt?: number;
    }
  ): Promise<ExperienceRecord> {
    return this.store.insert(sessionId, message, context);
  }

  async recordExperience(
    input: RecordExperienceInput
  ): Promise<ExperienceRecord> {
    const role =
      input.kind === "user_message"
        ? "user"
        : input.kind === "assistant_output"
          ? "assistant"
          : input.kind === "system_message"
            ? "system"
            : undefined;
    if (
      role &&
      input.sessionId &&
      input.content != null &&
      input.metadata?.historyMessage !== false
    ) {
      return this.store.insert(
        input.sessionId,
        { role, content: input.content },
        {
          workspaceId: input.workspaceId,
          source: input.source,
          parentExperienceIds: input.parentExperienceIds,
          metadata: input.metadata,
          createdAt: input.createdAt,
        }
      );
    }
    return this.store.insertExperience(input);
  }

  async getExperience(id: string): Promise<ExperienceRecord | null> {
    return this.store.getExperience(id);
  }

  async listExperiences(
    query?: ExperienceQuery
  ): Promise<ExperienceRecord[]> {
    return this.store.listExperiences(query);
  }

  async getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    const rows = await this.getHistoryRecords(sessionId, limit);
    return rows.map((r) => ({
      role: r.role,
      content: r.content,
    }));
  }

  async getHistoryRecords(
    sessionId: string,
    limit?: number
  ): Promise<StoredMessage[]> {
    return this.store.listBySession(sessionId, limit ?? this.defaultLimit);
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

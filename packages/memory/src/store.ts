/**
 * Low-level SQLite persistence for conversation messages.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ChatMessage,
  ExperienceKind,
  ExperienceQuery,
  ExperienceRecord,
  InteractionMode,
  RecordExperienceInput,
  SessionState,
  StoredMessage,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS experiences (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  session_id TEXT,
  workspace_id TEXT,
  content TEXT,
  payload_ref TEXT,
  source_type TEXT,
  source_ref TEXT,
  parent_experience_ids TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiences_session
  ON experiences(session_id, created_at, sequence);
CREATE INDEX IF NOT EXISTS idx_experiences_workspace
  ON experiences(workspace_id, created_at, sequence);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  experience_id TEXT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY,
  interaction_mode TEXT NOT NULL DEFAULT 'active',
  proposals_enabled INTEGER NOT NULL DEFAULT 1,
  last_extract_turn_id TEXT,
  max_proposals_per_turn INTEGER NOT NULL DEFAULT 8,
  min_user_message_length INTEGER NOT NULL DEFAULT 40,
  updated_at INTEGER NOT NULL
);
`;

function roleToExperienceKind(role: ChatMessage["role"]): ExperienceKind {
  if (role === "user") return "user_message";
  if (role === "assistant") return "assistant_output";
  return "system_message";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonStrings(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function experienceFromRow(row: Record<string, unknown>): ExperienceRecord {
  const sourceType =
    row.sourceType == null ? undefined : String(row.sourceType);
  const sourceRef = row.sourceRef == null ? undefined : String(row.sourceRef);
  return {
    id: String(row.id),
    kind: row.kind as ExperienceKind,
    createdAt: Number(row.createdAt),
    sessionId: row.sessionId == null ? undefined : String(row.sessionId),
    workspaceId: row.workspaceId == null ? undefined : String(row.workspaceId),
    content: row.content == null ? undefined : String(row.content),
    payloadRef: row.payloadRef == null ? undefined : String(row.payloadRef),
    source:
      sourceType == null
        ? undefined
        : { type: sourceType, ...(sourceRef == null ? {} : { ref: sourceRef }) },
    parentExperienceIds: parseJsonStrings(row.parentExperienceIds),
    metadata: parseJsonObject(row.metadata),
  };
}

const EXPERIENCE_SELECT = `
  SELECT sequence, id, kind, session_id AS sessionId, workspace_id AS workspaceId,
         content, payload_ref AS payloadRef, source_type AS sourceType,
         source_ref AS sourceRef,
         parent_experience_ids AS parentExperienceIds,
         metadata, created_at AS createdAt
  FROM experiences`;

export class MessageStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    try {
      const dir = dirname(dbPath);
      if (dir && dir !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(SCHEMA);
      this.ensureExperienceCompatibility();
    } catch (err) {
      throw new Error(
        `Failed to open memory database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  private ensureExperienceCompatibility(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "experience_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN experience_id TEXT");
    }

    const migrate = this.db.transaction(() => {
      const legacy = this.db
        .prepare(
          `SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
           FROM messages
           WHERE experience_id IS NULL
           ORDER BY id ASC`
        )
        .all() as Array<{
        id: number;
        sessionId: string;
        role: ChatMessage["role"];
        content: string;
        createdAt: number;
      }>;

      const insertExperience = this.db.prepare(
        `INSERT INTO experiences (
           id, kind, session_id, content, source_type, source_ref,
           parent_experience_ids, metadata, created_at
         ) VALUES (?, ?, ?, ?, 'session-memory', ?, '[]', ?, ?)`
      );
      const linkMessage = this.db.prepare(
        "UPDATE messages SET experience_id = ? WHERE id = ?"
      );

      for (const row of legacy) {
        const experienceId = randomUUID();
        insertExperience.run(
          experienceId,
          roleToExperienceKind(row.role),
          row.sessionId,
          row.content,
          `legacy-message:${row.id}`,
          JSON.stringify({ migratedFromMessageId: row.id }),
          row.createdAt
        );
        linkMessage.run(experienceId, row.id);
      }
    });
    migrate();

    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_experience
       ON messages(experience_id)
       WHERE experience_id IS NOT NULL`
    );
  }

  insert(
    sessionId: string,
    message: ChatMessage,
    context?: {
      experienceKind?: ExperienceKind;
      workspaceId?: string;
      source?: { type: string; ref?: string };
      parentExperienceIds?: string[];
      metadata?: Record<string, unknown>;
      createdAt?: number;
    }
  ): ExperienceRecord {
    if (!sessionId.trim()) {
      throw new Error("sessionId must be a non-empty string");
    }
    if (!message.role || !["system", "user", "assistant"].includes(message.role)) {
      throw new Error(
        `Invalid message role: ${String(message.role)}. Expected system|user|assistant`
      );
    }
    if (typeof message.content !== "string") {
      throw new Error("message.content must be a string");
    }

    try {
      const insertMessage = this.db.transaction(() => {
        const experience = this.insertExperience({
          kind: context?.experienceKind ?? roleToExperienceKind(message.role),
          sessionId,
          workspaceId: context?.workspaceId,
          content: message.content,
          source: context?.source ?? { type: "chat" },
          parentExperienceIds: context?.parentExperienceIds,
          metadata: {
            ...(context?.metadata ?? {}),
            role: message.role,
          },
          createdAt: context?.createdAt,
        });
        this.db
          .prepare(
            `INSERT INTO messages (
               experience_id, session_id, role, content, created_at
             ) VALUES (@experienceId, @sessionId, @role, @content, @createdAt)`
          )
          .run({
            experienceId: experience.id,
            sessionId,
            role: message.role,
            content: message.content,
            createdAt: experience.createdAt,
          });
        return experience;
      });
      return insertMessage();
    } catch (err) {
      throw new Error(
        `Failed to insert message for session "${sessionId}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  insertExperience(input: RecordExperienceInput): ExperienceRecord {
    if (!input.kind?.trim()) {
      throw new Error("experience.kind must be a non-empty string");
    }
    if (input.content == null && !input.payloadRef?.trim()) {
      throw new Error("experience requires content or payloadRef");
    }
    if (input.content != null && typeof input.content !== "string") {
      throw new Error("experience.content must be a string when provided");
    }
    if (input.sessionId != null && !input.sessionId.trim()) {
      throw new Error("experience.sessionId must be non-empty when provided");
    }
    if (input.workspaceId != null && !input.workspaceId.trim()) {
      throw new Error("experience.workspaceId must be non-empty when provided");
    }
    if (input.source != null && !input.source.type?.trim()) {
      throw new Error("experience.source.type must be non-empty when provided");
    }

    const id = randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const parentExperienceIds = [...new Set(input.parentExperienceIds ?? [])];
    const metadata = input.metadata ?? {};
    this.db
      .prepare(
        `INSERT INTO experiences (
           id, kind, session_id, workspace_id, content, payload_ref,
           source_type, source_ref, parent_experience_ids, metadata, created_at
         ) VALUES (
           @id, @kind, @sessionId, @workspaceId, @content, @payloadRef,
           @sourceType, @sourceRef, @parentExperienceIds, @metadata, @createdAt
         )`
      )
      .run({
        id,
        kind: input.kind,
        sessionId: input.sessionId ?? null,
        workspaceId: input.workspaceId ?? null,
        content: input.content ?? null,
        payloadRef: input.payloadRef?.trim() || null,
        sourceType: input.source?.type.trim() ?? null,
        sourceRef: input.source?.ref?.trim() || null,
        parentExperienceIds: JSON.stringify(parentExperienceIds),
        metadata: JSON.stringify(metadata),
        createdAt,
      });
    return {
      id,
      kind: input.kind,
      createdAt,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      content: input.content,
      payloadRef: input.payloadRef?.trim() || undefined,
      source: input.source
        ? {
            type: input.source.type.trim(),
            ...(input.source.ref?.trim()
              ? { ref: input.source.ref.trim() }
              : {}),
          }
        : undefined,
      parentExperienceIds,
      metadata,
    };
  }

  getExperience(id: string): ExperienceRecord | null {
    if (!id.trim()) throw new Error("experience id must be non-empty");
    const row = this.db
      .prepare(`${EXPERIENCE_SELECT} WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? experienceFromRow(row) : null;
  }

  listExperiences(query: ExperienceQuery = {}): ExperienceRecord[] {
    const limit = query.limit ?? 50;
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`limit must be a positive number, got ${limit}`);
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.sessionId != null) {
      if (!query.sessionId.trim()) {
        throw new Error("experience sessionId must be non-empty when provided");
      }
      params.push(query.sessionId);
      clauses.push(`session_id = ?`);
    }
    if (query.workspaceId != null) {
      if (!query.workspaceId.trim()) {
        throw new Error("experience workspaceId must be non-empty when provided");
      }
      params.push(query.workspaceId);
      clauses.push(`workspace_id = ?`);
    }
    if (query.kinds?.length) {
      clauses.push(`kind IN (${query.kinds.map(() => "?").join(", ")})`);
      params.push(...query.kinds);
    }
    params.push(Math.floor(limit));

    const rows = this.db
      .prepare(
        `SELECT * FROM (
           ${EXPERIENCE_SELECT}
           ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
           ORDER BY created_at DESC, sequence DESC
           LIMIT ?
         ) ORDER BY createdAt ASC, sequence ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map(experienceFromRow);
  }

  /**
   * Latest `limit` messages for the session, returned oldest-first.
   */
  listBySession(sessionId: string, limit: number): StoredMessage[] {
    if (!sessionId.trim()) {
      throw new Error("sessionId must be a non-empty string");
    }
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error(`limit must be a positive number, got ${limit}`);
    }

    try {
      // Fetch newest N, then reverse so callers get chronological order.
      const rows = this.db
        .prepare(
          `SELECT id, experience_id AS experienceId,
                  session_id AS sessionId, role, content, created_at AS createdAt
           FROM messages
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(sessionId, limit) as Array<{
        id: number;
        experienceId: string;
        sessionId: string;
        role: ChatMessage["role"];
        content: string;
        createdAt: number;
      }>;

      return rows.reverse();
    } catch (err) {
      throw new Error(
        `Failed to load history for session "${sessionId}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  deleteBySession(sessionId: string): void {
    if (!sessionId.trim()) {
      throw new Error("sessionId must be a non-empty string");
    }
    try {
      const removeSession = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
        this.db.prepare(`DELETE FROM experiences WHERE session_id = ?`).run(sessionId);
      });
      removeSession();
    } catch (err) {
      throw new Error(
        `Failed to clear session "${sessionId}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Distinct session ids, optionally filtered by prefix (e.g. `ws:<id>:`).
   */
  listSessionIds(prefix?: string): string[] {
    try {
      if (prefix != null && prefix !== "") {
        const rows = this.db
          .prepare(
            `SELECT session_id AS sessionId FROM messages WHERE session_id LIKE ?
             UNION
             SELECT session_id AS sessionId FROM experiences
             WHERE session_id LIKE ?
             ORDER BY session_id ASC`
          )
          .all(`${prefix}%`, `${prefix}%`) as Array<{ sessionId: string }>;
        return rows.map((r) => r.sessionId);
      }
      const rows = this.db
        .prepare(
          `SELECT session_id AS sessionId FROM messages
           UNION
           SELECT session_id AS sessionId FROM experiences
           WHERE session_id IS NOT NULL
           ORDER BY session_id ASC`
        )
        .all() as Array<{ sessionId: string }>;
      return rows.map((r) => r.sessionId);
    } catch (err) {
      throw new Error(
        `Failed to list sessions: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  defaultSessionState(sessionId: string): SessionState {
    return {
      sessionId,
      interactionMode: "active",
      proposalsEnabled: true,
      maxProposalsPerTurn: 8,
      minUserMessageLength: 40,
      updatedAt: Date.now(),
    };
  }

  getSessionState(sessionId: string): SessionState {
    if (!sessionId.trim()) {
      throw new Error("sessionId must be a non-empty string");
    }
    const row = this.db
      .prepare(
        `SELECT session_id AS sessionId,
                interaction_mode AS interactionMode,
                proposals_enabled AS proposalsEnabled,
                last_extract_turn_id AS lastExtractTurnId,
                max_proposals_per_turn AS maxProposalsPerTurn,
                min_user_message_length AS minUserMessageLength,
                updated_at AS updatedAt
         FROM session_state WHERE session_id = ?`
      )
      .get(sessionId) as
      | {
          sessionId: string;
          interactionMode: string;
          proposalsEnabled: number;
          lastExtractTurnId: string | null;
          maxProposalsPerTurn: number;
          minUserMessageLength: number;
          updatedAt: number;
        }
      | undefined;
    if (!row) {
      return this.defaultSessionState(sessionId);
    }
    const mode: InteractionMode =
      row.interactionMode === "neutral" ? "neutral" : "active";
    return {
      sessionId: row.sessionId,
      interactionMode: mode,
      proposalsEnabled: row.proposalsEnabled !== 0,
      lastExtractTurnId: row.lastExtractTurnId ?? undefined,
      maxProposalsPerTurn: row.maxProposalsPerTurn,
      minUserMessageLength: row.minUserMessageLength,
      updatedAt: row.updatedAt,
    };
  }

  upsertSessionState(state: SessionState): void {
    this.db
      .prepare(
        `INSERT INTO session_state (
           session_id, interaction_mode, proposals_enabled, last_extract_turn_id,
           max_proposals_per_turn, min_user_message_length, updated_at
         ) VALUES (
           @sessionId, @interactionMode, @proposalsEnabled, @lastExtractTurnId,
           @maxProposalsPerTurn, @minUserMessageLength, @updatedAt
         )
         ON CONFLICT(session_id) DO UPDATE SET
           interaction_mode = excluded.interaction_mode,
           proposals_enabled = excluded.proposals_enabled,
           last_extract_turn_id = excluded.last_extract_turn_id,
           max_proposals_per_turn = excluded.max_proposals_per_turn,
           min_user_message_length = excluded.min_user_message_length,
           updated_at = excluded.updated_at`
      )
      .run({
        sessionId: state.sessionId,
        interactionMode: state.interactionMode,
        proposalsEnabled: state.proposalsEnabled ? 1 : 0,
        lastExtractTurnId: state.lastExtractTurnId ?? null,
        maxProposalsPerTurn: state.maxProposalsPerTurn,
        minUserMessageLength: state.minUserMessageLength,
        updatedAt: state.updatedAt,
      });
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      throw new Error(
        `Failed to close memory database: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

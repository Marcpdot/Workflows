/**
 * Low-level SQLite persistence for conversation messages.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ChatMessage, StoredMessage } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`;

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
    } catch (err) {
      throw new Error(
        `Failed to open memory database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  insert(sessionId: string, message: ChatMessage): void {
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
      this.db
        .prepare(
          `INSERT INTO messages (session_id, role, content, created_at)
           VALUES (@sessionId, @role, @content, @createdAt)`
        )
        .run({
          sessionId,
          role: message.role,
          content: message.content,
          createdAt: Date.now(),
        });
    } catch (err) {
      throw new Error(
        `Failed to insert message for session "${sessionId}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
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
          `SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
           FROM messages
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(sessionId, limit) as Array<{
        id: number;
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
      this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
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
            `SELECT DISTINCT session_id AS sessionId
             FROM messages
             WHERE session_id LIKE ?
             ORDER BY session_id ASC`
          )
          .all(`${prefix}%`) as Array<{ sessionId: string }>;
        return rows.map((r) => r.sessionId);
      }
      const rows = this.db
        .prepare(
          `SELECT DISTINCT session_id AS sessionId
           FROM messages
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

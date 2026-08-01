/**
 * SQLite persistence for long-term facts (Milestone 3A).
 * Keyword/key only — no embeddings.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryFact } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
CREATE INDEX IF NOT EXISTS idx_facts_updated ON facts(updated_at);
`;

interface FactRow {
  id: string;
  key: string | null;
  content: string;
  tags: string | null;
  source: string | null;
  created_at: number;
  updated_at: number;
}

function rowToFact(row: FactRow): MemoryFact {
  let tags: string[] | undefined;
  if (row.tags) {
    try {
      const parsed = JSON.parse(row.tags) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      tags = undefined;
    }
  }
  return {
    id: row.id,
    key: row.key ?? undefined,
    content: row.content,
    tags: tags && tags.length > 0 ? tags : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source ?? undefined,
  };
}

export class FactStore {
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
        `Failed to open long-term memory database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  getById(id: string): MemoryFact | undefined {
    const row = this.db
      .prepare(
        `SELECT id, key, content, tags, source, created_at, updated_at
         FROM facts WHERE id = ?`
      )
      .get(id) as FactRow | undefined;
    return row ? rowToFact(row) : undefined;
  }

  getByKey(key: string): MemoryFact | undefined {
    const row = this.db
      .prepare(
        `SELECT id, key, content, tags, source, created_at, updated_at
         FROM facts WHERE key = ?`
      )
      .get(key) as FactRow | undefined;
    return row ? rowToFact(row) : undefined;
  }

  insert(fact: MemoryFact): void {
    try {
      this.db
        .prepare(
          `INSERT INTO facts (id, key, content, tags, source, created_at, updated_at)
           VALUES (@id, @key, @content, @tags, @source, @createdAt, @updatedAt)`
        )
        .run({
          id: fact.id,
          key: fact.key ?? null,
          content: fact.content,
          tags: fact.tags ? JSON.stringify(fact.tags) : null,
          source: fact.source ?? null,
          createdAt: fact.createdAt,
          updatedAt: fact.updatedAt,
        });
    } catch (err) {
      throw new Error(
        `Failed to insert fact: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  updateByKey(
    key: string,
    content: string,
    tags: string[] | undefined,
    source: string | undefined,
    updatedAt: number
  ): MemoryFact {
    try {
      this.db
        .prepare(
          `UPDATE facts
           SET content = @content,
               tags = @tags,
               source = COALESCE(@source, source),
               updated_at = @updatedAt
           WHERE key = @key`
        )
        .run({
          key,
          content,
          tags: tags ? JSON.stringify(tags) : null,
          source: source ?? null,
          updatedAt,
        });
      const fact = this.getByKey(key);
      if (!fact) {
        throw new Error(`Fact with key "${key}" not found after update`);
      }
      return fact;
    } catch (err) {
      throw new Error(
        `Failed to update fact key="${key}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  list(limit: number): MemoryFact[] {
    const rows = this.db
      .prepare(
        `SELECT id, key, content, tags, source, created_at, updated_at
         FROM facts
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`
      )
      .all(limit) as FactRow[];
    return rows.map(rowToFact);
  }

  /**
   * Keyword search: each token must appear in content (case-insensitive LIKE).
   * Optional key exact match short-circuit done by caller.
   */
  searchByText(text: string, limit: number): MemoryFact[] {
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9æøåäöü_./:-]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    // Always include full trimmed query as a phrase candidate.
    const phrases = new Set<string>();
    const full = text.trim().toLowerCase();
    if (full.length >= 2) phrases.add(full);
    for (const t of tokens) phrases.add(t);

    if (phrases.size === 0) return [];

    // AND-match: every phrase must be found (simple 3A approach).
    const clauses: string[] = [];
    const params: string[] = [];
    for (const p of phrases) {
      clauses.push(`LOWER(content) LIKE ?`);
      params.push(`%${p.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
    }

    try {
      const rows = this.db
        .prepare(
          `SELECT id, key, content, tags, source, created_at, updated_at
           FROM facts
           WHERE ${clauses.join(" AND ")}
           ORDER BY updated_at DESC
           LIMIT ?`
        )
        .all(...params, limit) as FactRow[];
      return rows.map(rowToFact);
    } catch (err) {
      throw new Error(
        `Failed keyword recall: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  deleteById(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM facts WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  deleteByKey(key: string): boolean {
    const r = this.db.prepare(`DELETE FROM facts WHERE key = ?`).run(key);
    return r.changes > 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch (err) {
      throw new Error(
        `Failed to close long-term memory database: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

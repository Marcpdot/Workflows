/**
 * SQLite vector store — linear scan (intentional M4 choice; no ANN index).
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { blobToVector, cosineSimilarity, vectorToBlob } from "./cosine.js";
import type {
  VectorHit,
  VectorRecord,
  VectorSearchOptions,
  VectorStore,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vectors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  text TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source);
`;

interface VectorRow {
  id: string;
  source: string;
  ref_id: string;
  text: string;
  dim: number;
  vector: Buffer;
  created_at: number;
}

export class SqliteVectorStore implements VectorStore {
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
        `Failed to open vector database at "${dbPath}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async upsert(
    record: Omit<VectorRecord, "createdAt"> & { createdAt?: number }
  ): Promise<void> {
    if (!record.vector?.length) {
      throw new Error("upsert: vector must be non-empty");
    }
    const id = record.id?.trim() || randomUUID();
    const createdAt = record.createdAt ?? Date.now();
    const blob = vectorToBlob(record.vector);

    this.db
      .prepare(
        `INSERT INTO vectors (id, source, ref_id, text, dim, vector, created_at)
         VALUES (@id, @source, @refId, @text, @dim, @vector, @createdAt)
         ON CONFLICT(source, ref_id) DO UPDATE SET
           id = excluded.id,
           text = excluded.text,
           dim = excluded.dim,
           vector = excluded.vector,
           created_at = excluded.created_at`
      )
      .run({
        id,
        source: record.source,
        refId: record.refId,
        text: record.text,
        dim: record.vector.length,
        vector: blob,
        createdAt,
      });
  }

  async deleteByRef(source: string, refId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM vectors WHERE source = ? AND ref_id = ?`)
      .run(source, refId);
  }

  async search(
    queryVector: number[],
    options?: VectorSearchOptions
  ): Promise<VectorHit[]> {
    if (!queryVector.length) return [];

    const limit = options?.limit ?? 8;
    const minScore = options?.minScore ?? 0;
    const source = options?.source;

    const rows = (
      source
        ? (this.db
            .prepare(
              `SELECT id, source, ref_id, text, dim, vector, created_at
               FROM vectors WHERE source = ?`
            )
            .all(source) as VectorRow[])
        : (this.db
            .prepare(
              `SELECT id, source, ref_id, text, dim, vector, created_at
               FROM vectors`
            )
            .all() as VectorRow[])
    );

    const hits: VectorHit[] = [];
    for (const row of rows) {
      if (row.dim !== queryVector.length) continue;
      let vector: number[];
      try {
        vector = blobToVector(row.vector, row.dim);
      } catch {
        continue;
      }
      const score = cosineSimilarity(queryVector, vector);
      if (score < minScore) continue;
      hits.push({
        score,
        record: {
          id: row.id,
          source: row.source,
          refId: row.ref_id,
          text: row.text,
          vector,
          createdAt: row.created_at,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(0, limit));
  }

  count(source?: string): number {
    if (source) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM vectors WHERE source = ?`)
        .get(source) as { n: number };
      return row.n;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM vectors`)
      .get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

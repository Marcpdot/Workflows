/**
 * Long-term memory API (Milestone 3A) — facts/preferences by key + keywords.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { FactStore } from "./store.js";
import type {
  LongTermMemory,
  LongTermMemoryConfig,
  MemoryFact,
  RecallQuery,
  RememberInput,
} from "./types.js";

function filterByTags(facts: MemoryFact[], tags?: string[]): MemoryFact[] {
  if (!tags || tags.length === 0) return facts;
  const need = new Set(tags.map((t) => t.toLowerCase()));
  return facts.filter((f) => {
    const have = (f.tags ?? []).map((t) => t.toLowerCase());
    return [...need].every((t) => have.includes(t));
  });
}

class SqliteLongTermMemory implements LongTermMemory {
  private readonly store: FactStore;

  constructor(config: LongTermMemoryConfig) {
    if (!config.dbPath?.trim()) {
      throw new Error("LongTermMemoryConfig.dbPath is required");
    }
    this.store = new FactStore(config.dbPath);
  }

  async remember(input: RememberInput): Promise<MemoryFact> {
    if (typeof input.content !== "string" || !input.content.trim()) {
      throw new Error("remember: content must be a non-empty string");
    }

    const now = Date.now();
    const key = input.key?.trim() || undefined;
    const tags = input.tags?.filter((t) => typeof t === "string" && t.trim());
    const source = input.source?.trim() || "user";

    if (key) {
      const existing = this.store.getByKey(key);
      if (existing) {
        return this.store.updateByKey(
          key,
          input.content,
          tags,
          source,
          now
        );
      }
    }

    const fact: MemoryFact = {
      id: randomUUID(),
      key,
      content: input.content,
      tags: tags && tags.length > 0 ? tags : undefined,
      createdAt: now,
      updatedAt: now,
      source,
    };
    this.store.insert(fact);
    return fact;
  }

  async recall(query: RecallQuery): Promise<MemoryFact[]> {
    const limit =
      query.limit && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : 20;

    if (query.key?.trim()) {
      const fact = this.store.getByKey(query.key.trim());
      if (!fact) return [];
      return filterByTags([fact], query.tags);
    }

    if (query.text?.trim()) {
      const hits = this.store.searchByText(query.text.trim(), limit * 2);
      return filterByTags(hits, query.tags).slice(0, limit);
    }

    // No key/text: list recent, optional tag filter
    const all = this.store.list(limit * 3);
    return filterByTags(all, query.tags).slice(0, limit);
  }

  async list(limit = 50): Promise<MemoryFact[]> {
    const n =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    return this.store.list(n);
  }

  async forget(idOrKey: string): Promise<boolean> {
    if (!idOrKey?.trim()) {
      throw new Error("forget: idOrKey is required");
    }
    const q = idOrKey.trim();
    if (this.store.deleteById(q)) return true;
    return this.store.deleteByKey(q);
  }

  close(): void {
    this.store.close();
  }
}

/** Create a SQLite-backed LongTermMemory instance. */
export function createLongTermMemory(
  config: LongTermMemoryConfig
): LongTermMemory {
  return new SqliteLongTermMemory(config);
}

/**
 * Resolve DB path from env:
 * 1. LONGTERM_DB_PATH
 * 2. PERSONAL_CONTEXT_DIR/longterm.db
 * 3. ./data/longterm.db
 */
export function resolveLongTermDbPath(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  if (env.LONGTERM_DB_PATH?.trim()) {
    return resolve(cwd, env.LONGTERM_DB_PATH.trim());
  }
  if (env.PERSONAL_CONTEXT_DIR?.trim()) {
    return resolve(env.PERSONAL_CONTEXT_DIR.trim(), "longterm.db");
  }
  return resolve(cwd, "./data/longterm.db");
}

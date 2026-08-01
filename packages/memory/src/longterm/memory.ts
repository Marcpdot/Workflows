/**
 * Long-term memory API (Milestone 3A) + optional semantic path (M4).
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
  private readonly embeddings?: LongTermMemoryConfig["embeddings"];

  constructor(config: LongTermMemoryConfig) {
    if (!config.dbPath?.trim()) {
      throw new Error("LongTermMemoryConfig.dbPath is required");
    }
    this.store = new FactStore(config.dbPath);
    this.embeddings = config.embeddings;
  }

  private async indexFact(fact: MemoryFact): Promise<void> {
    if (!this.embeddings) return;
    try {
      const [vector] = await this.embeddings.embedder.embed([fact.content]);
      if (!vector?.length) return;
      await this.embeddings.store.upsert({
        id: `ltm:${fact.id}`,
        source: "ltm",
        refId: fact.id,
        text: fact.content,
        vector,
      });
    } catch {
      // Embeddings optional — do not fail remember on embed errors
    }
  }

  private async dropFactVector(factId: string): Promise<void> {
    if (!this.embeddings) return;
    try {
      await this.embeddings.store.deleteByRef("ltm", factId);
    } catch {
      // ignore
    }
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
        const updated = this.store.updateByKey(
          key,
          input.content,
          tags,
          source,
          now
        );
        await this.indexFact(updated);
        return updated;
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
    await this.indexFact(fact);
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
      const text = query.text.trim();
      const keywordHits = this.store.searchByText(text, limit * 2);
      let merged = keywordHits;

      // Semantic path when embeddings configured
      if (this.embeddings) {
        try {
          const [qv] = await this.embeddings.embedder.embed([text]);
          if (qv?.length) {
            const semantic = await this.embeddings.store.search(qv, {
              limit: limit * 2,
              source: "ltm",
              minScore: this.embeddings.minScore ?? 0.3,
            });
            const byId = new Map<string, MemoryFact>();
            for (const f of keywordHits) byId.set(f.id, f);
            for (const hit of semantic) {
              const fact = this.store.getById(hit.record.refId);
              if (fact) byId.set(fact.id, fact);
            }
            merged = [...byId.values()];
          }
        } catch {
          // fall back to keyword only
        }
      }

      return filterByTags(merged, query.tags).slice(0, limit);
    }

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
    const byId = this.store.getById(q);
    if (byId) {
      const ok = this.store.deleteById(q);
      if (ok) await this.dropFactVector(byId.id);
      return ok;
    }
    const byKey = this.store.getByKey(q);
    if (byKey) {
      const ok = this.store.deleteByKey(q);
      if (ok) await this.dropFactVector(byKey.id);
      return ok;
    }
    return false;
  }

  close(): void {
    this.store.close();
    // Vector store lifecycle is owned by orchestrator/embeddings runtime
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

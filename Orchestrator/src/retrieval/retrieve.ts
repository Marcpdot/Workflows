/**
 * Combine session + project_context sources, rank, limit, truncate.
 * M4: optional semantic context hits merged with keyword scores.
 */

import { indexProjectContext } from "../embeddings/indexContext.js";
import { truncateSnippet } from "./tokenize.js";
import type { RetrievedChunk, RetrieveOptions } from "./types.js";
import { DEFAULT_RETRIEVE_OPTIONS } from "./types.js";
import { retrieveFromSession } from "./session.js";
import {
  resolveDefaultContextDir,
  retrieveFromProjectContext,
} from "./projectContext.js";

function resolveOptions(options?: RetrieveOptions): Required<
  Pick<
    RetrieveOptions,
    | "limit"
    | "maxChars"
    | "session"
    | "projectContext"
    | "maxChunkChars"
  >
> & {
  contextDir: string;
  sessionMessages: NonNullable<RetrieveOptions["sessionMessages"]>;
  embeddings?: RetrieveOptions["embeddings"];
} {
  return {
    limit: options?.limit ?? DEFAULT_RETRIEVE_OPTIONS.limit,
    maxChars: options?.maxChars ?? DEFAULT_RETRIEVE_OPTIONS.maxChars,
    session: options?.session ?? DEFAULT_RETRIEVE_OPTIONS.session,
    projectContext:
      options?.projectContext ?? DEFAULT_RETRIEVE_OPTIONS.projectContext,
    maxChunkChars:
      options?.maxChunkChars ?? DEFAULT_RETRIEVE_OPTIONS.maxChunkChars,
    contextDir: options?.contextDir ?? resolveDefaultContextDir(),
    sessionMessages: options?.sessionMessages ?? [],
    embeddings: options?.embeddings,
  };
}

/**
 * Rank candidates by score desc, take top limit, enforce maxChars budget.
 */
export function rankAndTruncate(
  candidates: RetrievedChunk[],
  limit: number,
  maxChars: number
): RetrievedChunk[] {
  const sorted = [...candidates]
    .filter((c) => c.score > 0 && c.text.trim().length > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.source !== b.source) {
        return a.source === "project_context" ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });

  const out: RetrievedChunk[] = [];
  let used = 0;

  for (const chunk of sorted) {
    if (out.length >= limit) break;
    const remaining = maxChars - used;
    if (remaining <= 0) break;

    let text = chunk.text;
    if (text.length > remaining) {
      text = text.slice(0, Math.max(0, remaining - 1)).trimEnd() + "…";
    }
    if (!text.trim()) continue;

    out.push({ ...chunk, text });
    used += text.length;
  }

  return out;
}

/**
 * Simple reciprocal-rank fusion style merge: sum 1/(k+rank) scaled to score.
 */
function mergeById(
  lists: RetrievedChunk[][],
  k = 60
): RetrievedChunk[] {
  const map = new Map<string, RetrievedChunk & { rrf: number }>();

  for (const list of lists) {
    list.forEach((chunk, rank) => {
      const key = `${chunk.source}:${chunk.id}`;
      const add = 1 / (k + rank + 1);
      const existing = map.get(key);
      if (existing) {
        existing.rrf += add;
        // keep higher raw score text
        if (chunk.score > existing.score) {
          existing.score = chunk.score;
          existing.text = chunk.text;
        }
      } else {
        map.set(key, { ...chunk, rrf: add });
      }
    });
  }

  return [...map.values()]
    .map((c) => ({
      source: c.source,
      id: c.id,
      text: c.text,
      // blend raw score with RRF so semantic (0-1) and keyword (counts) coexist
      score: c.score + c.rrf * 10,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Retrieve relevant context snippets for a query.
 * Empty query or no hits → [] (not an error).
 * Missing context dir → session-only / empty project side.
 * Embeddings optional — keyword path unchanged when disabled/missing.
 */
export async function retrieve(
  query: string,
  options?: RetrieveOptions
): Promise<RetrievedChunk[]> {
  if (!query || !query.trim()) {
    return [];
  }

  const opts = resolveOptions(options);
  const keywordChunks: RetrievedChunk[] = [];

  if (opts.session && opts.sessionMessages.length > 0) {
    keywordChunks.push(
      ...retrieveFromSession(query, opts.sessionMessages, opts.maxChunkChars)
    );
  }

  if (opts.projectContext) {
    keywordChunks.push(
      ...retrieveFromProjectContext(
        query,
        opts.contextDir,
        opts.maxChunkChars
      )
    );
  }

  const semanticChunks: RetrievedChunk[] = [];
  if (opts.embeddings && opts.projectContext) {
    try {
      await indexProjectContext({
        contextDir: opts.contextDir,
        embedder: opts.embeddings.embedder,
        store: opts.embeddings.store,
        skipIfNonEmpty: true,
      });

      const [qv] = await opts.embeddings.embedder.embed([query.trim()]);
      if (qv?.length) {
        const hits = await opts.embeddings.store.search(qv, {
          limit: opts.limit * 2,
          source: "context",
          minScore: opts.embeddings.minScore ?? 0.3,
        });
        for (const hit of hits) {
          semanticChunks.push({
            source: "project_context",
            id: hit.record.refId,
            text: truncateSnippet(hit.record.text, opts.maxChunkChars),
            // scale cosine [0,1] roughly into keyword-like range
            score: hit.score * 5,
          });
        }
      }
    } catch {
      // semantic optional — keep keyword only
    }
  }

  let candidates: RetrievedChunk[];
  if (semanticChunks.length > 0 && keywordChunks.length > 0) {
    candidates = mergeById([keywordChunks, semanticChunks]);
  } else if (semanticChunks.length > 0) {
    candidates = semanticChunks;
  } else {
    candidates = keywordChunks;
  }

  return rankAndTruncate(candidates, opts.limit, opts.maxChars);
}

export function formatRetrievalBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  return chunks.map((c) => `[${c.source}] ${c.text}`).join("\n\n");
}

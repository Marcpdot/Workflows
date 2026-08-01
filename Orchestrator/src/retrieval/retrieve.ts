/**
 * Combine session + project_context sources, rank, limit, truncate.
 */

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
> & { contextDir: string; sessionMessages: NonNullable<RetrieveOptions["sessionMessages"]> } {
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
      // stable-ish tie-break: prefer project_context, then id
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
 * Retrieve relevant context snippets for a query.
 * Empty query or no hits → [] (not an error).
 * Missing context dir → session-only / empty project side.
 */
export async function retrieve(
  query: string,
  options?: RetrieveOptions
): Promise<RetrievedChunk[]> {
  if (!query || !query.trim()) {
    return [];
  }

  const opts = resolveOptions(options);
  const candidates: RetrievedChunk[] = [];

  if (opts.session && opts.sessionMessages.length > 0) {
    candidates.push(
      ...retrieveFromSession(query, opts.sessionMessages, opts.maxChunkChars)
    );
  }

  if (opts.projectContext) {
    candidates.push(
      ...retrieveFromProjectContext(
        query,
        opts.contextDir,
        opts.maxChunkChars
      )
    );
  }

  return rankAndTruncate(candidates, opts.limit, opts.maxChars);
}

export function formatRetrievalBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  return chunks.map((c) => `[${c.source}] ${c.text}`).join("\n\n");
}

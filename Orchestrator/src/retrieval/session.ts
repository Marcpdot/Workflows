/**
 * Keyword retrieval over session chat messages.
 */

import type { ChatMessage } from "../types.js";
import type { RetrievedChunk } from "./types.js";
import { scoreText, truncateSnippet, uniqueTokens } from "./tokenize.js";

export function retrieveFromSession(
  query: string,
  messages: ChatMessage[],
  maxChunkChars: number
): RetrievedChunk[] {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0 || messages.length === 0) return [];

  const chunks: RetrievedChunk[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const raw = `${msg.role}: ${msg.content}`;
    const score = scoreText(queryTokens, raw);
    if (score <= 0) continue;

    chunks.push({
      source: "session",
      id: `session:${i}:${msg.role}`,
      text: truncateSnippet(raw, maxChunkChars),
      score,
    });
  }

  return chunks;
}

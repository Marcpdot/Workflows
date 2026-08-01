/**
 * Realtime conversation history compression (Milestone 1).
 *
 * Pure split of messages; only side effect is the summarizer call when compressing.
 */

import type {
  ChatMessage,
  CompressionConfig,
  CompressionResult,
  Summarizer,
} from "./types.js";
import { DEFAULT_COMPRESSION_CONFIG } from "./types.js";

function resolveConfig(
  config?: Partial<CompressionConfig>
): CompressionConfig {
  return {
    threshold: config?.threshold ?? DEFAULT_COMPRESSION_CONFIG.threshold,
    keepRecent: config?.keepRecent ?? DEFAULT_COMPRESSION_CONFIG.keepRecent,
    maxSummaryChars:
      config?.maxSummaryChars ?? DEFAULT_COMPRESSION_CONFIG.maxSummaryChars,
  };
}

/**
 * Compress history for a single model call.
 * - If messages.length <= threshold: summary=null, recentMessages=messages
 * - Else: summarize messages.slice(0, -keepRecent), keep last keepRecent raw
 */
export async function compressHistory(
  messages: ChatMessage[],
  config: Partial<CompressionConfig>,
  summarizer: Summarizer
): Promise<CompressionResult> {
  const cfg = resolveConfig(config);

  if (!messages || messages.length === 0) {
    return {
      summary: null,
      recentMessages: [],
      compressed: false,
    };
  }

  if (messages.length <= cfg.threshold || cfg.keepRecent >= messages.length) {
    return {
      summary: null,
      recentMessages: messages,
      compressed: false,
    };
  }

  const splitAt = messages.length - cfg.keepRecent;
  const older = messages.slice(0, splitAt);
  const recentMessages = messages.slice(splitAt);

  const summary = await summarizer.summarize(older);
  if (!summary.trim()) {
    throw new Error(
      "Summarizer returned an empty summary; refusing silent fallback to full history"
    );
  }

  return {
    summary,
    recentMessages,
    compressed: true,
  };
}

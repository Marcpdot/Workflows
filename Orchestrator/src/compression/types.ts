import type { ChatMessage } from "../types.js";

export interface CompressionConfig {
  /** Compress when history.length > threshold. Default: 20 */
  threshold: number;
  /** Number of newest messages always kept raw. Default: 8 */
  keepRecent: number;
  /** Soft max characters for the summary prompt/output. Default: 1500 */
  maxSummaryChars?: number;
}

export interface CompressionResult {
  /** null if no compression was performed */
  summary: string | null;
  /** Last keepRecent messages, chronological (oldest first) */
  recentMessages: ChatMessage[];
  /** true if a summary was generated */
  compressed: boolean;
}

/** Pluggable summarizer — in practice the local ModelClient */
export interface Summarizer {
  summarize(messages: ChatMessage[]): Promise<string>;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  threshold: 20,
  keepRecent: 8,
  maxSummaryChars: 1500,
};

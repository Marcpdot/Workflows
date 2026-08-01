/**
 * Local-model summarizer for conversation history compression.
 */

import type { ChatMessage, ModelClient } from "../types.js";
import type { Summarizer } from "./types.js";

export const SUMMARIZE_SYSTEM_PROMPT = `You compress conversation history. Output a concise summary of facts, decisions, names, and open threads. No preamble. Max ~12 sentences.`;

function formatTurns(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");
}

/**
 * Build the fixed summarize prompt messages.
 */
export function buildSummarizeMessages(
  messages: ChatMessage[]
): ChatMessage[] {
  return [
    { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Summarize the following conversation turns:\n\n" +
        formatTurns(messages),
    },
  ];
}

/**
 * Summarizer backed by a ModelClient (must be the local model in production).
 */
export class LocalModelSummarizer implements Summarizer {
  constructor(
    private readonly client: ModelClient,
    private readonly model?: string,
    private readonly maxSummaryChars: number = 1500
  ) {}

  async summarize(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) {
      return "";
    }

    try {
      const response = await this.client.complete({
        messages: buildSummarizeMessages(messages),
        model: this.model,
        temperature: 0.2,
      });

      let summary = response.content.trim();
      if (summary.length > this.maxSummaryChars) {
        summary = summary.slice(0, this.maxSummaryChars).trimEnd() + "…";
      }
      return summary;
    } catch (err) {
      throw new Error(
        `Summarizer failed (provider=${this.client.provider}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

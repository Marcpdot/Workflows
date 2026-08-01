/**
 * Token estimation and rough USD cost for eval reports.
 * Rates are approximate and configurable via env — not billing-grade.
 */

import type { ModelChoice } from "../../../Orchestrator/src/types.js";

export interface UsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CostBreakdown {
  /** Estimated or reported total tokens */
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  /** true if tokens were estimated from character length */
  tokensEstimated: boolean;
  /** USD estimate; 0 for local */
  estimatedCostUsd: number;
  /** Short note e.g. "local=0" or "rate table grok-3" */
  costNote: string;
}

/** ~4 chars per token heuristic when provider does not return usage */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function rateFromEnv(
  key: string,
  fallbackPerMillion: number
): number {
  const raw = process.env[key];
  if (!raw) return fallbackPerMillion;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallbackPerMillion;
}

/**
 * Default rates USD per 1M tokens (approx, mid-2026 ballpark for Grok-class).
 * Override with EVAL_COST_INPUT_PER_M / EVAL_COST_OUTPUT_PER_M.
 */
export function estimateCostUsd(
  provider: ModelChoice | string,
  promptTokens: number,
  completionTokens: number
): { usd: number; note: string } {
  if (provider === "local") {
    return { usd: 0, note: "local=0" };
  }

  const inputPerM = rateFromEnv("EVAL_COST_INPUT_PER_M", 1.25);
  const outputPerM = rateFromEnv("EVAL_COST_OUTPUT_PER_M", 2.5);
  const usd =
    (promptTokens / 1_000_000) * inputPerM +
    (completionTokens / 1_000_000) * outputPerM;

  return {
    usd: Math.round(usd * 1_000_000) / 1_000_000,
    note: `frontier rates in=${inputPerM}/M out=${outputPerM}/M`,
  };
}

/**
 * Build cost breakdown from API usage and/or reply+prompt text fallback.
 */
export function buildCostBreakdown(input: {
  provider: ModelChoice | string;
  usage?: UsageLike;
  promptText?: string;
  replyText?: string;
}): CostBreakdown {
  const usage = input.usage;
  let promptTokens = usage?.promptTokens;
  let completionTokens = usage?.completionTokens;
  let totalTokens = usage?.totalTokens;
  let tokensEstimated = false;

  if (
    promptTokens == null &&
    completionTokens == null &&
    totalTokens == null
  ) {
    tokensEstimated = true;
    promptTokens = estimateTokensFromText(input.promptText ?? "");
    completionTokens = estimateTokensFromText(input.replyText ?? "");
    totalTokens = promptTokens + completionTokens;
  } else {
    promptTokens = promptTokens ?? 0;
    completionTokens = completionTokens ?? 0;
    totalTokens =
      totalTokens ?? promptTokens + completionTokens;
  }

  const { usd, note } = estimateCostUsd(
    input.provider,
    promptTokens,
    completionTokens
  );

  return {
    totalTokens,
    promptTokens,
    completionTokens,
    tokensEstimated,
    estimatedCostUsd: usd,
    costNote: tokensEstimated ? `${note}; tokens≈chars/4` : note,
  };
}

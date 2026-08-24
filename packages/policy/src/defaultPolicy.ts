/**
 * Rule + budget compute policy (Milestone 7).
 * When disabled, mirrors router choice (no cap enforcement).
 */

import { estimateTokensFromText } from "@workflows/eval/cost";
import { BudgetTracker } from "./budget.js";
import type {
  ComputePolicy,
  ComputeTier,
  PolicyConfig,
  PolicyDecision,
  PolicyInput,
  UsageRecord,
} from "./types.js";

function estimateCallUsd(
  tier: ComputeTier,
  tokens: number,
  config: PolicyConfig
): number {
  if (tier === "local" || tokens <= 0) return 0;
  // Assume ~60% prompt / 40% completion for pre-call estimate
  const prompt = Math.floor(tokens * 0.6);
  const completion = Math.max(1, tokens - prompt);
  const inRate =
    tier === "mid" ? config.midInputPerM : config.frontierInputPerM;
  const outRate =
    tier === "mid" ? config.midOutputPerM : config.frontierOutputPerM;
  return (prompt / 1e6) * inRate + (completion / 1e6) * outRate;
}

/**
 * Map router local|frontier (+ optional mid for medium work) without budget.
 */
function baseTier(input: PolicyInput, config: PolicyConfig): {
  tier: ComputeTier;
  reason: string;
} {
  if (input.forceTier) {
    return { tier: input.forceTier, reason: `forced → ${input.forceTier}` };
  }

  const router = input.routerTier;
  const task = input.taskType ?? "general";
  const complexity = input.complexity ?? "medium";

  // Router still labels many paths as local (tool/summarize/medium).
  // When mid is configured, or default tier is mid/frontier, elevate so weak
  // local models are not used for tool loops and real work.
  if (router === "local") {
    const preferRemote =
      config.defaultTier === "mid" || config.defaultTier === "frontier";
    const toolOrMedium =
      task === "tool" ||
      task === "summarize" ||
      complexity === "medium" ||
      complexity === "high";

    if (config.midModel && (preferRemote || toolOrMedium)) {
      return {
        tier: "mid",
        reason: `elevate local router (${task}/${complexity}) → mid (${config.midModel})`,
      };
    }
    if (preferRemote && config.defaultTier === "frontier") {
      return {
        tier: "frontier",
        reason: `elevate local router (${task}/${complexity}) → frontier (POLICY_DEFAULT_TIER)`,
      };
    }
    return { tier: "local", reason: `router → local (${task}/${complexity})` };
  }

  // Router said frontier (or mid)
  if (router === "mid") {
    if (config.midModel) {
      return { tier: "mid", reason: `router → mid (${config.midModel})` };
    }
    return {
      tier: "frontier",
      reason: "router mid unavailable → frontier",
    };
  }

  // Prefer mid for medium complexity non-research when mid is configured
  if (
    config.midModel &&
    complexity === "medium" &&
    task !== "research" &&
    task !== "reasoning"
  ) {
    return {
      tier: "mid",
      reason: `medium/${task} → mid (${config.midModel})`,
    };
  }

  if (router === "frontier") {
    return {
      tier: "frontier",
      reason: `router → frontier (${task}/${complexity})`,
    };
  }

  return {
    tier: config.defaultTier,
    reason: `default → ${config.defaultTier}`,
  };
}

export class DefaultComputePolicy implements ComputePolicy {
  private readonly budget: BudgetTracker;
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = config;
    this.budget = new BudgetTracker(
      config.sessionTokenCap,
      config.dailyUsdCap
    );
  }

  decide(input: PolicyInput): PolicyDecision {
    const estimatedTokens =
      input.estimatedTokens ??
      estimateTokensFromText(input.prompt) * 2; // rough in+out

    if (!this.config.enabled) {
      const base = baseTier(input, this.config);
      // When off: never enforce budget; mirror router-ish choice
      return {
        tier: base.tier,
        reason: `policy off · ${base.reason}`,
        budgetRemaining: this.budget.remaining(),
        budgetCapped: false,
      };
    }

    let { tier, reason } = baseTier(input, this.config);

    // Force still wins but can be capped? Spec: force respected — only cap non-force
    if (!input.forceTier) {
      const estUsd = estimateCallUsd(tier, estimatedTokens, this.config);
      if (
        tier !== "local" &&
        this.budget.wouldExceed({ tokens: estimatedTokens, usd: estUsd })
      ) {
        tier = "local";
        reason = `${reason}; budget cap → local`;
        return {
          tier,
          reason,
          budgetRemaining: this.budget.remaining(),
          budgetCapped: true,
        };
      }
    } else if (
      input.forceTier !== "local" &&
      this.budget.wouldExceed({
        tokens: estimatedTokens,
        usd: estimateCallUsd(
          input.forceTier,
          estimatedTokens,
          this.config
        ),
      })
    ) {
      // Force requested paid tier but budget exhausted — still force, note it
      reason = `${reason}; budget low (force honored)`;
    }

    // Mid without model → local (safer than surprise frontier)
    if (tier === "mid" && !this.config.midModel) {
      tier = "local";
      reason = `${reason}; mid model unset → local`;
    }

    return {
      tier,
      reason,
      budgetRemaining: this.budget.remaining(),
      budgetCapped: false,
    };
  }

  recordUsage(tier: ComputeTier, usage: UsageRecord): void {
    const tokens = usage.tokens ?? 0;
    let usd = usage.usd;
    if (usd == null && tokens > 0 && tier !== "local") {
      usd = estimateCallUsd(tier, tokens, this.config);
    }
    this.budget.record(tokens, usd ?? 0);
  }

  snapshot() {
    return this.budget.snapshot();
  }
}

export function loadPolicyConfig(
  env: NodeJS.ProcessEnv = process.env
): PolicyConfig {
  const flag = (v: string | undefined) =>
    v === "1" || v === "true" || v === "yes";

  const num = (v: string | undefined): number | undefined => {
    if (v == null || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const rate = (key: string, fallback: number) => {
    const n = Number(env[key]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const defaultTierRaw = (env.POLICY_DEFAULT_TIER ?? "local").toLowerCase();
  const defaultTier: ComputeTier =
    defaultTierRaw === "mid" || defaultTierRaw === "frontier"
      ? defaultTierRaw
      : "local";

  return {
    enabled: flag(env.POLICY_ENABLED),
    defaultTier,
    sessionTokenCap: num(env.POLICY_SESSION_TOKEN_CAP),
    dailyUsdCap: num(env.POLICY_DAILY_USD_CAP),
    midModel: env.POLICY_MID_MODEL?.trim() || undefined,
    frontierInputPerM: rate("EVAL_COST_INPUT_PER_M", 1.25),
    frontierOutputPerM: rate("EVAL_COST_OUTPUT_PER_M", 2.5),
    midInputPerM: rate("POLICY_MID_INPUT_PER_M", 0.4),
    midOutputPerM: rate("POLICY_MID_OUTPUT_PER_M", 0.8),
  };
}

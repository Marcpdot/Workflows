export type ComputeTier = "local" | "mid" | "frontier";

export interface PolicyInput {
  prompt: string;
  taskType?: string;
  complexity?: string;
  /** Rough pre-call estimate (chars/4 if unknown) */
  estimatedTokens?: number;
  forceTier?: ComputeTier;
  /** Router suggestion before budget (local | frontier typically) */
  routerTier?: ComputeTier;
}

export interface BudgetRemaining {
  tokens?: number;
  usd?: number;
}

export interface PolicyDecision {
  tier: ComputeTier;
  reason: string;
  budgetRemaining?: BudgetRemaining;
  /** true if budget forced a downgrade */
  budgetCapped?: boolean;
}

export interface UsageRecord {
  tokens?: number;
  usd?: number;
}

export interface ComputePolicy {
  decide(input: PolicyInput): PolicyDecision;
  recordUsage(tier: ComputeTier, usage: UsageRecord): void;
  /** For tests / observability */
  snapshot(): {
    sessionTokensUsed: number;
    dailyUsdUsed: number;
    caps: { sessionTokens?: number; dailyUsd?: number };
  };
}

export interface PolicyConfig {
  enabled: boolean;
  /** Soft default when router is ambiguous */
  defaultTier: ComputeTier;
  sessionTokenCap?: number;
  dailyUsdCap?: number;
  /** If set, mid tier is available */
  midModel?: string;
  /** USD rates per 1M tokens for estimates (frontier) */
  frontierInputPerM: number;
  frontierOutputPerM: number;
  midInputPerM: number;
  midOutputPerM: number;
}

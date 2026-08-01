/**
 * In-process session + daily budget counters (M7).
 * Not durable across restarts (good enough for first cut).
 */

export class BudgetTracker {
  private sessionTokensUsed = 0;
  private dailyUsdUsed = 0;
  private dayKey: string;

  constructor(
    private readonly sessionTokenCap?: number,
    private readonly dailyUsdCap?: number
  ) {
    this.dayKey = BudgetTracker.todayKey();
  }

  private rollDay(): void {
    const today = BudgetTracker.todayKey();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.dailyUsdUsed = 0;
    }
  }

  static todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  record(tokens?: number, usd?: number): void {
    this.rollDay();
    if (tokens != null && Number.isFinite(tokens) && tokens > 0) {
      this.sessionTokensUsed += tokens;
    }
    if (usd != null && Number.isFinite(usd) && usd > 0) {
      this.dailyUsdUsed += usd;
    }
  }

  remaining(): { tokens?: number; usd?: number } {
    this.rollDay();
    return {
      tokens:
        this.sessionTokenCap != null
          ? Math.max(0, this.sessionTokenCap - this.sessionTokensUsed)
          : undefined,
      usd:
        this.dailyUsdCap != null
          ? Math.max(0, this.dailyUsdCap - this.dailyUsdUsed)
          : undefined,
    };
  }

  /** True if estimated spend would exceed remaining caps. */
  wouldExceed(estimate: { tokens?: number; usd?: number }): boolean {
    this.rollDay();
    if (
      this.sessionTokenCap != null &&
      estimate.tokens != null &&
      this.sessionTokensUsed + estimate.tokens > this.sessionTokenCap
    ) {
      return true;
    }
    if (
      this.dailyUsdCap != null &&
      estimate.usd != null &&
      this.dailyUsdUsed + estimate.usd > this.dailyUsdCap
    ) {
      return true;
    }
    return false;
  }

  snapshot() {
    this.rollDay();
    return {
      sessionTokensUsed: this.sessionTokensUsed,
      dailyUsdUsed: this.dailyUsdUsed,
      caps: {
        sessionTokens: this.sessionTokenCap,
        dailyUsd: this.dailyUsdCap,
      },
    };
  }
}

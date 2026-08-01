# Milestone 7 — Compute-policy

## Mål
Styre **når** systemet bruker local vs mid-tier API vs frontier — med enkle budsjett/tak, ikke bare hardkodet router.

```text
prompt + kontekst
    → policy (regler + budsjett)
    → choice: local | mid | frontier | refuse/defer
```

## Scope
1. `ComputePolicy`-interface som router/orchestrator kan spørre
2. Regler basert på: task type, kompleksitet, lengde, eksplisitte flagg, gjenstående budsjett
3. Enkel kostnadsmodell (gjenbruk eval-cost rates der det passer)
4. Env: daglig/session token- eller USD-tak
5. Logging av policy-beslutning (grunnlag) — klar for M8
6. Default: oppførsel nær dagens router når policy er «off» / unlimited

## Utenfor scope
- Dynamisk pris-API fra leverandører
- Multi-cloud arbitrage
- ML-basert policy

## API (skisse)

```ts
export type ComputeTier = "local" | "mid" | "frontier";

export interface PolicyInput {
  prompt: string;
  taskType?: string;
  complexity?: string;
  estimatedTokens?: number;
  forceTier?: ComputeTier;
}

export interface PolicyDecision {
  tier: ComputeTier;
  reason: string;
  budgetRemaining?: { tokens?: number; usd?: number };
}

export interface ComputePolicy {
  decide(input: PolicyInput): PolicyDecision;
  recordUsage(tier: ComputeTier, usage: { tokens?: number; usd?: number }): void;
}
```

## Env
```
POLICY_ENABLED=false
POLICY_DAILY_USD_CAP=
POLICY_SESSION_TOKEN_CAP=
POLICY_MID_MODEL=          # optional open-weight API model id
POLICY_DEFAULT_TIER=local
```

## Integrasjon
- Kalles fra orchestrator før modellvalg (kan erstatte eller wrappe `route()`)
- Mid-tier: kun hvis klient finnes; ellers fallback local/frontier med reason

## Ferdig når
- Policy kan tvinge local under tak
- Force-flagg respekteres
- Smoke med mock budget
- Av = dagens oppførsel

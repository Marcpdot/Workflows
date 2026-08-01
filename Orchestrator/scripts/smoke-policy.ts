/**
 * Offline smoke for Milestone 7 compute policy (mock budget, no models).
 */

import {
  DefaultComputePolicy,
  type PolicyConfig,
} from "../src/policy/index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function baseConfig(over: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    enabled: true,
    defaultTier: "local",
    sessionTokenCap: 1000,
    dailyUsdCap: 0.01,
    midModel: "mid-test-model",
    frontierInputPerM: 1.25,
    frontierOutputPerM: 2.5,
    midInputPerM: 0.4,
    midOutputPerM: 0.8,
    ...over,
  };
}

async function main(): Promise<void> {
  // 1. Policy off → mirrors router, no cap
  const off = new DefaultComputePolicy(baseConfig({ enabled: false }));
  const offDec = off.decide({
    prompt: "research deep topic",
    routerTier: "frontier",
    taskType: "research",
    complexity: "high",
    estimatedTokens: 50_000,
  });
  assert(offDec.tier === "frontier", "off keeps frontier");
  assert(offDec.reason.includes("policy off"), "off reason");
  console.log("OK: policy off mirrors router");

  // 2. Force tier honored
  const pol = new DefaultComputePolicy(baseConfig());
  const forced = pol.decide({
    prompt: "hello",
    routerTier: "local",
    forceTier: "frontier",
    estimatedTokens: 100,
  });
  assert(forced.tier === "frontier", "force frontier");
  assert(forced.reason.includes("forced"), "force reason");
  console.log("OK: forceTier");

  // 3. Budget forces local under cap
  const tight = new DefaultComputePolicy(
    baseConfig({ sessionTokenCap: 100, dailyUsdCap: 0.000001 })
  );
  // Burn budget
  tight.recordUsage("frontier", { tokens: 90, usd: 0.000001 });
  const capped = tight.decide({
    prompt: "another frontier research task that is long",
    routerTier: "frontier",
    taskType: "research",
    complexity: "high",
    estimatedTokens: 500,
  });
  assert(capped.tier === "local", `expected local under cap, got ${capped.tier}`);
  assert(capped.budgetCapped === true, "budgetCapped");
  assert(capped.reason.includes("budget"), "budget in reason");
  console.log("OK: budget cap → local");

  // 4. Mid for medium when configured
  const mid = new DefaultComputePolicy(baseConfig());
  const midDec = mid.decide({
    prompt: "general question of medium size",
    routerTier: "frontier",
    taskType: "general",
    complexity: "medium",
    estimatedTokens: 200,
  });
  assert(midDec.tier === "mid", `expected mid, got ${midDec.tier}`);
  console.log("OK: medium → mid when mid model set");

  // 5. Mid unavailable → local when would choose mid
  const noMid = new DefaultComputePolicy(
    baseConfig({ midModel: undefined })
  );
  const noMidDec = noMid.decide({
    prompt: "medium",
    routerTier: "mid",
    taskType: "general",
    complexity: "medium",
    estimatedTokens: 50,
  });
  assert(
    noMidDec.tier === "local" || noMidDec.tier === "frontier",
    "no mid model falls back"
  );
  console.log(`OK: mid unset fallback → ${noMidDec.tier}`);

  // 6. recordUsage updates snapshot
  const snap0 = pol.snapshot();
  pol.recordUsage("local", { tokens: 10 });
  pol.recordUsage("frontier", { tokens: 100, usd: 0.001 });
  const snap1 = pol.snapshot();
  assert(
    snap1.sessionTokensUsed >= snap0.sessionTokensUsed + 110,
    "tokens accumulated"
  );
  assert(snap1.dailyUsdUsed >= 0.001, "usd accumulated");
  console.log("OK: recordUsage + snapshot");

  console.log("All policy smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

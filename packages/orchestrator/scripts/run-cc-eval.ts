import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createCcEvaluationReport,
  type CcEvaluationResult,
} from "@workflows/eval";

const SCENARIOS = [
  ["wp1-experience", "smoke-experience.ts"],
  ["wp2-lineage", "integration-knowledge-lineage.ts"],
  ["wp3-activation", "smoke-capability-activation.ts"],
  ["wp4-operational-continuity", "smoke-continuous-cognition.ts"],
  ["wp5-representation-acquisition", "smoke-representation-acquisition.ts"],
  ["wp6-background-cognition", "smoke-background-cognition.ts"],
  ["wp7-observability", "smoke-continuous-cognition-observability.ts"],
] as const;

async function runScenario(
  scenarioId: string,
  script: string
): Promise<CcEvaluationResult> {
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [
      "--require",
      resolve(process.cwd(), "scripts", "tsx-bootstrap.cjs"),
      "--import",
      "tsx",
      resolve(process.cwd(), "scripts", script),
    ],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    stderr += text;
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolveExit(code ?? 1));
  });
  return {
    scenarioId,
    pass: exitCode === 0,
    durationMs: Math.round(performance.now() - started),
    failureReason:
      exitCode === 0
        ? undefined
        : stderr.trim().split(/\r?\n/).slice(-3).join(" | ") || `exit ${exitCode}`,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const results: CcEvaluationResult[] = [];
  for (const [scenarioId, script] of SCENARIOS) {
    console.log(`\n[cc] ${scenarioId}`);
    results.push(await runScenario(scenarioId, script));
  }
  const finishedAt = new Date().toISOString();
  const report = createCcEvaluationReport(startedAt, finishedAt, results);
  const resultsDir = resolve(process.cwd(), "data", "eval-results", "cc");
  await mkdir(resultsDir, { recursive: true });
  const path = resolve(
    resultsDir,
    `${startedAt.replace(/[:.]/g, "-")}.json`
  );
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `\n[cc] ${report.summary.passed}/${report.summary.total} passed in ${report.summary.durationMs}ms`
  );
  console.log(`[cc] report ${path}`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

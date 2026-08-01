/**
 * Eval suite runner — exercises Orchestrator the same way the CLI does.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  Orchestrator,
  loadConfigFromEnv,
} from "../../../Orchestrator/src/orchestrator.js";
import { createMemory } from "../../memory/src/index.js";
import type { ChatMessage } from "../../../Orchestrator/src/types.js";
import { runAssertions } from "./assertions.js";
import { buildCostBreakdown } from "./cost.js";
import type {
  EvalCase,
  EvalReport,
  EvalResult,
  EvalRunnerOptions,
} from "./types.js";

const COMPRESSION_PAD_TARGET = 24;

function loadCases(casesPath: string): EvalCase[] {
  const raw = readFileSync(casesPath, "utf8");
  const parsed = JSON.parse(raw) as EvalCase[] | { cases: EvalCase[] };
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`No eval cases found in ${casesPath}`);
  }
  return cases;
}

function preview(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function padForCompression(setup: ChatMessage[]): ChatMessage[] {
  if (setup.length > 20) return setup;
  const padded = [...setup];
  let i = 0;
  while (padded.length < COMPRESSION_PAD_TARGET) {
    const role = padded.length % 2 === 0 ? "user" : "assistant";
    padded.push({
      role,
      content:
        role === "user"
          ? `Filler user turn ${i}: talking about weather and logistics.`
          : `Filler assistant turn ${i}: acknowledged.`,
    });
    i++;
  }
  return padded;
}

async function runOneCase(
  orch: Orchestrator,
  evalCase: EvalCase,
  runId: string,
  dbPath: string
): Promise<EvalResult> {
  const sessionId = `eval-${evalCase.id}-${runId}`;
  const failures: string[] = [];
  const started = performance.now();

  let route = "";
  let model = "";
  let provider = "";
  let replyPreview = "";
  let usage: EvalResult["usage"];
  let compressed: boolean | undefined;
  let replyText = "";

  const memory = createMemory({ dbPath, defaultLimit: 100 });

  try {
    if (evalCase.sessionSetup && evalCase.sessionSetup.length > 0) {
      for (const msg of evalCase.sessionSetup) {
        await memory.add(sessionId, msg);
      }
    }

    let history: ChatMessage[] = await memory.getHistory(sessionId, 100);

    if (evalCase.forceCompression) {
      history = padForCompression(history);
    }

    // Pre-check route for missing frontier key (don't crash the suite).
    const decision = orch.decide(evalCase.prompt);
    if (decision.model === "frontier") {
      const key = process.env.XAI_API_KEY ?? "";
      if (!key.trim()) {
        return {
          id: evalCase.id,
          pass: false,
          route: decision.model,
          model: decision.frontierModel ?? "",
          provider: "frontier",
          latencyMs: Math.round(performance.now() - started),
          replyPreview: "",
          failures: ["missing API key (XAI_API_KEY)"],
          totalTokens: 0,
          estimatedCostUsd: 0,
          tokensEstimated: false,
          costNote: "skipped — missing API key",
        };
      }
    }

    const result = await orch.handle(evalCase.prompt, { history });
    const latencyMs = Math.round(performance.now() - started);

    route = result.routing.model;
    model = result.model;
    provider = result.provider;
    replyText = result.reply;
    replyPreview = preview(result.reply);
    usage = result.usage;
    compressed = result.compression?.compressed;

    failures.push(...runAssertions(evalCase, result));

    if (evalCase.forceCompression && compressed !== true) {
      failures.push(
        `forceCompression: expected compressed=true, got ${String(compressed)}`
      );
    }

    // Prefer API usage; for local (no usage), estimate from history+prompt+reply.
    const promptForEstimate = [
      ...history.map((m) => m.content),
      evalCase.prompt,
    ].join("\n");

    const cost = buildCostBreakdown({
      provider,
      usage,
      promptText: promptForEstimate,
      replyText,
    });

    return {
      id: evalCase.id,
      pass: failures.length === 0,
      route,
      model,
      provider,
      latencyMs,
      usage,
      totalTokens: cost.totalTokens,
      tokensEstimated: cost.tokensEstimated,
      estimatedCostUsd: cost.estimatedCostUsd,
      costNote: cost.costNote,
      compressed,
      replyPreview,
      failures,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`error: ${msg}`);
    return {
      id: evalCase.id,
      pass: false,
      route,
      model,
      provider,
      latencyMs: Math.round(performance.now() - started),
      replyPreview,
      failures,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  } finally {
    try {
      await memory.clear(sessionId);
      memory.close();
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function runEvalSuite(
  options: EvalRunnerOptions
): Promise<EvalReport> {
  const allCases = loadCases(options.casesPath);
  const cases = options.caseId
    ? allCases.filter((c) => c.id === options.caseId)
    : allCases;

  if (cases.length === 0) {
    throw new Error(
      options.caseId
        ? `No eval case with id "${options.caseId}"`
        : "No eval cases to run"
    );
  }

  const config = loadConfigFromEnv();
  const orch = new Orchestrator(config);
  const runId = Date.now().toString(36);
  const dbPath = join(options.resultsDir, `..`, `eval-memory-${runId}.db`);

  const startedAt = new Date().toISOString();
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    const result = await runOneCase(orch, evalCase, runId, dbPath);
    results.push(result);
    const mark = result.pass ? "PASS" : "FAIL";
    const tok =
      result.totalTokens != null
        ? `${result.totalTokens}tok${result.tokensEstimated ? "~" : ""}`
        : "-tok";
    const cost =
      result.estimatedCostUsd != null
        ? `$${result.estimatedCostUsd.toFixed(6)}`
        : "-";
    console.log(
      `${mark}  ${result.id.padEnd(28)}  route=${(result.route || "-").padEnd(8)}  ${String(result.latencyMs).padStart(5)}ms  ${tok.padStart(8)}  ${cost.padStart(10)}  ${result.failures.join("; ") || "ok"}`
    );
  }

  const finishedAt = new Date().toISOString();
  const passed = results.filter((r) => r.pass).length;
  const totalTokens = results.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
  const estimatedCostUsd = results.reduce(
    (s, r) => s + (r.estimatedCostUsd ?? 0),
    0
  );
  const tokensEstimatedCases = results.filter((r) => r.tokensEstimated).length;

  const report: EvalReport = {
    startedAt,
    finishedAt,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      totalTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      tokensEstimatedCases,
    },
  };

  mkdirSync(options.resultsDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const outPath = join(options.resultsDir, `${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nReport written: ${outPath}`);
  console.log(
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed | tokens=${report.summary.totalTokens} cost≈$${report.summary.estimatedCostUsd}`
  );

  try {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  } catch {
    // ignore
  }

  return report;
}

/**
 * Default cases live in packages/eval/cases.json.
 * resultsDir stays under the caller cwd (typically Orchestrator/data/eval-results).
 * Discover cases from Orchestrator cwd or monorepo root without import.meta.
 */
export function resolveEvalPaths(cwd = process.cwd()): {
  casesPath: string;
  resultsDir: string;
} {
  const candidates = [
    join(cwd, "..", "packages", "eval", "cases.json"),
    join(cwd, "packages", "eval", "cases.json"),
    join(cwd, "eval", "cases.json"),
  ];
  let casesPath = candidates[0]!;
  for (const c of candidates) {
    if (existsSync(c)) {
      casesPath = c;
      break;
    }
  }
  return {
    casesPath,
    resultsDir: join(cwd, "data", "eval-results"),
  };
}

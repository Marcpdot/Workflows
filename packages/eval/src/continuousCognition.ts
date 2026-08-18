import type {
  CcEvaluationReport,
  CcEvaluationResult,
} from "./types.js";

export const CC_EVALUATION_RESULT_PROTOCOL = "json-line";
export const CC_EVALUATION_RESULT_PREFIX = "@@workflows:cc-evaluation-result@@";

/** Emit one scenario result only when the CC suite runner requests the protocol. */
export function emitCcEvaluationResult(result: CcEvaluationResult): void {
  if (
    process.env.WORKFLOWS_CC_EVALUATION_PROTOCOL !==
    CC_EVALUATION_RESULT_PROTOCOL
  ) {
    return;
  }
  console.log(`${CC_EVALUATION_RESULT_PREFIX}${JSON.stringify(result)}`);
}

/** True when child stderr/stdout is only a known Postgres admin-disconnect. */
export function isKnownPostgresTeardownNoise(text: string): boolean {
  if (!text.trim()) return false;
  if (/\bASSERT:/i.test(text)) return false;
  return (
    /\b57P01\b/i.test(text) ||
    /terminating connection due to administrator command/i.test(text)
  );
}

/**
 * Prefer a protocol-valid CcEvaluationResult over a post-pass teardown exit.
 * Real assertion failures, missing protocol, and non-teardown crashes still fail.
 */
export function resolveCcScenarioOutcome(input: {
  scenarioId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}): CcEvaluationResult {
  let protocol: CcEvaluationResult | undefined;
  try {
    protocol = readCcEvaluationResult(input.stdout, input.scenarioId);
  } catch (error) {
    return {
      scenarioId: input.scenarioId,
      pass: false,
      durationMs: input.durationMs,
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }

  if (input.exitCode === 0) {
    if (!protocol) {
      return {
        scenarioId: input.scenarioId,
        pass: false,
        durationMs: input.durationMs,
        failureReason: "scenario did not emit a CcEvaluationResult",
      };
    }
    return protocol;
  }

  const trailing = `${input.stderr}\n${input.stdout}`;
  if (protocol?.pass === true && isKnownPostgresTeardownNoise(trailing)) {
    return protocol;
  }

  if (protocol && protocol.pass === false) {
    return protocol;
  }

  return {
    scenarioId: input.scenarioId,
    pass: false,
    durationMs: input.durationMs,
    failureReason:
      protocol?.failureReason ||
      input.stderr.trim().split(/\r?\n/).slice(-3).join(" | ") ||
      `exit ${input.exitCode}`,
  };
}

/** Read the last scenario result from captured child-process output. */
export function readCcEvaluationResult(
  output: string,
  expectedScenarioId?: string
): CcEvaluationResult | undefined {
  const lines = output.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim();
    if (!line?.startsWith(CC_EVALUATION_RESULT_PREFIX)) continue;
    const parsed = JSON.parse(
      line.slice(CC_EVALUATION_RESULT_PREFIX.length)
    ) as Partial<CcEvaluationResult>;
    if (
      typeof parsed.scenarioId !== "string" ||
      typeof parsed.pass !== "boolean" ||
      typeof parsed.durationMs !== "number"
    ) {
      throw new Error("invalid CC evaluation result payload");
    }
    if (expectedScenarioId && parsed.scenarioId !== expectedScenarioId) {
      throw new Error(
        `CC evaluation result scenario mismatch: expected ${expectedScenarioId}, received ${parsed.scenarioId}`
      );
    }
    return parsed as CcEvaluationResult;
  }
  return undefined;
}

export function createCcEvaluationReport(
  startedAt: string,
  finishedAt: string,
  results: CcEvaluationResult[]
): CcEvaluationReport {
  const passed = results.filter((result) => result.pass).length;
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    },
  };
}

import type {
  CcEvaluationReport,
  CcEvaluationResult,
} from "./types.js";

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

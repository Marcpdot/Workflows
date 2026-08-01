import type { EvalCase } from "./types.js";

/** Minimal shape for assertions (satisfied by OrchestratorResult). */
export interface AssertableResult {
  reply: string;
  routing?: { model?: string };
}

/**
 * Run expectRoute / expectContains against an orchestrator result.
 * Returns a list of human-readable failure reasons (empty = pass).
 */
export function runAssertions(
  evalCase: EvalCase,
  result: AssertableResult
): string[] {
  const failures: string[] = [];

  if (!result.reply || !result.reply.trim()) {
    failures.push("empty reply");
  }

  if (evalCase.expectRoute !== undefined) {
    const actual = result.routing?.model;
    if (actual !== evalCase.expectRoute) {
      failures.push(
        `expectRoute: expected "${evalCase.expectRoute}", got "${actual ?? "undefined"}"`
      );
    }
  }

  if (evalCase.expectContains && evalCase.expectContains.length > 0) {
    const reply = (result.reply ?? "").toLowerCase();
    for (const needle of evalCase.expectContains) {
      if (!needle) {
        failures.push("expectContains: empty string in list");
        continue;
      }
      if (!reply.includes(needle.toLowerCase())) {
        failures.push(`expectContains: missing "${needle}"`);
      }
    }
  }

  return failures;
}

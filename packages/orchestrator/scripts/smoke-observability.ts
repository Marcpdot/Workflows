/**
 * Offline smoke for M8 observability: emit → JSONL file → read back.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  JsonlFileObserver,
  NoopObserver,
  type OrchestratorEvent,
} from "@workflows/observability";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dir = resolve(process.cwd(), "data", "logs");
  mkdirSync(dir, { recursive: true });
  const logPath = resolve(dir, `_smoke_obs_${Date.now()}.jsonl`);

  try {
    const obs = new JsonlFileObserver(logPath, false);
    const event: OrchestratorEvent = {
      ts: new Date().toISOString(),
      kind: "request",
      sessionId: "smoke",
      route: "local",
      model: "mock",
      provider: "local",
      latencyMs: 12,
      tokens: 42,
      tools: ["read_file"],
      meta: { policyReason: "policy off · router → local" },
    };
    obs.emit(event);

    assert(existsSync(logPath), "log file should exist");
    const lines = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assert(lines.length === 1, `expected 1 line, got ${lines.length}`);
    const parsed = JSON.parse(lines[0]!) as OrchestratorEvent;
    assert(parsed.kind === "request", "kind");
    assert(parsed.sessionId === "smoke", "sessionId");
    assert(parsed.route === "local", "route");
    assert(parsed.tokens === 42, "tokens");
    assert(parsed.tools?.[0] === "read_file", "tools");
    assert(parsed.meta?.policyReason != null, "meta.policyReason");
    console.log("OK: JSONL request event round-trip");

    obs.emit({
      ts: new Date().toISOString(),
      kind: "tool",
      tools: ["list_dir"],
      meta: { ok: true, durationMs: 3 },
    });
    obs.emit({
      ts: new Date().toISOString(),
      kind: "error",
      error: "test error",
    });
    const all = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assert(all.length === 3, "three events");
    assert(JSON.parse(all[1]!).kind === "tool", "tool event");
    assert(JSON.parse(all[2]!).kind === "error", "error event");
    console.log("OK: tool + error events");

    const noop = new NoopObserver();
    noop.emit(event);
    console.log("OK: NoopObserver");

    console.log("All observability smoke checks passed.");
  } finally {
    if (existsSync(logPath)) {
      try {
        rmSync(logPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

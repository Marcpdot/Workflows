import { resolve } from "node:path";
import {
  CompositeObserver,
  JsonlFileObserver,
  NoopObserver,
} from "./jsonlObserver.js";
import type { ObservabilityConfig, Observer } from "./types.js";

function flag(v: string | undefined, defaultTrue = false): boolean {
  if (v === undefined || v === "") return defaultTrue;
  return v === "1" || v === "true" || v === "yes";
}

export function loadObservabilityConfig(
  env: NodeJS.ProcessEnv = process.env
): ObservabilityConfig {
  // Default enabled so operators see behavior; can turn off with OBS_ENABLED=false
  const enabled = flag(env.OBS_ENABLED, true);
  return {
    enabled,
    logPath: resolve(
      process.cwd(),
      env.OBS_LOG_PATH?.trim() || "./data/logs/orchestrator.jsonl"
    ),
    logPrompts: flag(env.OBS_LOG_PROMPTS, false),
    stderr:
      flag(env.OBS_STDERR, false) ||
      flag(env.OBS_VERBOSE, false) ||
      process.argv.includes("--verbose"),
  };
}

export function createObserverFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Observer {
  const cfg = loadObservabilityConfig(env);
  if (!cfg.enabled) return new NoopObserver();
  return new JsonlFileObserver(cfg.logPath, cfg.stderr);
}

export function createObserver(config: ObservabilityConfig): Observer {
  if (!config.enabled) return new NoopObserver();
  return new JsonlFileObserver(config.logPath, config.stderr);
}

/** Test helper: multiple sinks */
export function createCompositeObserver(...sinks: Observer[]): Observer {
  return new CompositeObserver(sinks);
}

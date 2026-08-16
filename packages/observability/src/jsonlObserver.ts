/**
 * JSONL file sink (+ optional stderr). Failures never throw to callers.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Observer, OrchestratorEvent } from "./types.js";

export class JsonlFileObserver implements Observer {
  private readonly path: string;
  private dirReady = false;

  constructor(
    logPath: string,
    private readonly alsoStderr = false
  ) {
    this.path = resolve(logPath);
  }

  emit(event: OrchestratorEvent): void {
    const line = JSON.stringify(event);
    try {
      if (!this.dirReady) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.dirReady = true;
      }
      appendFileSync(this.path, line + "\n", "utf8");
    } catch (err) {
      // Never break the request path
      console.error(
        `[obs] failed to write log: ${err instanceof Error ? err.message : err}`
      );
    }
    if (this.alsoStderr) {
      console.error(line);
    }
  }
}

export class CompositeObserver implements Observer {
  constructor(private readonly sinks: Observer[]) {}

  emit(event: OrchestratorEvent): void {
    for (const s of this.sinks) {
      try {
        s.emit(event);
      } catch {
        /* ignore sink errors */
      }
    }
  }
}

export class NoopObserver implements Observer {
  emit(_event: OrchestratorEvent): void {
    /* no-op */
  }
}

/** Test/eval sink. It retains structured events only; callers decide lifecycle. */
export class InMemoryObserver implements Observer {
  readonly events: OrchestratorEvent[] = [];

  emit(event: OrchestratorEvent): void {
    this.events.push(event);
  }
}

/** Telemetry is diagnostic and must never become part of the truth path. */
export function emitSafely(observer: Observer, event: OrchestratorEvent): boolean {
  try {
    observer.emit(event);
    return true;
  } catch (error) {
    console.error(
      `[obs] observer failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

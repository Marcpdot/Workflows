/**
 * Local model client via Ollama CLI (`ollama run`).
 * Uses subprocess — no HTTP dependency on the Ollama daemon API.
 */

import { spawn } from "node:child_process";
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
} from "./types.js";

export interface OllamaCliConfig {
  /** Binary name or path. Default: "ollama" */
  bin?: string;
  /** Default model tag, e.g. "llama3.1:8b" */
  defaultModel: string;
  /**
   * Max time for a single completion (ms).
   * Default: OLLAMA_TIMEOUT_MS env or 600_000 (10 min).
   * Tool loops need headroom on CPU / large local models.
   */
  timeoutMs?: number;
}

function resolveTimeoutMs(explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const fromEnv = process.env.OLLAMA_TIMEOUT_MS?.trim();
  if (fromEnv) {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 600_000;
}

function buildPrompt(request: ModelRequest): string {
  const parts: string[] = [];
  for (const msg of request.messages) {
    if (msg.role === "system") {
      parts.push(`System: ${msg.content}`);
    } else if (msg.role === "user") {
      parts.push(`User: ${msg.content}`);
    } else {
      parts.push(`Assistant: ${msg.content}`);
    }
  }
  parts.push("Assistant:");
  return parts.join("\n\n");
}

export class OllamaCliClient implements ModelClient {
  readonly provider = "local" as const;
  private readonly bin: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(config: OllamaCliConfig) {
    this.bin = config.bin ?? "ollama";
    this.defaultModel = config.defaultModel;
    this.timeoutMs = resolveTimeoutMs(config.timeoutMs);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model ?? this.defaultModel;
    const prompt = buildPrompt(request);

    const content = await this.runOllama(model, prompt);

    return {
      content: content.trim(),
      model,
      provider: "local",
    };
  }

  private runOllama(model: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, ["run", model], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(
            `Ollama CLI timed out after ${this.timeoutMs}ms (model=${model})`
          )
        );
      }, this.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `Ollama CLI exited ${code} (model=${model}): ${stderr.trim() || "no output"}`
            )
          );
          return;
        }
        resolve(stdout);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}

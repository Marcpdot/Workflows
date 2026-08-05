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
  /** Max time for a single completion (ms). Default: 120_000 */
  timeoutMs?: number;
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
    this.timeoutMs = config.timeoutMs ?? 120_000;
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
      // `ollama run <model> <prompt>` prints the reply to stdout.
      // On Windows, shell is needed if bin is a bare name without path.
      const child = spawn(this.bin, ["run", model, prompt], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(
          new Error(
            `Ollama CLI timed out after ${this.timeoutMs}ms (model=${model})`
          )
        );
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(
            new Error(
              `Ollama CLI not found (bin="${this.bin}"). Install Ollama and ensure it is on PATH, or set OLLAMA_BIN.`
            )
          );
          return;
        }
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `Ollama CLI exited with code ${code}: ${stderr.trim() || stdout.trim() || "no output"}`
            )
          );
          return;
        }
        // Ollama may mix spinner/ansi; strip common control sequences.
        const cleaned = stdout
          .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/\r/g, "");
        resolve(cleaned);
      });
    });
  }
}

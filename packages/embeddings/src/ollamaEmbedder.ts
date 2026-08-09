/**
 * Local Ollama embeddings client.
 * Tries POST /api/embed (batch) then falls back to /api/embeddings per text.
 */

import type { Embedder } from "./types.js";

export interface OllamaEmbedderConfig {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  dimensions?: number;
}

export class OllamaEmbedder implements Embedder {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly dimensions?: number;

  constructor(config: OllamaEmbedderConfig) {
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:11434").replace(
      /\/$/,
      ""
    );
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.dimensions = config.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Prefer batch /api/embed
    try {
      return await this.embedBatch(texts);
    } catch {
      // fall through to sequential legacy API
    }

    const out: number[][] = [];
    for (const text of texts) {
      out.push(await this.embedOneLegacy(text));
    }
    return out;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const body = await this.postJson(`${this.baseUrl}/api/embed`, {
      model: this.model,
      input: texts.length === 1 ? texts[0] : texts,
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
    });

    if (Array.isArray(body.embeddings)) {
      return body.embeddings as number[][];
    }
    if (Array.isArray(body.embedding)) {
      return [body.embedding as number[]];
    }
    throw new Error("Ollama /api/embed: missing embeddings in response");
  }

  private async embedOneLegacy(text: string): Promise<number[]> {
    const body = await this.postJson(`${this.baseUrl}/api/embeddings`, {
      model: this.model,
      prompt: text,
    });
    if (!Array.isArray(body.embedding)) {
      throw new Error(
        "Ollama /api/embeddings: missing embedding array in response"
      );
    }
    return body.embedding as number[];
  }

  private async postJson(
    url: string,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        const msg =
          typeof json.error === "string"
            ? json.error
            : `Ollama embeddings HTTP ${res.status}`;
        throw new Error(
          `${msg} (model=${this.model}). Is Ollama running and is the embed model pulled?`
        );
      }
      return json;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Ollama embeddings timed out after ${this.timeoutMs}ms (model=${this.model})`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * web_search — optional HTTP search; off by default (no network required).
 *
 * When enabled, POST/GET against WEB_SEARCH_ENDPOINT with WEB_SEARCH_API_KEY.
 * Expects a JSON array or { results: [...] } of { title, url, snippet }.
 * Never echoes API keys in output.
 */

import type { Tool, ToolResult } from "../types.js";

function enabled(): boolean {
  const v = process.env.WEB_SEARCH_ENABLED;
  return v === "1" || v === "true" || v === "yes";
}

function timeoutMs(): number {
  const n = Number(process.env.WEB_SEARCH_TIMEOUT_MS ?? "10000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10_000;
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function normalizeHits(body: unknown, max: number): SearchHit[] {
  let list: unknown[] = [];
  if (Array.isArray(body)) list = body;
  else if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.results)) list = o.results;
    else if (Array.isArray(o.items)) list = o.items;
    else if (Array.isArray(o.data)) list = o.data;
  }

  const hits: SearchHit[] = [];
  for (const item of list) {
    if (hits.length >= max) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? r.name ?? "");
    const url = String(r.url ?? r.link ?? r.href ?? "");
    const snippet = String(
      r.snippet ?? r.description ?? r.content ?? r.summary ?? ""
    ).slice(0, 300);
    if (!title && !url) continue;
    hits.push({ title, url, snippet });
  }
  return hits;
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web (only when WEB_SEARCH_ENABLED=true). Returns title, url, short snippet.",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query",
      required: true,
    },
    {
      name: "maxResults",
      type: "number",
      description: "Max results (default 5)",
      required: false,
    },
  ],
  async execute(args): Promise<ToolResult> {
    const query = args.query;
    if (typeof query !== "string" || !query.trim()) {
      return {
        ok: false,
        output: "",
        error: "web_search: parameter 'query' (string) is required",
      };
    }

    if (!enabled()) {
      return {
        ok: false,
        output: "",
        error:
          "web_search: disabled (set WEB_SEARCH_ENABLED=true and configure WEB_SEARCH_ENDPOINT)",
      };
    }

    const endpoint = process.env.WEB_SEARCH_ENDPOINT?.trim();
    if (!endpoint) {
      return {
        ok: false,
        output: "",
        error: "web_search: WEB_SEARCH_ENDPOINT is not configured",
      };
    }

    let maxResults = 5;
    if (args.maxResults !== undefined && args.maxResults !== null) {
      const n = Number(args.maxResults);
      if (Number.isFinite(n) && n > 0) maxResults = Math.min(Math.floor(n), 20);
    }

    const apiKey = process.env.WEB_SEARCH_API_KEY?.trim() ?? "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("max_results", String(maxResults));

      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const res = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          output: "",
          error: `web_search: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const body = (await res.json()) as unknown;
      const hits = normalizeHits(body, maxResults);

      if (hits.length === 0) {
        return {
          ok: true,
          output: `No web results for "${query}"`,
          data: { query, hits: [] },
        };
      }

      const output = hits
        .map(
          (h, i) =>
            `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`.trimEnd()
        )
        .join("\n\n");

      return {
        ok: true,
        output,
        data: { query, hits },
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          ok: false,
          output: "",
          error: `web_search: timed out after ${timeoutMs()}ms`,
        };
      }
      return {
        ok: false,
        output: "",
        error: `web_search: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

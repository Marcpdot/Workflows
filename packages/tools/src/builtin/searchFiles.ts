/**
 * search_files — dependency-free recursive text search under workspace.
 * Skips node_modules, .git, data/, dist/, and common binary noise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { resolveSafePath } from "../pathSafety.js";
import type { Tool, ToolResult } from "../types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "data",
  "dist",
  ".grok",
  "coverage",
  ".next",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".html",
  ".env",
  ".example",
  ".rhai",
]);

const MAX_FILE_BYTES = 512 * 1024;

function isProbablyText(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot >= 0 && TEXT_EXT.has(lower.slice(dot))) return true;
  // Allow extensionless small files like Dockerfile? keep conservative
  return lower.endsWith("dockerfile") || lower.endsWith("makefile");
}

function walkFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (st.isFile() && st.size <= MAX_FILE_BYTES && isProbablyText(full)) {
      out.push(full);
    }
  }
}

export const searchFilesTool: Tool = {
  name: "search_files",
  description:
    "Search file names and text contents under a workspace path (skips node_modules/.git/data).",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Substring to search for (case-insensitive)",
      required: true,
    },
    {
      name: "path",
      type: "string",
      description: 'Subdirectory relative to workspace (default ".")',
      required: false,
    },
    {
      name: "maxResults",
      type: "number",
      description: "Maximum hits to return (default 20)",
      required: false,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const query = args.query;
    if (typeof query !== "string" || !query.trim()) {
      return {
        ok: false,
        output: "",
        error: "search_files: parameter 'query' (string) is required",
      };
    }

    const rawPath =
      args.path === undefined || args.path === null || args.path === ""
        ? "."
        : args.path;
    if (typeof rawPath !== "string") {
      return {
        ok: false,
        output: "",
        error: "search_files: path must be a string",
      };
    }

    let maxResults = 20;
    if (args.maxResults !== undefined && args.maxResults !== null) {
      const n = Number(args.maxResults);
      if (!Number.isFinite(n) || n < 1) {
        return {
          ok: false,
          output: "",
          error: "search_files: maxResults must be a positive number",
        };
      }
      maxResults = Math.min(Math.floor(n), 200);
    }

    let root: string;
    try {
      root = resolveSafePath(ctx.workspaceRoot, rawPath);
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const st = statSync(root);
      if (!st.isDirectory() && !st.isFile()) {
        return {
          ok: false,
          output: "",
          error: `search_files: not a file or directory: ${rawPath}`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: `search_files: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const needle = query.toLowerCase();
    const files: string[] = [];
    try {
      if (statSync(root).isFile()) {
        files.push(root);
      } else {
        walkFiles(root, files);
      }
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: `search_files: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const hits: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      if (hits.length >= maxResults) break;
      const rel = relative(ctx.workspaceRoot, file).split(sep).join("/") || file;

      // Filename match counts as a hit
      if (rel.toLowerCase().includes(needle)) {
        hits.push({ file: rel, line: 0, snippet: `(filename match)` });
        if (hits.length >= maxResults) break;
      }

      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      // Skip obvious binary
      if (text.includes("\u0000")) continue;

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= maxResults) break;
        const line = lines[i]!;
        if (line.toLowerCase().includes(needle)) {
          const snippet = line.trim().slice(0, 200);
          hits.push({ file: rel, line: i + 1, snippet });
        }
      }
    }

    if (hits.length === 0) {
      return {
        ok: true,
        output: `No matches for "${query}" under ${rawPath}`,
        data: { query, hits: [] },
      };
    }

    const output = hits
      .map((h) =>
        h.line > 0
          ? `${h.file}:${h.line}: ${h.snippet}`
          : `${h.file}: ${h.snippet}`
      )
      .join("\n");

    return {
      ok: true,
      output,
      data: { query, count: hits.length, hits },
    };
  },
};

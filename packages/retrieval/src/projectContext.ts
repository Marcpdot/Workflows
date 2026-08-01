/**
 * Keyword retrieval over Keep the Why `context/*.md` files.
 * FS reading is isolated here; missing context dir → empty list.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { RetrievedChunk } from "./types.js";
import { scoreText, truncateSnippet, uniqueTokens } from "./tokenize.js";

export function resolveDefaultContextDir(cwd = process.cwd()): string {
  // Prefer env override handled by caller; here resolve common layouts.
  const candidates = [
    resolve(cwd, "context"),
    resolve(cwd, "..", "context"),
    resolve(cwd, "../..", "context"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      return dir;
    }
  }
  return resolve(cwd, "..", "context");
}

function listTopicFiles(contextDir: string): string[] {
  if (!existsSync(contextDir) || !statSync(contextDir).isDirectory()) {
    return [];
  }

  const names = readdirSync(contextDir);
  return names
    .filter((n) => n.endsWith(".md"))
    .filter((n) => {
      const lower = n.toLowerCase();
      // Skip landing README; index is useful but topics hold the meat.
      return lower !== "readme.md";
    })
    .map((n) => join(contextDir, n))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

export function retrieveFromProjectContext(
  query: string,
  contextDir: string,
  maxChunkChars: number
): RetrievedChunk[] {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return [];

  const dir = resolve(contextDir);
  const files = listTopicFiles(dir);
  const chunks: RetrievedChunk[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const score = scoreText(queryTokens, content);
    if (score <= 0) continue;

    const rel = relative(dir, filePath).replace(/\\/g, "/") || basename(filePath);
    chunks.push({
      source: "project_context",
      id: rel,
      text: truncateSnippet(content, maxChunkChars),
      score,
    });
  }

  return chunks;
}

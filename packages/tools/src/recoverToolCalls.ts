/**
 * Recover tool calls when models emit broken JSON, and infer explicit
 * read_file intent from the user prompt so self-access does not depend on
 * perfect tool_call formatting.
 */

import { randomUUID } from "node:crypto";
import type { ToolCall } from "./types.js";

const READ_VERB_RE =
  /\b(read|open|inspect|show|cat|les|åpne|inspiser|vis)\b/i;

/** Workspace-relative paths that look like repo files. */
const PATH_RE =
  /(?:^|\s|[`"'(])((?:packages\/|apps\/|docs\/|src\/|scripts\/|\.?\/?)?[\w./-]+\.(?:md|ts|tsx|js|mjs|cjs|json|yml|yaml|toml|txt|css|html))(?:$|\s|[`"')])/gi;

function callId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/**
 * Pull read_file / list_dir style calls out of messy model text when JSON.parse fails.
 */
export function recoverToolCallsFromBrokenText(text: string): ToolCall[] {
  if (!text || !text.trim()) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  // name + path nearby (order-independent-ish)
  const namePath =
    /"name"\s*:\s*"(read_file|list_dir|search_files)"[\s\S]{0,200}?"(?:path|query)"\s*:\s*"([^"\n]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = namePath.exec(text)) !== null) {
    const name = m[1]!;
    const value = m[2]!.trim();
    if (!value) continue;
    const key = `${name}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      id: callId("rec"),
      name,
      args: name === "search_files" ? { query: value } : { path: value },
    });
  }

  // path first then name
  const pathName =
    /"path"\s*:\s*"([^"\n]+)"[\s\S]{0,120}?"name"\s*:\s*"(read_file|list_dir)"/gi;
  while ((m = pathName.exec(text)) !== null) {
    const value = m[1]!.trim();
    const name = m[2]!;
    if (!value) continue;
    const key = `${name}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({
      id: callId("rec"),
      name,
      args: { path: value },
    });
  }

  // Bare tool_calls intent: read_file + a path string anywhere in the blob
  if (calls.length === 0 && /read_file/i.test(text)) {
    for (const path of extractPaths(text)) {
      const key = `read_file:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({
        id: callId("rec"),
        name: "read_file",
        args: { path },
      });
    }
  }

  return calls;
}

export function extractPaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    let p = m[1]!.replace(/^\.\//, "").replace(/^[`"'(]+|[`"')]+$/g, "");
    // Fix common truncation artifacts: packages/surface/RE + README.md glued elsewhere
    if (/\/RE$/i.test(p) && /README\.md/i.test(text)) {
      p = p.replace(/\/RE$/i, "/README.md");
    }
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }
  return paths;
}

/**
 * When the user explicitly asks to read/open a file path, force read_file
 * so the system reaches its own bits without relying on model JSON.
 */
export function inferReadFileCallsFromUserPrompt(prompt: string): ToolCall[] {
  if (!prompt || !READ_VERB_RE.test(prompt)) return [];
  const paths = extractPaths(prompt);
  return paths.map((path) => ({
    id: callId("seed"),
    name: "read_file",
    args: { path },
  }));
}

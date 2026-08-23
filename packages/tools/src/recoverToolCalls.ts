/**
 * Recover tool calls when models emit broken JSON, and infer workspace
 * tool intent from the user prompt so self-access does not depend on
 * perfect tool_call formatting.
 */

import { randomUUID } from "node:crypto";
import type { ToolCall } from "./types.js";

const READ_VERB_RE =
  /\b(read|open|inspect|show|cat|les|åpne|inspiser|vis)\b/i;

const LIST_VERB_RE =
  /\b(list|ls|dir|tree|hvilke|hva finnes|what(?:'s| is) in|show (?:me )?(?:the )?(?:files|dirs|directories|packages))\b/i;

const EXISTS_RE =
  /\b(does|is there|finnes|exists?)\b[\s\S]{0,40}?\b(packages\/[\w./-]+|[\w.-]+\/(?:src|README))?/i;

const SEARCH_VERB_RE =
  /\b(search|find|grep|locate|søk|finn)\b/i;

/** Workspace-relative paths that look like repo files. */
const PATH_RE =
  /(?:^|\s|[`"'(])((?:packages\/|apps\/|docs\/|src\/|scripts\/|\.?\/?)?[\w./-]+\.(?:md|ts|tsx|js|mjs|cjs|json|yml|yaml|toml|txt|css|html))(?:$|\s|[`"')])/gi;

/** Directory-like paths (packages/foo, packages/foo/src, docs, …). */
const DIR_PATH_RE =
  /(?:^|\s|[`"'(])((?:packages\/|apps\/|docs\/|src\/|scripts\/)[\w./-]*)(?:$|\s|[`"')?,.!])/gi;

const PACKAGE_NAME_RE =
  /\bpackages\/([a-z][\w-]*)\b/gi;

/** Soft aliases: spoken name → concrete path to read. */
const READ_ALIASES: Array<{ re: RegExp; path: string }> = [
  {
    re: /\b(surface[- ]?readme|readme (?:for |to )?surface|surface package readme)\b/i,
    path: "packages/surface/README.md",
  },
  {
    re: /\b(surface[- ]?contract|work surface contract)\b/i,
    path: "packages/orchestrator/src/integration/surface-contract.md",
  },
  {
    re: /\b(root )?agents\.md\b/i,
    path: "AGENTS.md",
  },
  {
    re: /\b(orchestrator readme)\b/i,
    path: "packages/orchestrator/README.md",
  },
];

function callId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function pushUnique(
  calls: ToolCall[],
  seen: Set<string>,
  name: string,
  args: Record<string, unknown>,
  prefix: string
): void {
  const key = `${name}:${JSON.stringify(args)}`;
  if (seen.has(key)) return;
  seen.add(key);
  calls.push({ id: callId(prefix), name, args });
}

/**
 * Pull read_file / list_dir style calls out of messy model text when JSON.parse fails.
 */
export function recoverToolCallsFromBrokenText(text: string): ToolCall[] {
  if (!text || !text.trim()) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  const namePath =
    /"name"\s*:\s*"(read_file|list_dir|search_files)"[\s\S]{0,200}?"(?:path|query)"\s*:\s*"([^"\n]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = namePath.exec(text)) !== null) {
    const name = m[1]!;
    const value = m[2]!.trim();
    if (!value) continue;
    pushUnique(
      calls,
      seen,
      name,
      name === "search_files" ? { query: value } : { path: value },
      "rec"
    );
  }

  const pathName =
    /"path"\s*:\s*"([^"\n]+)"[\s\S]{0,120}?"name"\s*:\s*"(read_file|list_dir)"/gi;
  while ((m = pathName.exec(text)) !== null) {
    const value = m[1]!.trim();
    const name = m[2]!;
    if (!value) continue;
    pushUnique(calls, seen, name, { path: value }, "rec");
  }

  if (calls.length === 0 && /read_file/i.test(text)) {
    for (const path of extractPaths(text)) {
      pushUnique(calls, seen, "read_file", { path }, "rec");
    }
  }

  if (calls.length === 0 && /list_dir/i.test(text)) {
    for (const path of extractDirPaths(text)) {
      pushUnique(calls, seen, "list_dir", { path }, "rec");
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
    if (/\/RE$/i.test(p) && /README\.md/i.test(text)) {
      p = p.replace(/\/RE$/i, "/README.md");
    }
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }
  return paths;
}

export function extractDirPaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  DIR_PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIR_PATH_RE.exec(text)) !== null) {
    let p = m[1]!.replace(/\/+$/, "").replace(/^[`"'(]+|[`"')]+$/g, "");
    // Drop if it looks like a file path (has extension)
    if (/\.[a-z]{1,5}$/i.test(p)) continue;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }
  // packages/foo from prose without trailing slash
  PACKAGE_NAME_RE.lastIndex = 0;
  while ((m = PACKAGE_NAME_RE.exec(text)) !== null) {
    const p = `packages/${m[1]}`;
    if (seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }
  return paths;
}

/**
 * When the user explicitly asks to read/open a file path, force read_file.
 */
export function inferReadFileCallsFromUserPrompt(prompt: string): ToolCall[] {
  if (!prompt || !prompt.trim()) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  for (const alias of READ_ALIASES) {
    if (alias.re.test(prompt) && (READ_VERB_RE.test(prompt) || /\breadme\b/i.test(prompt) || /contract/i.test(prompt))) {
      pushUnique(calls, seen, "read_file", { path: alias.path }, "seed");
    }
  }

  if (READ_VERB_RE.test(prompt)) {
    for (const path of extractPaths(prompt)) {
      pushUnique(calls, seen, "read_file", { path }, "seed");
    }
  }

  return calls;
}

/**
 * list_dir when user asks to list / does X exist / packages under …
 */
export function inferListDirCallsFromUserPrompt(prompt: string): ToolCall[] {
  if (!prompt || !prompt.trim()) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  const wantsList =
    LIST_VERB_RE.test(prompt) ||
    EXISTS_RE.test(prompt) ||
    /\btop-level packages\b/i.test(prompt) ||
    /\bpackages\/?\s+under\b/i.test(prompt);

  if (!wantsList) return [];

  // Explicit "list packages" / top-level packages
  if (
    /\b(list|show).{0,40}\bpackages\b/i.test(prompt) ||
    /\btop-level packages\b/i.test(prompt) ||
    /\bpackages\/?\s*$/i.test(prompt.trim()) ||
    /\bunder packages\/?\b/i.test(prompt)
  ) {
    pushUnique(calls, seen, "list_dir", { path: "packages" }, "seed");
  }

  for (const path of extractDirPaths(prompt)) {
    pushUnique(calls, seen, "list_dir", { path }, "seed");
  }

  // "does packages/voice exist" without other dir hits
  if (calls.length === 0) {
    const voice = prompt.match(/\bpackages\/([a-z][\w-]*)\b/i);
    if (voice) {
      pushUnique(calls, seen, "list_dir", { path: `packages/${voice[1]}` }, "seed");
    }
  }

  return calls;
}

/**
 * search_files when user asks to search/find a symbol or phrase in the repo.
 */
export function inferSearchCallsFromUserPrompt(prompt: string): ToolCall[] {
  if (!prompt || !SEARCH_VERB_RE.test(prompt)) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  // search for "foo" or search for foo
  const quoted = prompt.match(
    /\b(?:search|find|grep|søk|finn)\b[\s\S]{0,30}?["'`]([^"'`]{2,80})["'`]/i
  );
  if (quoted?.[1]) {
    pushUnique(calls, seen, "search_files", { query: quoted[1].trim() }, "seed");
    return calls;
  }

  const forTerm = prompt.match(
    /\b(?:search|find|grep|søk|finn)\s+(?:the\s+repo\s+for\s+|for\s+|etter\s+)?([\w./-]{3,60})/i
  );
  if (forTerm?.[1] && !/^(the|repo|code|files|in)$/i.test(forTerm[1])) {
    pushUnique(calls, seen, "search_files", { query: forTerm[1] }, "seed");
  }

  return calls;
}

/**
 * Unified workspace seed: read + list + search from natural user prompts.
 * Prefer specific file reads; also open list/search when intent is clear.
 */
export function inferWorkspaceToolCallsFromUserPrompt(
  prompt: string
): ToolCall[] {
  const seen = new Set<string>();
  const out: ToolCall[] = [];
  for (const c of [
    ...inferReadFileCallsFromUserPrompt(prompt),
    ...inferListDirCallsFromUserPrompt(prompt),
    ...inferSearchCallsFromUserPrompt(prompt),
  ]) {
    const key = `${c.name}:${JSON.stringify(c.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

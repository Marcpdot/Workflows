/**
 * Resolve active workspace + namespaced session for multi-project use.
 */

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { resolveDefaultContextDir } from "../retrieval/projectContext.js";
import type { ResolveWorkspaceInput, WorkspaceContext } from "./types.js";

/** Stable 12-char hex id from absolute root (case-normalized for Windows). */
export function workspaceIdFromRoot(rootPath: string): string {
  const abs = resolve(rootPath);
  const key = process.platform === "win32" ? abs.toLowerCase() : abs;
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export function sessionNamespaceDisabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env.SESSION_NAMESPACE?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

/**
 * Resolve project context directory for retrieval.
 * Order: explicit → RETRIEVAL_CONTEXT_DIR → {workspace}/context if present → default layout.
 */
export function resolveProjectContextDir(options: {
  rootPath: string;
  contextDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  if (options.contextDir?.trim()) {
    const raw = options.contextDir.trim();
    return isAbsolute(raw) ? resolve(raw) : resolve(options.rootPath, raw);
  }

  if (env.RETRIEVAL_CONTEXT_DIR?.trim()) {
    const raw = env.RETRIEVAL_CONTEXT_DIR.trim();
    return isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
  }

  const wsContext = join(options.rootPath, "context");
  try {
    if (existsSync(wsContext) && statSync(wsContext).isDirectory()) {
      return wsContext;
    }
  } catch {
    /* fall through */
  }

  return resolveDefaultContextDir(cwd);
}

/**
 * Build WorkspaceContext from CLI/HTTP/env inputs.
 * Session ids are namespaced per workspace so the same logical id
 * ("default") does not mix histories across projects in one memory.db.
 */
export function resolveWorkspace(
  input: ResolveWorkspaceInput = {}
): WorkspaceContext {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();

  const rootPath = resolve(
    cwd,
    input.workspaceRoot?.trim() ||
      env.WORKSPACE_ROOT?.trim() ||
      env.TOOL_WORKSPACE_ROOT?.trim() ||
      "."
  );

  const id = workspaceIdFromRoot(rootPath);
  const noNs = sessionNamespaceDisabled(env);
  const sessionPrefix = noNs ? "" : `ws:${id}:`;
  const logicalSessionId =
    input.sessionId?.trim() || env.SESSION_ID?.trim() || "default";
  const sessionId = noNs
    ? logicalSessionId
    : `${sessionPrefix}${logicalSessionId}`;

  const contextDir = resolveProjectContextDir({
    rootPath,
    contextDir: input.contextDir,
    cwd,
    env,
  });

  return {
    id,
    rootPath,
    contextDir,
    sessionPrefix,
    logicalSessionId,
    sessionId,
  };
}

/** Optional project-scoped LTM path when LONGTERM_PROJECT_SCOPED is set. */
export function resolveProjectLongTermDbPath(
  rootPath: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const flag = env.LONGTERM_PROJECT_SCOPED?.trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    return null;
  }
  const rel =
    env.LONGTERM_PROJECT_DB?.trim() || ".orchestrator/longterm.db";
  return isAbsolute(rel) ? resolve(rel) : resolve(rootPath, rel);
}

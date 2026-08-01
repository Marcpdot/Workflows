/**
 * Resolve a user-supplied path under workspaceRoot; reject escapes.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Resolve relative (or root-relative) path under workspaceRoot.
 * Throws if the result would escape the workspace root.
 */
export function resolveSafePath(
  workspaceRoot: string,
  relativePath: string
): string {
  if (relativePath == null || String(relativePath).trim() === "") {
    throw new Error("path is required");
  }

  const root = resolve(workspaceRoot);
  const input = String(relativePath).trim();

  // Absolute paths are only allowed if they already sit under root.
  const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);

  const rel = relative(root, candidate);
  // Escape: goes above root, or absolute residual on another drive (Windows).
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Path escapes workspace root: "${input}" (root=${root})`
    );
  }

  // Normalize empty rel (root itself) to root path.
  return candidate;
}

/** True if resolved path is the workspace root or a child of it. */
export function isInsideWorkspace(
  workspaceRoot: string,
  absolutePath: string
): boolean {
  try {
    resolveSafePath(workspaceRoot, absolutePath);
    return true;
  } catch {
    // For absolutePath already absolute under root, relative check:
    const root = resolve(workspaceRoot);
    const target = resolve(absolutePath);
    const rel = relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }
}

export function toPosixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/") || ".";
}

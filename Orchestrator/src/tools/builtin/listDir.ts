/**
 * list_dir — non-recursive directory listing under workspace root.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveSafePath } from "../pathSafety.js";
import type { Tool, ToolResult } from "../types.js";

export const listDirTool: Tool = {
  name: "list_dir",
  description:
    "List files and directories under a path in the workspace (non-recursive).",
  parameters: [
    {
      name: "path",
      type: "string",
      description: 'Directory relative to workspace root (default ".")',
      required: false,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const rawPath =
      args.path === undefined || args.path === null || args.path === ""
        ? "."
        : args.path;

    if (typeof rawPath !== "string") {
      return {
        ok: false,
        output: "",
        error: "list_dir: parameter 'path' must be a string when provided",
      };
    }

    let abs: string;
    try {
      abs = resolveSafePath(ctx.workspaceRoot, rawPath);
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const st = statSync(abs);
      if (!st.isDirectory()) {
        return {
          ok: false,
          output: "",
          error: `list_dir: not a directory: ${rawPath}`,
        };
      }

      const names = readdirSync(abs).sort((a, b) => a.localeCompare(b));
      const entries = names.map((name) => {
        let kind: "file" | "dir" | "other" = "other";
        try {
          const child = statSync(join(abs, name));
          if (child.isDirectory()) kind = "dir";
          else if (child.isFile()) kind = "file";
        } catch {
          kind = "other";
        }
        return { name, kind };
      });

      const lines = entries.map(
        (e) => `${e.kind === "dir" ? "dir " : e.kind === "file" ? "file" : "??? "}  ${e.name}`
      );

      return {
        ok: true,
        output: lines.join("\n") || "(empty)",
        data: { path: rawPath, entries },
      };
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: `list_dir: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

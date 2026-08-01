/**
 * read_file — read a UTF-8 text file under workspace root.
 */

import { readFileSync, statSync } from "node:fs";
import { resolveSafePath } from "../pathSafety.js";
import type { Tool, ToolResult } from "../types.js";

function maxBytes(): number {
  const n = Number(process.env.TOOL_READ_MAX_BYTES ?? "262144");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 262_144;
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file under the workspace root.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path relative to workspace root",
      required: true,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const rawPath = args.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      return {
        ok: false,
        output: "",
        error: "read_file: parameter 'path' (string) is required",
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
      if (!st.isFile()) {
        return {
          ok: false,
          output: "",
          error: `read_file: not a file: ${rawPath}`,
        };
      }
      const limit = maxBytes();
      if (st.size > limit) {
        return {
          ok: false,
          output: "",
          error: `read_file: file exceeds max size (${st.size} > ${limit} bytes)`,
        };
      }
      const content = readFileSync(abs, "utf8");
      return {
        ok: true,
        output: content,
        data: { path: rawPath, bytes: Buffer.byteLength(content, "utf8") },
      };
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: `read_file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

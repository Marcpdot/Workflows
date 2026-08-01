/**
 * write_file — create/overwrite a UTF-8 text file under workspace root.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSafePath } from "../pathSafety.js";
import type { Tool, ToolResult } from "../types.js";

function maxBytes(): number {
  const n = Number(process.env.TOOL_WRITE_MAX_BYTES ?? "262144");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 262_144;
}

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write or overwrite a UTF-8 text file under the workspace root (size-capped).",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Path relative to workspace root",
      required: true,
    },
    {
      name: "content",
      type: "string",
      description: "File contents to write",
      required: true,
    },
    {
      name: "overwrite",
      type: "boolean",
      description: "If false, fail when the file already exists (default true)",
      required: false,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const rawPath = args.path;
    if (typeof rawPath !== "string" || !rawPath.trim()) {
      return {
        ok: false,
        output: "",
        error: "write_file: parameter 'path' (string) is required",
      };
    }
    if (typeof args.content !== "string") {
      return {
        ok: false,
        output: "",
        error: "write_file: parameter 'content' (string) is required",
      };
    }

    const overwrite =
      args.overwrite === undefined
        ? true
        : args.overwrite === true ||
          args.overwrite === "true" ||
          args.overwrite === 1 ||
          args.overwrite === "1";

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

    const content = args.content;
    const bytes = Buffer.byteLength(content, "utf8");
    const limit = maxBytes();
    if (bytes > limit) {
      return {
        ok: false,
        output: "",
        error: `write_file: content exceeds max size (${bytes} > ${limit} bytes)`,
      };
    }

    if (!overwrite && existsSync(abs)) {
      return {
        ok: false,
        output: "",
        error: `write_file: file exists and overwrite=false: ${rawPath}`,
      };
    }

    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return {
        ok: true,
        output: `Wrote ${bytes} bytes to ${rawPath}`,
        data: { path: rawPath, bytes, overwrite },
      };
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: `write_file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

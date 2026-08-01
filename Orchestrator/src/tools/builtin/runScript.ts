/**
 * run_script — execute a whitelisted script under TOOL_SCRIPT_ROOTS only.
 * Interpreters: node (.js/.mjs/.cjs), npx tsx (.ts/.tsx). No arbitrary shell.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, relative } from "node:path";
import { promisify } from "node:util";
import { resolveSafePath } from "../pathSafety.js";
import { parseCommandLine } from "./runCommand.js";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

function scriptRoots(): string[] {
  const raw = process.env.TOOL_SCRIPT_ROOTS?.trim() || "scripts";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function timeoutMs(): number {
  const n = Number(process.env.TOOL_COMMAND_TIMEOUT_MS ?? "15000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15_000;
}

function isUnderAllowedRoot(
  workspaceRoot: string,
  absScript: string,
  roots: string[]
): boolean {
  for (const r of roots) {
    try {
      const allowAbs = resolveSafePath(workspaceRoot, r);
      const rel = relative(allowAbs, absScript);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
        return true;
      }
    } catch {
      // invalid root entry
    }
  }
  return false;
}

function pickInterpreter(
  scriptPath: string
): { bin: string; prefixArgs: string[] } | null {
  const ext = extname(scriptPath).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { bin: "node", prefixArgs: [] };
  }
  if (ext === ".ts" || ext === ".tsx") {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    return { bin: npx, prefixArgs: ["tsx"] };
  }
  return null;
}

export const runScriptTool: Tool = {
  name: "run_script",
  description:
    "Run a script under allowed roots (default scripts/) with node or npx tsx only.",
  parameters: [
    {
      name: "script",
      type: "string",
      description: "Relative path to script (must be under TOOL_SCRIPT_ROOTS)",
      required: true,
    },
    {
      name: "args",
      type: "string",
      description: "Optional arguments string passed to the script",
      required: false,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const script = args.script;
    if (typeof script !== "string" || !script.trim()) {
      return {
        ok: false,
        output: "",
        error: "run_script: parameter 'script' (string) is required",
      };
    }

    const roots = scriptRoots();
    let abs: string;
    try {
      abs = resolveSafePath(ctx.workspaceRoot, script.trim());
    } catch (err) {
      return {
        ok: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!isUnderAllowedRoot(ctx.workspaceRoot, abs, roots)) {
      return {
        ok: false,
        output: "",
        error: `run_script: script must be under TOOL_SCRIPT_ROOTS (${roots.join(", ")}): ${script}`,
      };
    }

    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return {
        ok: false,
        output: "",
        error: `run_script: script not found: ${script}`,
      };
    }

    const interp = pickInterpreter(abs);
    if (!interp) {
      return {
        ok: false,
        output: "",
        error:
          "run_script: unsupported extension (use .js/.mjs/.cjs/.ts/.tsx)",
      };
    }

    const extraArgs =
      typeof args.args === "string" && args.args.trim()
        ? parseCommandLine(args.args.trim())
        : [];

    const binArgs = [...interp.prefixArgs, abs, ...extraArgs];
    const timeout = timeoutMs();

    try {
      const { stdout, stderr } = await execFileAsync(interp.bin, binArgs, {
        cwd: ctx.workspaceRoot,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: process.env,
      });
      const out = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
      return {
        ok: true,
        output: out || "(no output)",
        data: { script, bin: interp.bin, args: binArgs },
      };
    } catch (err: unknown) {
      const e = err as {
        message?: string;
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };
      const output = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
      if (e.killed) {
        return {
          ok: false,
          output,
          error: `run_script: timed out after ${timeout}ms`,
        };
      }
      return {
        ok: false,
        output,
        error:
          e.message ??
          `run_script: failed with code ${String(e.code ?? "unknown")}`,
      };
    }
  },
};

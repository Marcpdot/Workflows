/**
 * run_command — whitelist-only process execution (Milestone 2 phase A).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

const ALLOWED_BINARIES = new Set(["node", "npm", "npx", "tsc", "git"]);

/** git subcommands allowed in phase A (no commit/push). */
const GIT_ALLOWED_SUB = new Set(["status", "diff", "log", "branch"]);

function timeoutMs(): number {
  const n = Number(process.env.TOOL_COMMAND_TIMEOUT_MS ?? "15000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15_000;
}

/**
 * Tokenize a command line with simple single/double quote support.
 * Does not invoke a shell.
 */
export function parseCommandLine(command: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

function resolveBinary(name: string): string {
  if (process.platform === "win32") {
    if (name === "npm") return "npm.cmd";
    if (name === "npx") return "npx.cmd";
  }
  return name;
}

function validateArgv(argv: string[]): string | null {
  if (argv.length === 0) {
    return "run_command: empty command";
  }
  const bin = argv[0]!;
  if (!ALLOWED_BINARIES.has(bin)) {
    return `run_command: command not on whitelist: "${bin}". Allowed: ${[...ALLOWED_BINARIES].join(", ")}`;
  }
  if (bin === "git") {
    const sub = argv[1];
    if (!sub || !GIT_ALLOWED_SUB.has(sub)) {
      return `run_command: git subcommand not allowed: "${sub ?? ""}". Allowed: ${[...GIT_ALLOWED_SUB].join(", ")}`;
    }
  }
  return null;
}

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Run a whitelisted command (node, npm, npx, tsc, git status|diff|log|branch) in the workspace.",
  parameters: [
    {
      name: "command",
      type: "string",
      description: "Command line, e.g. 'git status' or 'node -v'",
      required: true,
    },
  ],
  async execute(args, ctx): Promise<ToolResult> {
    const raw = args.command;
    if (typeof raw !== "string" || !raw.trim()) {
      return {
        ok: false,
        output: "",
        error: "run_command: parameter 'command' (string) is required",
      };
    }

    const argv = parseCommandLine(raw.trim());
    const validationError = validateArgv(argv);
    if (validationError) {
      return { ok: false, output: "", error: validationError };
    }

    const bin = resolveBinary(argv[0]!);
    const binArgs = argv.slice(1);
    const timeout = timeoutMs();

    try {
      const { stdout, stderr } = await execFileAsync(bin, binArgs, {
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
        data: { argv: [argv[0], ...binArgs], cwd: ctx.workspaceRoot },
      };
    } catch (err: unknown) {
      const e = err as {
        message?: string;
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };
      if (e.killed) {
        return {
          ok: false,
          output: [e.stdout, e.stderr].filter(Boolean).join("\n"),
          error: `run_command: timed out after ${timeout}ms`,
        };
      }
      const output = [e.stdout, e.stderr].filter(Boolean).join("\n").trim();
      return {
        ok: false,
        output,
        error:
          e.message ??
          `run_command: failed with code ${String(e.code ?? "unknown")}`,
        data: { argv: [argv[0], ...binArgs], code: e.code },
      };
    }
  },
};

/**
 * CLI entry point.
 *
 * Usage:
 *   npx tsx src/index.ts "your prompt"
 *   npx tsx src/index.ts --session my-chat "continue conversation"
 *   npx tsx src/index.ts --route-only "your prompt"
 *   npx tsx src/index.ts --local "force local"
 *   npx tsx src/index.ts --frontier "force grok"
 *   npx tsx src/index.ts   # interactive REPL
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Orchestrator, loadConfigFromEnv } from "./orchestrator.js";
import { createMemory, type Memory } from "./memory/index.js";
import type { ModelChoice } from "./types.js";

function loadDotEnv(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function printHelp(): void {
  console.log(`
Orchestrator CLI — local Ollama + frontier Grok (xAI)

Usage:
  orchestrator [options] [prompt...]

Options:
  --route-only, -r   Only analyze + route (no model call)
  --local, -l        Force local (Ollama CLI)
  --frontier, -f     Force frontier (Grok)
  --session, -s ID   Conversation session id (default: env SESSION_ID or "default")
  --no-memory        Do not load/save history for this run
  --clear-session    Clear stored history for the session and exit
  --json             Print full result as JSON
  --help, -h         Show this help

REPL commands:
  /local ...         Force local for one turn
  /frontier ...      Force frontier for one turn
  /route ...         Route-only for one turn
  /clear             Clear current session history
  /session ID        Switch session id

Env (see .env.example):
  OLLAMA_MODEL, OLLAMA_BIN
  XAI_API_KEY, XAI_BASE_URL, GROK_MODEL
  SYSTEM_PROMPT
  SESSION_ID, MEMORY_DB_PATH, MEMORY_HISTORY_LIMIT
`);
}

interface CliArgs {
  prompt: string;
  routeOnly: boolean;
  forceModel?: ModelChoice;
  json: boolean;
  help: boolean;
  sessionId: string;
  useMemory: boolean;
  clearSession: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let routeOnly = false;
  let forceModel: ModelChoice | undefined;
  let json = false;
  let help = false;
  let useMemory = true;
  let clearSession = false;
  let sessionId =
    process.env.SESSION_ID?.trim() || "default";
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--route-only":
      case "-r":
        routeOnly = true;
        break;
      case "--local":
      case "-l":
        forceModel = "local";
        break;
      case "--frontier":
      case "-f":
        forceModel = "frontier";
        break;
      case "--session":
      case "-s": {
        const next = argv[++i];
        if (!next || next.startsWith("-")) {
          console.error("--session requires an id");
          process.exit(1);
        }
        sessionId = next;
        break;
      }
      case "--no-memory":
        useMemory = false;
        break;
      case "--clear-session":
        clearSession = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        rest.push(arg);
    }
  }

  return {
    prompt: rest.join(" ").trim(),
    routeOnly,
    forceModel,
    json,
    help,
    sessionId,
    useMemory,
    clearSession,
  };
}

function openMemoryFromEnv(): Memory {
  const dbPath = resolve(
    process.cwd(),
    process.env.MEMORY_DB_PATH ?? "./data/memory.db"
  );
  const defaultLimit = Number(process.env.MEMORY_HISTORY_LIMIT ?? "50");
  return createMemory({
    dbPath,
    defaultLimit: Number.isFinite(defaultLimit) && defaultLimit > 0
      ? defaultLimit
      : 50,
  });
}

function printResult(
  result: Awaited<ReturnType<Orchestrator["handle"]>>,
  asJson: boolean,
  meta?: { sessionId?: string; historyCount?: number }
): void {
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ...result,
          sessionId: meta?.sessionId,
          historyCount: meta?.historyCount,
        },
        null,
        2
      )
    );
    return;
  }
  if (meta?.sessionId) {
    console.log(
      `[session] ${meta.sessionId}${
        meta.historyCount != null ? `  (history=${meta.historyCount})` : ""
      }`
    );
  }
  console.log(
    `\n[route] ${result.routing.reason}  (type=${result.routing.taskType}, complexity=${result.routing.complexity})`
  );
  console.log(`[model] ${result.provider}/${result.model}`);
  if (result.usage?.totalTokens != null) {
    console.log(`[tokens] ${result.usage.totalTokens}`);
  }
  console.log(`\n${result.reply}\n`);
}

async function runOnce(
  orch: Orchestrator,
  args: CliArgs,
  memory: Memory | null
): Promise<void> {
  if (args.routeOnly) {
    const routing = orch.decide(args.prompt);
    if (args.forceModel) {
      routing.model = args.forceModel;
      routing.reason = `forced → ${args.forceModel}`;
    }
    if (args.json) {
      console.log(JSON.stringify(routing, null, 2));
    } else {
      console.log(
        `model=${routing.model}  type=${routing.taskType}  complexity=${routing.complexity}`
      );
      console.log(`reason: ${routing.reason}`);
      if (routing.model === "local") {
        console.log(`localModel: ${routing.localModel}`);
      } else {
        console.log(`frontierModel: ${routing.frontierModel}`);
      }
    }
    return;
  }

  const history =
    memory && args.useMemory
      ? await memory.getHistory(args.sessionId)
      : [];

  const result = await orch.handle(args.prompt, {
    forceModel: args.forceModel,
    history,
  });

  if (memory && args.useMemory) {
    // Do not auto-store system prompts — only the user turn + assistant reply.
    await memory.add(args.sessionId, { role: "user", content: args.prompt });
    await memory.add(args.sessionId, {
      role: "assistant",
      content: result.reply,
    });
  }

  printResult(result, args.json, {
    sessionId: args.useMemory ? args.sessionId : undefined,
    historyCount: history.length,
  });
}

async function runRepl(
  orch: Orchestrator,
  args: CliArgs,
  memory: Memory | null
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let sessionId = args.sessionId;
  console.log(
    "Orchestrator REPL (empty line or Ctrl+C to exit).\n" +
      "Commands: /local /frontier /route /clear /session <id>"
  );
  if (memory && args.useMemory) {
    const n = (await memory.getHistory(sessionId)).length;
    console.log(`[session] ${sessionId}  (history=${n})`);
  }

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;

      if (line === "/clear") {
        if (!memory || !args.useMemory) {
          console.log("Memory is disabled.");
          continue;
        }
        await memory.clear(sessionId);
        console.log(`Cleared session "${sessionId}"`);
        continue;
      }

      if (line.startsWith("/session ")) {
        const next = line.slice(9).trim();
        if (!next) {
          console.log("Usage: /session <id>");
          continue;
        }
        sessionId = next;
        if (memory && args.useMemory) {
          const n = (await memory.getHistory(sessionId)).length;
          console.log(`[session] ${sessionId}  (history=${n})`);
        } else {
          console.log(`[session] ${sessionId}`);
        }
        continue;
      }

      let forceModel = args.forceModel;
      let routeOnly = false;
      let prompt = line;

      if (line.startsWith("/local ")) {
        forceModel = "local";
        prompt = line.slice(7).trim();
      } else if (line.startsWith("/frontier ")) {
        forceModel = "frontier";
        prompt = line.slice(10).trim();
      } else if (line.startsWith("/route ")) {
        routeOnly = true;
        prompt = line.slice(7).trim();
      }

      if (!prompt) continue;

      try {
        await runOnce(
          orch,
          {
            prompt,
            routeOnly,
            forceModel,
            json: args.json,
            help: false,
            sessionId,
            useMemory: args.useMemory,
            clearSession: false,
          },
          memory
        );
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const memory =
    args.useMemory || args.clearSession ? openMemoryFromEnv() : null;

  try {
    if (args.clearSession) {
      if (!memory) {
        console.error("Memory is required for --clear-session");
        process.exit(1);
      }
      await memory.clear(args.sessionId);
      console.log(`Cleared session "${args.sessionId}"`);
      return;
    }

    const config = loadConfigFromEnv();
    const orch = new Orchestrator(config);

    if (!args.prompt) {
      await runRepl(orch, args, memory);
      return;
    }

    await runOnce(orch, args, memory);
  } finally {
    memory?.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

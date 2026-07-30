/**
 * CLI entry point.
 *
 * Usage:
 *   npx tsx src/index.ts "your prompt"
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
  --json             Print full result as JSON
  --help, -h         Show this help

Env (see .env.example):
  OLLAMA_MODEL, OLLAMA_BIN
  XAI_API_KEY, XAI_BASE_URL, GROK_MODEL
  SYSTEM_PROMPT
`);
}

interface CliArgs {
  prompt: string;
  routeOnly: boolean;
  forceModel?: ModelChoice;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let routeOnly = false;
  let forceModel: ModelChoice | undefined;
  let json = false;
  let help = false;
  const rest: string[] = [];

  for (const arg of argv) {
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
  };
}

function printResult(
  result: Awaited<ReturnType<Orchestrator["handle"]>>,
  asJson: boolean
): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
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
  args: CliArgs
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

  const result = await orch.handle(args.prompt, {
    forceModel: args.forceModel,
  });
  printResult(result, args.json);
}

async function runRepl(orch: Orchestrator, args: CliArgs): Promise<void> {
  const rl = readline.createInterface({ input, output });
  console.log(
    "Orchestrator REPL (empty line or Ctrl+C to exit). Prefix with /local /frontier /route"
  );

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;

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
        await runOnce(orch, {
          prompt,
          routeOnly,
          forceModel,
          json: args.json,
          help: false,
        });
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

  const config = loadConfigFromEnv();
  const orch = new Orchestrator(config);

  if (!args.prompt) {
    await runRepl(orch, args);
    return;
  }

  await runOnce(orch, args);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

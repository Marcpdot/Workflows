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
import { createRegistryFromConfig } from "./tools/index.js";
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
  --tool list        List registered tools and exit
  --tool run NAME [k=v...]   Run a tool and exit
  --ltm remember [key=...] content=... [tags=a,b]
  --ltm recall [key=...|text=...] [limit=N]
  --ltm list [limit=N]
  --ltm forget <idOrKey>
  --pipeline <task>  Sequential planner→worker pipeline (Milestone 3C)
  --json             Print full result as JSON
  --help, -h         Show this help

REPL commands:
  /local ...         Force local for one turn
  /frontier ...      Force frontier for one turn
  /route ...         Route-only for one turn
  /pipeline ...      Role pipeline for this task
  /tool list | /tool run NAME [k=v...]
  /remember [key=...] <content>
  /recall [key=...|text=...]
  /forget <idOrKey>
  /ltm list
  /clear             Clear current session history
  /session ID        Switch session id

Env (see .env.example):
  OLLAMA_MODEL, OLLAMA_BIN
  XAI_API_KEY, XAI_BASE_URL, GROK_MODEL
  SYSTEM_PROMPT
  SESSION_ID, MEMORY_DB_PATH, MEMORY_HISTORY_LIMIT
  COMPRESSION_THRESHOLD, COMPRESSION_KEEP_RECENT, COMPRESSION_DISABLED
  RETRIEVAL_LIMIT, RETRIEVAL_MAX_CHARS, RETRIEVAL_CONTEXT_DIR, RETRIEVAL_DISABLED
  TOOL_WORKSPACE_ROOT, TOOL_READ_MAX_BYTES, TOOL_COMMAND_TIMEOUT_MS
  TOOLS_DISABLED, TOOLS_ENABLED, TOOLS_MAX_STEPS
  LONGTERM_DB_PATH, PERSONAL_CONTEXT_DIR, LONGTERM_AUTO_INJECT, LONGTERM_DISABLED
  PROACTIVE_ENABLED, PROACTIVE_MAX, PROACTIVE_USE_MODEL
  AGENTS_PIPELINE_ENABLED
`);
}

interface ToolCliAction {
  kind: "list" | "run";
  name?: string;
  args: Record<string, unknown>;
}

interface LtmCliAction {
  kind: "remember" | "recall" | "list" | "forget";
  args: Record<string, unknown>;
  idOrKey?: string;
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
  toolAction?: ToolCliAction;
  ltmAction?: LtmCliAction;
  /** When set, run sequential role pipeline instead of handle() */
  pipelineTask?: string;
}

/** Parse key=value tokens into a plain object (values stay strings). */
function parseKvArgs(tokens: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

function parseArgs(argv: string[]): CliArgs {
  let routeOnly = false;
  let forceModel: ModelChoice | undefined;
  let json = false;
  let help = false;
  let useMemory = true;
  let clearSession = false;
  let toolAction: ToolCliAction | undefined;
  let ltmAction: LtmCliAction | undefined;
  let pipelineTask: string | undefined;
  let sessionId =
    process.env.SESSION_ID?.trim() || "default";
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--pipeline": {
        // Remaining non-flag args form the task (or next token)
        const parts: string[] = [];
        while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
          parts.push(argv[++i]!);
        }
        pipelineTask = parts.join(" ").trim();
        if (!pipelineTask) {
          console.error('--pipeline requires a task string');
          process.exit(1);
        }
        break;
      }
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
      case "--tool": {
        const sub = argv[++i];
        if (sub === "list") {
          toolAction = { kind: "list", args: {} };
        } else if (sub === "run") {
          const name = argv[++i];
          if (!name) {
            console.error("--tool run requires a tool name");
            process.exit(1);
          }
          const kv: string[] = [];
          while (i + 1 < argv.length && argv[i + 1]!.includes("=")) {
            kv.push(argv[++i]!);
          }
          toolAction = { kind: "run", name, args: parseKvArgs(kv) };
        } else {
          console.error('--tool requires "list" or "run"');
          process.exit(1);
        }
        break;
      }
      case "--ltm": {
        const sub = argv[++i];
        if (!sub || !["remember", "recall", "list", "forget"].includes(sub)) {
          console.error("--ltm requires remember|recall|list|forget");
          process.exit(1);
        }
        if (sub === "forget") {
          const idOrKey = argv[++i];
          if (!idOrKey) {
            console.error("--ltm forget requires id or key");
            process.exit(1);
          }
          ltmAction = { kind: "forget", args: {}, idOrKey };
        } else {
          const kv: string[] = [];
          while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
            const next = argv[i + 1]!;
            if (next.includes("=")) {
              kv.push(argv[++i]!);
            } else if (sub === "remember" && !kv.some((x) => x.startsWith("content="))) {
              // allow bare content tokens after key=...
              i++;
              const prev = kv.find((x) => x.startsWith("content="));
              if (!prev) {
                kv.push(`content=${next}`);
              } else {
                // append free text into content
                const idx = kv.indexOf(prev);
                kv[idx] = prev + " " + next;
              }
            } else {
              break;
            }
          }
          ltmAction = {
            kind: sub as LtmCliAction["kind"],
            args: parseKvArgs(kv),
          };
        }
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
    toolAction,
    ltmAction,
    pipelineTask,
  };
}

async function runPipelineTask(
  orch: Orchestrator,
  task: string,
  asJson: boolean
): Promise<void> {
  console.log(`[pipeline] planner → worker  task=${task.slice(0, 80)}`);
  const result = await orch.runPipeline(task);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const stage of result.stages) {
    console.log(`\n--- stage: ${stage.role} ---`);
    if (stage.toolSteps && stage.toolSteps.length > 0) {
      for (const step of stage.toolSteps) {
        console.log(
          `[tool] ${step.call.name} ${step.result.ok ? "ok" : "fail"}  ${step.durationMs}ms`
        );
      }
    }
    console.log(stage.text);
  }
  console.log(`\n[pipeline final]\n${result.finalText}\n`);
}

async function runLtmAction(
  orch: Orchestrator,
  action: LtmCliAction,
  asJson: boolean
): Promise<void> {
  const ltm = orch.longTerm;
  if (!ltm) {
    console.error("Long-term memory is disabled (LONGTERM_DISABLED?)");
    process.exit(1);
  }

  if (action.kind === "remember") {
    const content = String(action.args.content ?? "").trim();
    if (!content) {
      console.error("remember requires content=...");
      process.exit(1);
    }
    const key =
      action.args.key !== undefined
        ? String(action.args.key)
        : undefined;
    const tagsRaw = action.args.tags;
    const tags =
      typeof tagsRaw === "string" && tagsRaw.trim()
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;
    const fact = await ltm.remember({ content, key, tags, source: "user" });
    if (asJson) console.log(JSON.stringify(fact, null, 2));
    else
      console.log(
        `remembered ${fact.key ? `key=${fact.key}` : `id=${fact.id}`}: ${fact.content}`
      );
    return;
  }

  if (action.kind === "recall") {
    const key =
      action.args.key !== undefined ? String(action.args.key) : undefined;
    const text =
      action.args.text !== undefined ? String(action.args.text) : undefined;
    const limit = action.args.limit ? Number(action.args.limit) : 10;
    const facts = await ltm.recall({ key, text, limit });
    if (asJson) {
      console.log(JSON.stringify(facts, null, 2));
      return;
    }
    if (facts.length === 0) {
      console.log("(no facts)");
      return;
    }
    for (const f of facts) {
      console.log(
        `${f.key ?? f.id}  ${f.content}${f.tags?.length ? `  [${f.tags.join(",")}]` : ""}`
      );
    }
    return;
  }

  if (action.kind === "list") {
    const limit = action.args.limit ? Number(action.args.limit) : 20;
    const facts = await ltm.list(limit);
    if (asJson) {
      console.log(JSON.stringify(facts, null, 2));
      return;
    }
    if (facts.length === 0) {
      console.log("(empty)");
      return;
    }
    for (const f of facts) {
      console.log(`${f.key ?? f.id}  ${f.content}`);
    }
    return;
  }

  if (action.kind === "forget") {
    const idOrKey = action.idOrKey ?? String(action.args.idOrKey ?? "");
    const ok = await ltm.forget(idOrKey);
    if (asJson) console.log(JSON.stringify({ forgotten: ok, idOrKey }));
    else console.log(ok ? `forgot ${idOrKey}` : `not found: ${idOrKey}`);
    if (!ok) process.exitCode = 1;
  }
}

async function runToolAction(
  orch: Orchestrator,
  action: ToolCliAction,
  asJson: boolean
): Promise<void> {
  if (action.kind === "list") {
    const tools = orch.getTools()?.list() ?? [];
    if (asJson) {
      console.log(
        JSON.stringify(
          tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
          null,
          2
        )
      );
      return;
    }
    if (tools.length === 0) {
      console.log("No tools registered.");
      return;
    }
    for (const t of tools) {
      const params = t.parameters
        .map((p) => `${p.name}${p.required ? "*" : ""}:${p.type}`)
        .join(", ");
      console.log(`${t.name.padEnd(14)} ${t.description}  (${params})`);
    }
    return;
  }

  if (!action.name) {
    console.error("Tool name required");
    process.exit(1);
  }
  const result = await orch.runTool(action.name, action.args);
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(result.output);
  } else {
    console.error(`Tool error: ${result.error}`);
    if (result.output) console.error(result.output);
    process.exitCode = 1;
  }
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
  if (result.retrieval) {
    console.log(
      `[retrieval] chunks=${result.retrieval.chunkCount}  chars=${result.retrieval.chars}  sources=${result.retrieval.sources.join(",") || "-"}`
    );
  }
  if (result.toolSteps && result.toolSteps.length > 0) {
    for (const step of result.toolSteps) {
      const mark = step.result.ok ? "ok" : "fail";
      console.log(
        `[tool] ${step.call.name} ${mark}  ${step.durationMs}ms${
          step.result.error ? `  (${step.result.error})` : ""
        }`
      );
    }
    if (result.toolsHitMaxSteps) {
      console.log("[tool] hit max steps");
    }
  }
  if (result.suggestions && result.suggestions.length > 0) {
    for (const tip of result.suggestions) {
      console.log(`[next] ${tip.text}`);
    }
  }
  if (result.compression) {
    if (result.compression.compressed) {
      console.log(
        `[compression] yes  original=${result.compression.originalCount}  recent=${result.compression.recentCount}  summaryChars=${result.compression.summary?.length ?? 0}`
      );
    } else {
      console.log(
        `[compression] no  history=${result.compression.originalCount}`
      );
    }
  }
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
      "Commands: /local /frontier /route /pipeline /tool /remember /recall /forget /ltm /clear /session <id>"
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

      if (line === "/tool list" || line.startsWith("/tool ")) {
        try {
          if (line === "/tool list" || line === "/tool") {
            await runToolAction(orch, { kind: "list", args: {} }, args.json);
          } else if (line.startsWith("/tool run ")) {
            const parts = line.slice("/tool run ".length).trim().split(/\s+/);
            const name = parts[0];
            if (!name) {
              console.log("Usage: /tool run NAME [k=v...]");
              continue;
            }
            await runToolAction(
              orch,
              { kind: "run", name, args: parseKvArgs(parts.slice(1)) },
              args.json
            );
          } else if (line.startsWith("/tool list")) {
            await runToolAction(orch, { kind: "list", args: {} }, args.json);
          } else {
            console.log("Usage: /tool list | /tool run NAME [k=v...]");
          }
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        continue;
      }

      if (line.startsWith("/pipeline ")) {
        const task = line.slice("/pipeline ".length).trim();
        if (!task) {
          console.log("Usage: /pipeline <task>");
          continue;
        }
        try {
          await runPipelineTask(orch, task, args.json);
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        continue;
      }

      if (
        line.startsWith("/remember ") ||
        line.startsWith("/recall") ||
        line.startsWith("/forget ") ||
        line === "/ltm list" ||
        line.startsWith("/ltm ")
      ) {
        try {
          if (line.startsWith("/remember ")) {
            const body = line.slice("/remember ".length).trim();
            const parts = body.split(/\s+/);
            const kv = parts.filter((p) => p.includes("="));
            const free = parts.filter((p) => !p.includes("="));
            const argsMap = parseKvArgs(kv);
            if (!argsMap.content && free.length) {
              argsMap.content = free.join(" ");
            }
            await runLtmAction(
              orch,
              { kind: "remember", args: argsMap },
              args.json
            );
          } else if (line.startsWith("/recall")) {
            const body = line.slice("/recall".length).trim();
            const parts = body ? body.split(/\s+/) : [];
            const argsMap = parseKvArgs(parts.filter((p) => p.includes("=")));
            const free = parts.filter((p) => !p.includes("="));
            if (!argsMap.text && !argsMap.key && free.length) {
              argsMap.text = free.join(" ");
            }
            await runLtmAction(
              orch,
              { kind: "recall", args: argsMap },
              args.json
            );
          } else if (line.startsWith("/forget ")) {
            const idOrKey = line.slice("/forget ".length).trim();
            await runLtmAction(
              orch,
              { kind: "forget", args: {}, idOrKey },
              args.json
            );
          } else if (line === "/ltm list" || line.startsWith("/ltm list")) {
            await runLtmAction(orch, { kind: "list", args: {} }, args.json);
          } else {
            console.log(
              "Usage: /remember [key=k] content | /recall [text=|key=] | /forget id|key | /ltm list"
            );
          }
        } catch (err) {
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`
          );
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
    // Phase C: load optional TOOL_EXTRA_MODULES into the registry.
    if (config.tools) {
      config.tools = await createRegistryFromConfig();
    }
    const orch = new Orchestrator(config);

    try {
      if (args.toolAction) {
        await runToolAction(orch, args.toolAction, args.json);
        return;
      }

      if (args.ltmAction) {
        await runLtmAction(orch, args.ltmAction, args.json);
        return;
      }

      if (args.pipelineTask) {
        await runPipelineTask(orch, args.pipelineTask, args.json);
        return;
      }

      if (!args.prompt) {
        await runRepl(orch, args, memory);
        return;
      }

      await runOnce(orch, args, memory);
    } finally {
      orch.longTerm?.close();
    }
  } finally {
    memory?.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

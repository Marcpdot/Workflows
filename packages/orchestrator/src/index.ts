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
import { createMemory, type Memory } from "@workflows/memory";
import { tryHandleSessionCommand } from "./sessionCommands.js";
import { createRegistryFromConfig } from "@workflows/tools";
import { resolveWorkspace, type WorkspaceContext } from "@workflows/workspace";
import {
  applyExtractionResult,
  createKnowledgeReader,
  createKnowledgeStore,
  ingestFile,
  ingestText,
  renderContradictionsRead,
  renderNeighborhoodRead,
  renderNodeTable,
  renderProjectStatusReport,
  renderSearchRead,
  runFirstPrinciplesAnalysis,
  type ExtractionResult,
  type KnowledgeStore,
} from "@workflows/knowledge";
import {
  createSttAdapter,
  createTtsAdapter,
  loadVoiceConfig,
  runVoiceTurn,
} from "@workflows/voice";
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
  --knowledge proposals [pending|accepted|rejected]
  --knowledge accept <proposalId>
  --knowledge reject <proposalId>
  --knowledge find [label=...] [type=concept|claim|...] [workspaceId=...] [--table]
  --knowledge neighborhood <nodeId> [hops=1|2]
  --knowledge search [label=...] [type=...]   # M17 read alias for find
  --knowledge extract --text "..."   # fixture-free extract via local model if available
  --knowledge ensure-project label=NAME [description=...] [workspaceId=...]
  --knowledge link nodeId=... projectId=... [relation=used_in|about|part_of]
  --knowledge project-status [label=NAME|projectId=...] [hops=1|2]
  --knowledge ingest --text "..." | --file path [projectLabel=...] [workspaceId=...]
  --knowledge add-alias aliasLabel=... canonicalNodeId=...
  --knowledge merge fromId=... intoId=...
  --knowledge contradictions [nodeId=...]
  --knowledge mark-contradiction fromId=... toId=...
  --knowledge supersede oldClaimId=... newClaimId=...
  --knowledge fp --topic "..." [goal=...] [projectLabel=...]
  --pipeline <task>  Sequential planner→worker pipeline (Milestone 3C)
  --voice-once       One STT→handle→TTS turn (M18; needs --transcript or audio)
  --transcript TEXT  Transcript for mock/local STT override (voice)
  --audio PATH       Audio file for local STT (VOICE_STT_PROVIDER=local)
  --voice-silent     Skip TTS for this turn
  --workspace, -w PATH  Workspace root for tools + session namespace (env WORKSPACE_ROOT)
  --list-sessions    List short-term session ids (optional filter by current workspace)
  --json             Machine JSON on stdout only (logs → stderr)
  --verbose          Mirror observability events to stderr
  --help, -h         Show this help

REPL commands:
  /local ...         Force local for one turn
  /frontier ...      Force frontier for one turn
  /route ...         Route-only for one turn
  /pipeline ...      Role pipeline for this task
  /voice ...         Voice turn with line as transcript (mock STT; same handle)
  /tool list | /tool run NAME [k=v...]
  /remember [key=...] <content>
  /recall [key=...|text=...]
  /forget <idOrKey>
  /ltm list
  /clear             Clear current session history
  /session ID        Switch logical session id (namespaced per workspace)
  /workspace         Show active workspace id / root / context
  /mode [active|neutral]   Interaction mode (persisted; default active)
  /proposals [on|off]      Continuous capture toggle
  /capture                 Force knowledge extract → pending proposals
  /accept <id>[,id…]       Accept proposals
  /reject <id>[,id…]       Reject proposals

Env (see .env.example):
  OLLAMA_MODEL, OLLAMA_BIN
  XAI_API_KEY, XAI_BASE_URL, GROK_MODEL
  SYSTEM_PROMPT
  SESSION_ID, MEMORY_DB_PATH, MEMORY_HISTORY_LIMIT
  SESSION_NAMESPACE (default on; set false for legacy un-prefixed session ids)
  COMPRESSION_THRESHOLD, COMPRESSION_KEEP_RECENT, COMPRESSION_DISABLED
  RETRIEVAL_LIMIT, RETRIEVAL_MAX_CHARS, RETRIEVAL_CONTEXT_DIR, RETRIEVAL_DISABLED
  TOOL_WORKSPACE_ROOT, TOOL_READ_MAX_BYTES, TOOL_COMMAND_TIMEOUT_MS
  TOOLS_DISABLED, TOOLS_ENABLED, TOOLS_MAX_STEPS
  LONGTERM_DB_PATH, PERSONAL_CONTEXT_DIR, LONGTERM_AUTO_INJECT, LONGTERM_DISABLED
  LONGTERM_PROJECT_SCOPED, LONGTERM_PROJECT_DB
  KNOWLEDGE_DATABASE_URL (canonical PostgreSQL knowledge store)
  KNOWLEDGE_DEFAULT_WORKSPACE_ID (else from --workspace / WORKSPACE_ROOT id)
  KNOWLEDGE_TOOLS_ENABLED, KNOWLEDGE_INJECT_ENABLED
  KNOWLEDGE_INGEST_AUTO_ON_CHAT (default false; proposals only), KNOWLEDGE_INGEST_MIN_CHARS
  KNOWLEDGE_HTTP_READ (integration GET /v1/knowledge/* + /knowledge HTML)
  KNOWLEDGE_CAPTURE_DISABLED (default false — continuous capture in active mode)
  VOICE_ENABLED, VOICE_STT_PROVIDER, VOICE_TTS_PROVIDER, VOICE_LANGUAGE
  VOICE_STT_COMMAND, VOICE_TTS_COMMAND, VOICE_ALLOW_REMOTE_AUDIO
  PROACTIVE_ENABLED, PROACTIVE_MAX, PROACTIVE_USE_MODEL
  AGENTS_PIPELINE_ENABLED
  WORKSPACE_ROOT (or TOOL_WORKSPACE_ROOT), INTEGRATION_HTTP_PORT, INTEGRATION_HTTP_TOKEN
  OBS_ENABLED, OBS_LOG_PATH, OBS_LOG_PROMPTS, OBS_STDERR
`);
}

interface KnowledgeCliAction {
  kind:
    | "proposals"
    | "accept"
    | "reject"
    | "find"
    | "search"
    | "neighborhood"
    | "extract"
    | "ensure-project"
    | "link"
    | "project-status"
    | "ingest"
    | "add-alias"
    | "merge"
    | "contradictions"
    | "mark-contradiction"
    | "supersede"
    | "fp";
  id?: string;
  filter?: string;
  args: Record<string, unknown>;
  text?: string;
  file?: string;
  topic?: string;
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
  /** Logical session id (CLI/env); storage uses namespaced id from WorkspaceContext */
  sessionId: string;
  useMemory: boolean;
  clearSession: boolean;
  listSessions: boolean;
  toolAction?: ToolCliAction;
  ltmAction?: LtmCliAction;
  knowledgeAction?: KnowledgeCliAction;
  /** When set, run sequential role pipeline instead of handle() */
  pipelineTask?: string;
  /** Absolute/relative workspace for tools + isolation (M5/M9) */
  workspace?: string;
  /** M18: one voice turn via adapters → same handle() */
  voiceOnce?: boolean;
  voiceTranscript?: string;
  voiceAudioPath?: string;
  voiceSilent?: boolean;
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
  let knowledgeAction: KnowledgeCliAction | undefined;
  let pipelineTask: string | undefined;
  let workspace: string | undefined;
  let listSessions = false;
  let voiceOnce = false;
  let voiceTranscript: string | undefined;
  let voiceAudioPath: string | undefined;
  let voiceSilent = false;
  let sessionId =
    process.env.SESSION_ID?.trim() || "default";
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--voice-once":
        voiceOnce = true;
        break;
      case "--voice-silent":
        voiceSilent = true;
        break;
      case "--transcript": {
        const next = argv[++i];
        if (!next || next.startsWith("-")) {
          console.error("--transcript requires text");
          process.exit(1);
        }
        voiceTranscript = next;
        break;
      }
      case "--audio": {
        const next = argv[++i];
        if (!next || next.startsWith("-")) {
          console.error("--audio requires a path");
          process.exit(1);
        }
        voiceAudioPath = next;
        break;
      }
      case "--list-sessions":
        listSessions = true;
        break;
      case "--workspace":
      case "-w": {
        const next = argv[++i];
        if (!next || next.startsWith("-")) {
          console.error("--workspace requires a path");
          process.exit(1);
        }
        workspace = next;
        break;
      }
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
      case "--knowledge": {
        const sub = argv[++i];
        if (
          !sub ||
          ![
            "proposals",
            "accept",
            "reject",
            "find",
            "search",
            "neighborhood",
            "extract",
            "ensure-project",
            "link",
            "project-status",
            "ingest",
            "add-alias",
            "merge",
            "contradictions",
            "mark-contradiction",
            "supersede",
            "fp",
          ].includes(sub)
        ) {
          console.error(
            "--knowledge requires proposals|accept|reject|find|search|neighborhood|extract|ensure-project|link|project-status|ingest|add-alias|merge|contradictions|mark-contradiction|supersede|fp"
          );
          process.exit(1);
        }
        if (sub === "accept" || sub === "reject" || sub === "neighborhood") {
          const id = argv[++i];
          if (!id || id.startsWith("-")) {
            console.error(`--knowledge ${sub} requires an id`);
            process.exit(1);
          }
          const kv: string[] = [];
          while (i + 1 < argv.length && argv[i + 1]!.includes("=")) {
            kv.push(argv[++i]!);
          }
          knowledgeAction = {
            kind: sub,
            id,
            args: parseKvArgs(kv),
          };
        } else if (sub === "proposals") {
          const filter = argv[i + 1] && !argv[i + 1]!.startsWith("-")
            ? argv[++i]
            : undefined;
          knowledgeAction = {
            kind: "proposals",
            filter,
            args: {},
          };
        } else if (
          sub === "find" ||
          sub === "search" ||
          sub === "ensure-project" ||
          sub === "link" ||
          sub === "project-status" ||
          sub === "add-alias" ||
          sub === "merge" ||
          sub === "contradictions" ||
          sub === "mark-contradiction" ||
          sub === "supersede"
        ) {
          const kv: string[] = [];
          while (i + 1 < argv.length) {
            const next = argv[i + 1]!;
            if (next === "--table") {
              i++;
              kv.push("table=1");
            } else if (next.includes("=")) {
              kv.push(argv[++i]!);
            } else {
              break;
            }
          }
          knowledgeAction = {
            kind: sub === "search" ? "find" : sub,
            args: parseKvArgs(kv),
          };
        } else if (sub === "fp") {
          let topic: string | undefined;
          const kv: string[] = [];
          while (i + 1 < argv.length) {
            const next = argv[i + 1]!;
            if (next === "--topic") {
              i++;
              topic = argv[++i];
            } else if (next.includes("=")) {
              kv.push(argv[++i]!);
            } else if (!next.startsWith("-")) {
              const parts: string[] = [];
              while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
                parts.push(argv[++i]!);
              }
              topic = parts.join(" ");
              break;
            } else {
              break;
            }
          }
          const argsMap = parseKvArgs(kv);
          if (!topic && typeof argsMap.topic === "string") {
            topic = String(argsMap.topic);
          }
          knowledgeAction = {
            kind: "fp",
            topic,
            args: argsMap,
          };
        } else if (sub === "extract" || sub === "ingest") {
          let text: string | undefined;
          let file: string | undefined;
          const kv: string[] = [];
          while (i + 1 < argv.length) {
            const next = argv[i + 1]!;
            if (next === "--text") {
              i++;
              text = argv[++i];
            } else if (next === "--file") {
              i++;
              file = argv[++i];
            } else if (next.includes("=")) {
              kv.push(argv[++i]!);
            } else if (!next.startsWith("-")) {
              // remaining free text as extract/ingest body
              const parts: string[] = [];
              while (i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
                parts.push(argv[++i]!);
              }
              text = parts.join(" ");
              break;
            } else {
              break;
            }
          }
          const argsMap = parseKvArgs(kv);
          if (!text && typeof argsMap.text === "string") {
            text = String(argsMap.text);
          }
          if (!file && typeof argsMap.file === "string") {
            file = String(argsMap.file);
          }
          knowledgeAction = {
            kind: sub,
            text,
            file,
            args: argsMap,
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
    listSessions,
    toolAction,
    ltmAction,
    knowledgeAction,
    pipelineTask,
    workspace,
    voiceOnce,
    voiceTranscript,
    voiceAudioPath,
    voiceSilent,
  };
}

function resolveDefaultKnowledgeWorkspaceId(
  env: NodeJS.ProcessEnv = process.env,
  options?: { workspaceRoot?: string; cwd?: string }
): string | null {
  if (env.KNOWLEDGE_DEFAULT_WORKSPACE_ID?.trim()) {
    return env.KNOWLEDGE_DEFAULT_WORKSPACE_ID.trim();
  }
  const ws = resolveWorkspace({
    workspaceRoot: options?.workspaceRoot,
    cwd: options?.cwd ?? process.cwd(),
    env,
  });
  return ws.id;
}

function openKnowledgeFromEnv(options?: {
  workspaceRoot?: string;
}): KnowledgeStore {
  const env = process.env;
  return createKnowledgeStore({
    defaultWorkspaceId: resolveDefaultKnowledgeWorkspaceId(env, {
      workspaceRoot: options?.workspaceRoot,
    }),
  });
}

async function runKnowledgeAction(
  action: KnowledgeCliAction,
  asJson: boolean,
  options?: { workspaceRoot?: string }
): Promise<void> {
  const store = openKnowledgeFromEnv({
    workspaceRoot: options?.workspaceRoot,
  });
  try {
    if (action.kind === "proposals") {
      const status =
        action.filter === "pending" ||
        action.filter === "accepted" ||
        action.filter === "rejected"
          ? action.filter
          : "pending";
      const reader = createKnowledgeReader(store);
      const result = await reader.listProposals({ status });
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `[knowledge] proposals status=${result.status} count=${result.count}`
        );
        for (const p of result.proposals) {
          console.log(
            `  ${p.id}  ${p.kind}  ${JSON.stringify(p.payload).slice(0, 120)}`
          );
        }
      }
      return;
    }
    if (action.kind === "accept") {
      await store.acceptProposal(action.id!, action.args);
      if (asJson) console.log(JSON.stringify({ accepted: action.id }));
      else console.log(`[knowledge] accepted ${action.id}`);
      return;
    }
    if (action.kind === "reject") {
      await store.rejectProposal(action.id!);
      if (asJson) console.log(JSON.stringify({ rejected: action.id }));
      else console.log(`[knowledge] rejected ${action.id}`);
      return;
    }
    if (action.kind === "find") {
      const reader = createKnowledgeReader(store);
      const result = await reader.search({
        type: action.args.type
          ? (String(action.args.type) as
              | "concept"
              | "claim"
              | "event"
              | "source"
              | "project"
              | "artifact")
          : undefined,
        label: action.args.label
          ? String(action.args.label)
          : undefined,
        status: action.args.status
          ? (String(action.args.status) as
              | "proposed"
              | "accepted"
              | "disputed"
              | "rejected")
          : "accepted",
        limit: action.args.limit
          ? Number(action.args.limit)
          : 20,
        workspaceId: action.args.workspaceId
          ? String(action.args.workspaceId)
          : undefined,
      });
      if (asJson) console.log(JSON.stringify(result, null, 2));
      else if (action.args.table === "1" || action.args.table === 1) {
        console.log(renderNodeTable(result.nodes));
      } else {
        console.log(renderSearchRead(result));
      }
      return;
    }
    if (action.kind === "neighborhood") {
      const reader = createKnowledgeReader(store);
      const hops = action.args.hops === "2" || action.args.hops === 2 ? 2 : 1;
      const neigh = await reader.getNeighborhood(action.id!, {
        hops: hops as 1 | 2,
        status: "accepted",
      });
      if (asJson) console.log(JSON.stringify(neigh, null, 2));
      else {
        console.log(renderNeighborhoodRead(neigh));
      }
      return;
    }
    if (action.kind === "ensure-project") {
      const label = action.args.label
        ? String(action.args.label).trim()
        : "";
      if (!label) {
        console.error("--knowledge ensure-project requires label=...");
        process.exit(1);
      }
      const project = await store.ensureProject({
        canonicalId: action.args.canonicalId
          ? String(action.args.canonicalId)
          : undefined,
        label,
        description: action.args.description
          ? String(action.args.description)
          : undefined,
        workspaceId: action.args.workspaceId
          ? String(action.args.workspaceId)
          : undefined,
        createAccepted: true,
      });
      if (asJson) console.log(JSON.stringify(project, null, 2));
      else {
        console.log(
          `[knowledge] ensure-project ${project.label} id=${project.id} status=${project.status} workspace=${project.workspaceId ?? "none"}`
        );
      }
      return;
    }
    if (action.kind === "link") {
      const nodeId = action.args.nodeId
        ? String(action.args.nodeId).trim()
        : "";
      const projectId = action.args.projectId
        ? String(action.args.projectId).trim()
        : "";
      if (!nodeId || !projectId) {
        console.error(
          "--knowledge link requires nodeId=... projectId=..."
        );
        process.exit(1);
      }
      const relRaw = action.args.relation
        ? String(action.args.relation)
        : "used_in";
      const relation =
        relRaw === "about" || relRaw === "part_of" || relRaw === "used_in"
          ? relRaw
          : "used_in";
      const edge = await store.linkToProject({
        nodeId,
        projectId,
        relation,
      });
      if (asJson) console.log(JSON.stringify(edge, null, 2));
      else {
        console.log(
          `[knowledge] link ${edge.fromNodeId} -[${edge.relation}]-> ${edge.toNodeId}`
        );
      }
      return;
    }
    if (action.kind === "project-status") {
      const label = action.args.label
        ? String(action.args.label).trim()
        : undefined;
      const projectId = action.args.projectId
        ? String(action.args.projectId).trim()
        : undefined;
      if (!label && !projectId) {
        console.error(
          "--knowledge project-status requires label=... or projectId=..."
        );
        process.exit(1);
      }
      const hops =
        action.args.hops === "2" || action.args.hops === 2 ? 2 : 1;
      const reader = createKnowledgeReader(store);
      const status = await reader.getProjectStatus({
        label,
        projectId,
        hops: hops as 1 | 2,
        workspaceId: action.args.workspaceId
          ? String(action.args.workspaceId)
          : undefined,
      });
      if (asJson) console.log(JSON.stringify({ ok: true, status }, null, 2));
      else {
        console.log(renderProjectStatusReport(status));
      }
      return;
    }
    if (action.kind === "extract") {
      const text = action.text?.trim();
      if (!text) {
        console.error(
          '--knowledge extract requires --text "..." or free text'
        );
        process.exit(1);
      }
      // M11 default path: heuristic fixture-style extract without live model
      // (simple regex-free split into concepts from capitalized phrases is weak —
      // use a fixed structure from text sentences for offline shell).
      const sentences = text
        .split(/[.!?\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3);
      const words = text
        .split(/[^a-zA-ZæøåÆØÅ0-9-]+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 3);
      const unique = [...new Set(words.map((w) => w.toLowerCase()))].slice(
        0,
        8
      );
      const fixture: ExtractionResult = {
        concepts: unique.map((label) => ({ label })),
        claims: sentences.slice(0, 5).map((label) => ({ label })),
        relations:
          unique.length >= 2
            ? [
                {
                  from: unique[0]!,
                  relation: "about",
                  to: unique[1]!,
                },
              ]
            : [],
      };
      const { eventId, proposals } = await applyExtractionResult(
        store,
        fixture,
        {
          sourceType: "manual",
          sourceRef: "cli-extract",
          model: "heuristic-m11",
          rawText: text,
        }
      );
      if (asJson) {
        console.log(JSON.stringify({ eventId, proposals }, null, 2));
      } else {
        console.log(
          `[knowledge] extract event=${eventId} proposals=${proposals.length} (heuristic offline shell)`
        );
        for (const p of proposals) {
          console.log(`  ${p.id}  ${p.kind}`);
        }
      }
      return;
    }
    if (action.kind === "ingest") {
      const text = action.text?.trim();
      const file = action.file?.trim();
      if (!text && !file) {
        console.error(
          '--knowledge ingest requires --text "..." or --file path'
        );
        process.exit(1);
      }
      const projectLabel = action.args.projectLabel
        ? String(action.args.projectLabel)
        : undefined;
      const workspaceId = action.args.workspaceId
        ? String(action.args.workspaceId)
        : undefined;
      const result = file
        ? await ingestFile(store, {
            path: file,
            workspaceRoot: options?.workspaceRoot,
            projectLabel,
            workspaceId,
            sourceRef: action.args.sourceRef
              ? String(action.args.sourceRef)
              : undefined,
          })
        : await ingestText(store, {
            text: text!,
            projectLabel,
            workspaceId,
            sourceType: "manual",
            sourceRef: action.args.sourceRef
              ? String(action.args.sourceRef)
              : "cli-ingest",
          });
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `[knowledge] ingest mode=${result.mode} event=${result.eventId || "none"} proposals=${result.proposals.length} skippedDupNodes=${result.skippedDuplicateNodes}${result.reason ? ` reason=${result.reason}` : ""}`
        );
        for (const p of result.proposals) {
          console.log(`  ${p.id}  ${p.kind}  pending`);
        }
        console.log(
          "[knowledge] proposals only — use --knowledge accept <id> to commit"
        );
      }
      return;
    }
    if (action.kind === "add-alias") {
      const aliasLabel = action.args.aliasLabel
        ? String(action.args.aliasLabel)
        : action.args.alias
          ? String(action.args.alias)
          : "";
      const canonicalNodeId = action.args.canonicalNodeId
        ? String(action.args.canonicalNodeId)
        : action.args.nodeId
          ? String(action.args.nodeId)
          : "";
      if (!aliasLabel || !canonicalNodeId) {
        console.error(
          "--knowledge add-alias requires aliasLabel=... canonicalNodeId=..."
        );
        process.exit(1);
      }
      const alias = await store.addAlias({ aliasLabel, canonicalNodeId });
      if (asJson) console.log(JSON.stringify(alias, null, 2));
      else {
        console.log(
          `[knowledge] alias "${alias.aliasLabel}" → ${alias.canonicalNodeId}`
        );
      }
      return;
    }
    if (action.kind === "merge") {
      const fromId = action.args.fromId
        ? String(action.args.fromId)
        : "";
      const intoId = action.args.intoId
        ? String(action.args.intoId)
        : "";
      if (!fromId || !intoId) {
        console.error("--knowledge merge requires fromId=... intoId=...");
        process.exit(1);
      }
      const result = await store.mergeNodes({ fromId, intoId });
      if (asJson) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(
          `[knowledge] merge ${result.from.label} (${result.from.id}) → ${result.into.label} (${result.into.id}) edgesRewired=${result.edgesRewired} aliasCreated=${result.aliasCreated}`
        );
      }
      return;
    }
    if (action.kind === "contradictions") {
      const nodeId = action.args.nodeId
        ? String(action.args.nodeId)
        : undefined;
      const reader = createKnowledgeReader(store);
      const result = await reader.findContradictions({ nodeId });
      if (asJson) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(renderContradictionsRead(result));
      }
      return;
    }
    if (action.kind === "mark-contradiction") {
      const fromId = action.args.fromId
        ? String(action.args.fromId)
        : "";
      const toId = action.args.toId ? String(action.args.toId) : "";
      if (!fromId || !toId) {
        console.error(
          "--knowledge mark-contradiction requires fromId=... toId=..."
        );
        process.exit(1);
      }
      const edge = await store.markContradiction({ fromId, toId });
      if (asJson) console.log(JSON.stringify(edge, null, 2));
      else {
        console.log(
          `[knowledge] contradicts ${edge.fromNodeId} → ${edge.toNodeId}`
        );
      }
      return;
    }
    if (action.kind === "supersede") {
      const oldClaimId = action.args.oldClaimId
        ? String(action.args.oldClaimId)
        : "";
      const newClaimId = action.args.newClaimId
        ? String(action.args.newClaimId)
        : "";
      if (!oldClaimId || !newClaimId) {
        console.error(
          "--knowledge supersede requires oldClaimId=... newClaimId=..."
        );
        process.exit(1);
      }
      const edge = await store.supersedeClaim({ oldClaimId, newClaimId });
      if (asJson) console.log(JSON.stringify(edge, null, 2));
      else {
        console.log(
          `[knowledge] supersedes ${edge.fromNodeId} → ${edge.toNodeId}`
        );
      }
      return;
    }
    if (action.kind === "fp") {
      const topic =
        action.topic?.trim() ||
        (action.args.topic ? String(action.args.topic).trim() : "");
      if (!topic) {
        console.error('--knowledge fp requires --topic "..." or topic=...');
        process.exit(1);
      }
      const out = await runFirstPrinciplesAnalysis({
        store,
        topic,
        goal: action.args.goal ? String(action.args.goal) : undefined,
        projectLabel: action.args.projectLabel
          ? String(action.args.projectLabel)
          : undefined,
        workspaceId: action.args.workspaceId
          ? String(action.args.workspaceId)
          : undefined,
      });
      if (asJson) {
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log(
          `[knowledge] fp mode=${out.mode} topic=${topic} event=${out.eventId} proposals=${out.proposals.length}${out.projectId ? ` project=${out.projectId}` : ""}`
        );
        console.log(`  goal: ${out.analysis.goal}`);
        console.log(
          `  laws=${out.analysis.laws.length} limits=${out.analysis.limits.length} bottlenecks=${out.analysis.bottlenecks.length} relations=${out.analysis.relations.length}`
        );
        for (const p of out.proposals.slice(0, 12)) {
          console.log(`  ${p.id}  ${p.kind}  pending`);
        }
        if (out.proposals.length > 12) {
          console.log(`  … +${out.proposals.length - 12} more`);
        }
        console.log(
          "[knowledge] proposals only — use --knowledge accept <id> to commit"
        );
      }
      return;
    }
  } finally {
    store.close();
  }
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
    if (stage.structuredOk != null) {
      console.log(
        `[structured] ${stage.structuredOk ? "ok" : "fail"}${
          stage.structuredAttempts != null
            ? `  attempts=${stage.structuredAttempts}`
            : ""
        }${stage.structuredError ? `  (${stage.structuredError})` : ""}`
      );
    }
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
    if (!result.ok) process.exitCode = 1;
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
  meta?: {
    sessionId?: string;
    logicalSessionId?: string;
    historyCount?: number;
    latencyMs?: number;
    workspaceRoot?: string;
    workspaceId?: string;
  }
): void {
  if (asJson) {
    // M5: stdout is pure JSON only
    console.log(
      JSON.stringify(
        {
          ...result,
          sessionId: meta?.sessionId,
          logicalSessionId: meta?.logicalSessionId,
          historyCount: meta?.historyCount,
          latencyMs: meta?.latencyMs,
          workspaceRoot: meta?.workspaceRoot,
          workspaceId: meta?.workspaceId,
        },
        null,
        2
      )
    );
    return;
  }
  if (meta?.sessionId) {
    const logical =
      meta.logicalSessionId && meta.logicalSessionId !== meta.sessionId
        ? `  logical=${meta.logicalSessionId}`
        : "";
    console.log(
      `[session] ${meta.sessionId}${logical}${
        meta.historyCount != null ? `  (history=${meta.historyCount})` : ""
      }`
    );
  }
  if (meta?.workspaceId || meta?.workspaceRoot) {
    console.log(
      `[workspace] ${meta.workspaceId ?? "-"}${
        meta.workspaceRoot ? `  ${meta.workspaceRoot}` : ""
      }`
    );
  }
  console.log(
    `\n[route] ${result.routing.reason}  (type=${result.routing.taskType}, complexity=${result.routing.complexity})`
  );
  console.log(`[model] ${result.provider}/${result.model}`);
  if (result.policy) {
    console.log(
      `[policy] ${result.policy.tier}  ${result.policy.reason}${
        result.policy.budgetCapped ? "  (budget-capped)" : ""
      }`
    );
  }
  if (meta?.latencyMs != null) {
    console.log(`[latency] ${meta.latencyMs}ms`);
  }
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
  if (result.interactionMode) {
    console.log(
      `[mode] ${result.interactionMode}  proposals=${result.proposalsEnabled ? "on" : "off"}  pending=${result.pendingProposalCount ?? 0}`
    );
  }
  if (result.proposals && result.proposals.length > 0) {
    console.log(
      `[capture] +${result.proposals.length} pending (accept with --knowledge accept <id> or /accept)`
    );
    for (const p of result.proposals.slice(0, 8)) {
      console.log(`  ${p.id}  ${p.kind}  ${p.label.slice(0, 80)}`);
    }
  } else if (result.capture && !result.capture.ran && result.capture.reason) {
    console.log(`[capture] skipped: ${result.capture.reason}`);
  }
  if (result.usage?.totalTokens != null) {
    console.log(`[tokens] ${result.usage.totalTokens}`);
  }
  console.log(`\n${result.reply}\n`);
}

async function runOnce(
  orch: Orchestrator,
  args: CliArgs,
  memory: Memory | null,
  ws: WorkspaceContext
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

  const effectiveSessionId = ws.sessionId;
  const cmd = await tryHandleSessionCommand(args.prompt, {
    memory: memory && args.useMemory ? memory : null,
    sessionId: effectiveSessionId,
    knowledge: orch.knowledge,
  });
  if (cmd.kind === "handled") {
    if (args.json) {
      console.log(
        JSON.stringify(
          { ok: true, message: cmd.message, sessionState: cmd.sessionState, data: cmd.data },
          null,
          2
        )
      );
    } else {
      console.log(cmd.message);
    }
    return;
  }

  const sessionState =
    memory && args.useMemory
      ? await memory.getSessionState(effectiveSessionId)
      : null;
  const forceCapture = cmd.kind === "force_capture";
  const promptForModel =
    forceCapture && cmd.restPrompt === "capture last segment"
      ? "(Session capture of recent conversation — acknowledge briefly.)"
      : forceCapture
        ? cmd.restPrompt
        : args.prompt;

  const history =
    memory && args.useMemory
      ? await memory.getHistory(effectiveSessionId)
      : [];

  const started = performance.now();
  const lastExtractAt = sessionState?.lastExtractTurnId
    ? Number(sessionState.lastExtractTurnId)
    : undefined;
  const result = await orch.handle(promptForModel, {
    forceModel: args.forceModel,
    history,
    sessionId: effectiveSessionId,
    interactionMode: sessionState?.interactionMode ?? "active",
    proposalsEnabled: sessionState?.proposalsEnabled ?? true,
    forceCapture,
    maxProposalsPerTurn: sessionState?.maxProposalsPerTurn,
    minUserMessageLength: sessionState?.minUserMessageLength,
    lastExtractAt: Number.isFinite(lastExtractAt) ? lastExtractAt : undefined,
  });
  const latencyMs = Math.round(performance.now() - started);

  if (memory && args.useMemory) {
    // Do not auto-store system prompts — only the user turn + assistant reply.
    await memory.add(effectiveSessionId, {
      role: "user",
      content: forceCapture ? `/capture ${cmd.kind === "force_capture" ? cmd.restPrompt : ""}`.trim() : args.prompt,
    });
    await memory.add(effectiveSessionId, {
      role: "assistant",
      content: result.reply,
    });
    if (result.capture?.ran) {
      await memory.updateSessionState(effectiveSessionId, {
        lastExtractTurnId: String(Date.now()),
      });
    }
  }

  printResult(result, args.json, {
    sessionId: args.useMemory ? effectiveSessionId : undefined,
    logicalSessionId: args.useMemory ? ws.logicalSessionId : undefined,
    historyCount: history.length,
    latencyMs,
    workspaceRoot: orch.getWorkspaceRoot(),
    workspaceId: ws.id,
  });
}

/**
 * M18: STT → Orchestrator.handle → optional TTS (same brain as text).
 */
async function runVoiceOnce(
  orch: Orchestrator,
  args: CliArgs,
  memory: Memory | null,
  ws: WorkspaceContext
): Promise<void> {
  const voiceCfg = loadVoiceConfig(process.env);
  // One-shot CLI is explicit opt-in via --voice-once (does not require VOICE_ENABLED for mock/transcript).
  // Continuous ambient listening is not implemented; VOICE_ENABLED documents session policy.
  if (
    !args.voiceTranscript &&
    !args.voiceAudioPath &&
    !args.prompt &&
    !voiceCfg.mockTranscript
  ) {
    console.error(
      "--voice-once requires --transcript TEXT, --audio PATH, prompt text, or VOICE_MOCK_TRANSCRIPT"
    );
    process.exit(1);
  }

  const stt = createSttAdapter({
    ...voiceCfg,
    // Prefer mock when only transcript is supplied (no mic)
    sttProvider:
      args.voiceAudioPath && voiceCfg.sttProvider !== "mock"
        ? voiceCfg.sttProvider
        : args.voiceTranscript || args.prompt || voiceCfg.mockTranscript
          ? voiceCfg.sttProvider === "cloud" && !args.voiceAudioPath
            ? "mock"
            : voiceCfg.sttProvider
          : voiceCfg.sttProvider,
    mockTranscript:
      args.voiceTranscript ||
      args.prompt ||
      voiceCfg.mockTranscript ||
      undefined,
  });
  const tts = createTtsAdapter(
    args.voiceSilent ? { ...voiceCfg, ttsProvider: "off" } : voiceCfg
  );

  const effectiveSessionId = ws.sessionId;
  const history =
    memory && args.useMemory
      ? await memory.getHistory(effectiveSessionId)
      : [];

  const started = performance.now();
  const turn = await runVoiceTurn(
    {
      stt,
      tts,
      language: voiceCfg.language,
      handle: async (text) => {
        const result = await orch.handle(text, {
          forceModel: args.forceModel,
          history,
          sessionId: effectiveSessionId,
        });
        return { reply: result.reply };
      },
    },
    {
      transcript:
        args.voiceTranscript ||
        args.prompt ||
        voiceCfg.mockTranscript ||
        undefined,
      audioPath: args.voiceAudioPath,
      silent: args.voiceSilent,
      language: voiceCfg.language,
    }
  );
  const latencyMs = Math.round(performance.now() - started);

  if (memory && args.useMemory) {
    await memory.add(effectiveSessionId, {
      role: "user",
      content: turn.transcript,
    });
    await memory.add(effectiveSessionId, {
      role: "assistant",
      content: turn.reply,
    });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          viaVoice: true,
          transcript: turn.transcript,
          reply: turn.reply,
          stt: turn.stt,
          tts: turn.tts,
          sessionId: args.useMemory ? effectiveSessionId : undefined,
          latencyMs,
          workspaceId: ws.id,
        },
        null,
        2
      )
    );
  } else {
    console.log(`[voice] stt=${turn.stt.provider} remote=${turn.stt.remote}`);
    console.log(`[voice] heard: ${turn.transcript}`);
    console.log(turn.reply);
    if (turn.tts?.spoken) {
      console.log(
        `[voice] tts=${turn.tts.provider} spoken=true${turn.tts.utterance ? ` (${turn.tts.utterance.slice(0, 60)}…)` : ""}`
      );
    } else {
      console.log(`[voice] tts=${turn.tts?.provider ?? "off"} spoken=false`);
    }
  }
}

async function runRepl(
  orch: Orchestrator,
  args: CliArgs,
  memory: Memory | null,
  initialWs: WorkspaceContext
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let ws = initialWs;
  console.log(
    "Orchestrator REPL (empty line or Ctrl+C to exit).\n" +
      "Commands: /mode /proposals /capture /accept /reject /local /frontier /route /pipeline /voice /tool /remember /recall /forget /ltm /clear /session /workspace"
  );
  if (memory && args.useMemory) {
    const n = (await memory.getHistory(ws.sessionId)).length;
    console.log(
      `[session] ${ws.sessionId}  logical=${ws.logicalSessionId}  (history=${n})`
    );
    console.log(`[workspace] ${ws.id}  ${ws.rootPath}`);
  }

  try {
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;

      if (line === "/workspace") {
        console.log(
          `[workspace] id=${ws.id}\n  root=${ws.rootPath}\n  contextDir=${ws.contextDir}\n  sessionPrefix=${ws.sessionPrefix || "(none)"}\n  logical=${ws.logicalSessionId}\n  effective=${ws.sessionId}`
        );
        continue;
      }

      if (line.startsWith("/voice")) {
        const transcript = line.replace(/^\/voice\s*/, "").trim();
        if (!transcript) {
          console.log("Usage: /voice <spoken text as transcript>");
          continue;
        }
        await runVoiceOnce(
          orch,
          {
            ...args,
            voiceOnce: true,
            voiceTranscript: transcript,
            voiceSilent: true,
            prompt: "",
          },
          memory,
          ws
        );
        continue;
      }

      // Interaction mode + capture commands (same as design slash surface)
      if (
        line.startsWith("/mode") ||
        line.startsWith("/proposals") ||
        line.startsWith("/capture") ||
        line.startsWith("/accept") ||
        line.startsWith("/reject")
      ) {
        await runOnce(
          orch,
          { ...args, prompt: line, routeOnly: false },
          memory,
          ws
        );
        continue;
      }

      if (line === "/clear") {
        if (!memory || !args.useMemory) {
          console.log("Memory is disabled.");
          continue;
        }
        await memory.clear(ws.sessionId);
        console.log(
          `Cleared session "${ws.sessionId}" (logical=${ws.logicalSessionId})`
        );
        continue;
      }

      if (line.startsWith("/session ")) {
        const next = line.slice(9).trim();
        if (!next) {
          console.log("Usage: /session <id>");
          continue;
        }
        ws = resolveWorkspace({
          workspaceRoot: ws.rootPath,
          sessionId: next,
        });
        if (memory && args.useMemory) {
          const n = (await memory.getHistory(ws.sessionId)).length;
          console.log(
            `[session] ${ws.sessionId}  logical=${ws.logicalSessionId}  (history=${n})`
          );
        } else {
          console.log(
            `[session] ${ws.sessionId}  logical=${ws.logicalSessionId}`
          );
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
            sessionId: ws.logicalSessionId,
            useMemory: args.useMemory,
            clearSession: false,
            listSessions: false,
          },
          memory,
          ws
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

  // M9: resolve workspace first (tools root, session namespace, project context)
  const ws = resolveWorkspace({
    workspaceRoot: args.workspace,
    sessionId: args.sessionId,
  });
  process.env.WORKSPACE_ROOT = ws.rootPath;

  const memory =
    args.useMemory || args.clearSession || args.listSessions
      ? openMemoryFromEnv()
      : null;

  try {
    if (args.listSessions) {
      if (!memory) {
        console.error("Memory is required for --list-sessions");
        process.exit(1);
      }
      const prefix = ws.sessionPrefix || undefined;
      const ids = await memory.listSessions(prefix);
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              workspaceId: ws.id,
              workspaceRoot: ws.rootPath,
              sessionPrefix: ws.sessionPrefix,
              sessions: ids,
            },
            null,
            2
          )
        );
      } else {
        console.log(
          `[workspace] ${ws.id}  ${ws.rootPath}${
            prefix ? `  prefix=${prefix}` : ""
          }`
        );
        if (ids.length === 0) {
          console.log("(no sessions)");
        } else {
          for (const id of ids) {
            console.log(id);
          }
        }
      }
      return;
    }

    if (args.clearSession) {
      if (!memory) {
        console.error("Memory is required for --clear-session");
        process.exit(1);
      }
      await memory.clear(ws.sessionId);
      console.log(
        `Cleared session "${ws.sessionId}" (logical=${ws.logicalSessionId})`
      );
      return;
    }

    const config = loadConfigFromEnv(process.env, {
      workspaceRoot: ws.rootPath,
      sessionId: ws.logicalSessionId,
    });
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

      if (args.knowledgeAction) {
        await runKnowledgeAction(args.knowledgeAction, args.json, {
          workspaceRoot: args.workspace,
        });
        return;
      }

      if (args.pipelineTask) {
        await runPipelineTask(orch, args.pipelineTask, args.json);
        return;
      }

      if (args.voiceOnce) {
        await runVoiceOnce(orch, args, memory, ws);
        return;
      }

      if (!args.prompt) {
        await runRepl(orch, args, memory, ws);
        return;
      }

      await runOnce(orch, args, memory, ws);
    } finally {
      orch.close();
    }
  } finally {
    memory?.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

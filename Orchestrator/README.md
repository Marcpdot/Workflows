# Orchestrator (Milestone 0)

Minimal modular TypeScript orchestrator:

1. Receive user request  
2. Analyze task type + complexity  
3. Route to **local (Ollama CLI)** or **frontier (xAI Grok)**  
4. Call selected model  
5. Return reply  

## Setup

```bash
cd Orchestrator
npm install
cp .env.example .env
# Set XAI_API_KEY (local default from env: llama3.2:3b)
```

Requires:

- **Node.js** ≥ 20  
- **Ollama** on PATH (or `OLLAMA_BIN`) with a pulled model  
- **xAI API key** for Grok (`XAI_API_KEY`)

## Usage

```bash
# One-shot (persists history under session "default")
npm run dev -- "Oppsummer denne teksten: ..."
npm run dev -- --session demo "Husk at navnet mitt er Ada"
npm run dev -- --session demo "Hva heter jeg?"
npm run dev -- --route-only "Design a distributed cache"
npm run dev -- --local "Skriv en TypeScript helper"
npm run dev -- --frontier "Reason step by step about ..."
npm run dev -- --no-memory "Stateless one-shot"
npm run dev -- --clear-session --session demo

# Interactive REPL
npm run dev
```

Build:

```bash
npm run build
npm start -- "hello"
```

## Memory (Milestone 0 short-term + 3A long-term)

SQLite-backed short-term chat history per `sessionId` (survives restarts). No embeddings yet.

### Long-term facts (Milestone 3A)

Separate store for durable facts/preferences (keyword/`key` recall — no embeddings).
Default DB: `./data/longterm.db` (gitignored). Prefer `PERSONAL_CONTEXT_DIR` outside the repo for real personal data.

```bash
npx tsx scripts/smoke-longterm.ts
npm run dev -- --ltm remember key=user.preferred_name content=Ada
npm run dev -- --ltm recall key=user.preferred_name
npm run dev -- --ltm recall text=Ada
npm run dev -- --ltm list
npm run dev -- --ltm forget user.preferred_name
```

`orch.longTerm` is available programmatically. `LONGTERM_AUTO_INJECT=true` can add top keyword hits as a system block (off by default).

## Proactivity (Milestone 3B)

When `PROACTIVE_ENABLED=true`, after each reply the CLI may print **0–3**
suggested next steps (`[next] …`) from heuristics (bug → smoke, file paths →
tools, architecture hits → update `context/`, etc.). Suggestions are metadata
only — nothing is auto-executed. Default is **off**.

```bash
npx tsx scripts/smoke-proactive.ts
# PROACTIVE_ENABLED=true npm run dev -- "TypeError crash in router"
```

## Embeddings (Milestone 4)

Pluggable local embedder (Ollama) + SQLite float32 vectors (linear scan).
**Default off** (`EMBEDDINGS_ENABLED=false`) — keyword LTM/retrieval unchanged.

When enabled:
- `remember` / `forget` index LTM facts in `VECTOR_DB_PATH`
- `recall(text)` merges keyword + cosine hits
- retrieval merges semantic `context/` hits with keyword (RRF-style)

```bash
npx tsx scripts/smoke-embeddings.ts
# EMBEDDINGS_ENABLED=true EMBEDDING_MODEL=nomic-embed-text npm run dev -- "..."
```

## Multi-agent pipeline (Milestone 3C)

Sequential roles only (not a swarm). Default: **planner → worker**.
Explicit CLI — normal `handle()` stays unchanged.

```bash
npx tsx scripts/smoke-agents.ts
npm run dev -- --pipeline "Add a smoke test for long-term memory"
# REPL: /pipeline ...
```

Worker may use tools (existing registry/loop). Planner is limited to
read/list/search. Role prompts are generic (no personal profile in repo).

```ts
import { createMemory } from "./memory/index.js";

const memory = createMemory({ dbPath: "./data/memory.db" });
const history = await memory.getHistory("default", 20);
const result = await orch.handle(prompt, { history });
await memory.add("default", { role: "user", content: prompt });
await memory.add("default", { role: "assistant", content: result.reply });
```

Env: `SESSION_ID`, `MEMORY_DB_PATH` (default `./data/memory.db`), `MEMORY_HISTORY_LIMIT`.

## Compression (Milestone 1)

When history grows past a threshold, older turns are summarized with the **local** model; the last `keepRecent` messages stay raw. Full history is still stored in SQLite — compression only affects what is sent to the model.

```ts
import { compressHistory, LocalModelSummarizer } from "./compression/index.js";

const { summary, recentMessages, compressed } = await compressHistory(
  history,
  { threshold: 20, keepRecent: 8 },
  summarizer
);
```

Env: `COMPRESSION_THRESHOLD` (20), `COMPRESSION_KEEP_RECENT` (8), `COMPRESSION_DISABLED`.

Smoke test:

```bash
npx tsx scripts/smoke-compression.ts
```

## Retrieval (Milestone 1)

Deterministic keyword retrieval over **session history** and **`context/*.md`**
(Keep the Why). Runs *before* compression; results are injected as a system
block (`Retrieved context: …`) with hard `limit` / `maxChars` caps. No embeddings.

```ts
import { retrieve } from "./retrieval/index.js";

const chunks = await retrieve(prompt, {
  sessionMessages: history,
  contextDir: "../context",
  limit: 4,
  maxChars: 2000,
});
```

Env: `RETRIEVAL_LIMIT`, `RETRIEVAL_MAX_CHARS`, `RETRIEVAL_CONTEXT_DIR`, `RETRIEVAL_DISABLED`.

```bash
npx tsx scripts/smoke-retrieval.ts
```

## Tools (Milestone 2)

### Phase A — interface + manual execute

Pluggable tool interface + registry. Built-ins: `read_file`, `list_dir`,
`run_command` (whitelist: node/npm/npx/tsc/git status|diff|log|branch).
Paths cannot escape `TOOL_WORKSPACE_ROOT`.

```bash
npx tsx scripts/smoke-tools.ts
npm run dev -- --tool list
npm run dev -- --tool run read_file path=package.json
```

### Phase B — model-driven tool loop

When `TOOLS_ENABLED=true`, `handle()` runs `runToolLoop`: model may request
tools (structured API calls or JSON text), registry executes them, results
are appended, model continues (max `TOOLS_MAX_STEPS`, default 5). Default is
**off** so existing chat path is unchanged.

```bash
npx tsx scripts/smoke-tool-loop.ts
# TOOLS_ENABLED=true npm run dev -- "What is the name field in package.json?"
```

CLI logs each step: `[tool] read_file ok  12ms`.

### Phase C — more tools + plugins

Additional built-ins: `write_file`, `search_files`, `run_script` (under
`TOOL_SCRIPT_ROOTS`), `web_search` (off unless `WEB_SEARCH_ENABLED=true`).

```bash
npx tsx scripts/smoke-tools-phase-c.ts
```

**Add your own tool** (no loop/orchestrator changes):

```ts
// examples/extra-tools/myTool.ts
import type { Tool } from "../../src/tools/types.js";
export const tools: Tool[] = [{ name: "my_tool", description: "...", parameters: [], execute: async () => ({ ok: true, output: "hi" }) }];
```

```bash
# TOOL_EXTRA_MODULES=./examples/extra-tools/echoTool.ts
```

Or in code:

```ts
const registry = await createRegistryFromConfig({
  extraModules: ["./examples/extra-tools/echoTool.ts"],
});
```

## Eval (Milestone 1)

Fixed cases in `eval/cases.json`. Runner exercises the real orchestrator path:

```bash
npx tsx scripts/run-eval.ts
npx tsx scripts/run-eval.ts --case memory-name-recall
npx tsx scripts/run-eval.ts --json
```

Reports land in `data/eval-results/`. Exit code `1` if any case fails.

Each result includes tokens and a rough USD cost estimate:

- **Frontier:** uses API `usage` when present; cost from `EVAL_COST_INPUT_PER_M` / `EVAL_COST_OUTPUT_PER_M` (defaults 1.25 / 2.5 per 1M tokens).
- **Local:** cost `0`; tokens estimated as `ceil(chars/4)` when Ollama does not return usage (`tokensEstimated: true`, shown as `tok~` in the CLI).

Report `summary` aggregates `totalTokens`, `estimatedCostUsd`, and `tokensEstimatedCases`.

## Layout

| File | Role |
|------|------|
| `src/router.ts` | Task analysis + routing rules |
| `src/models/local.ts` | Ollama CLI client (`ollama run`) |
| `src/models/frontier.ts` | xAI Grok client (chat completions) |
| `src/memory/` | SQLite session history |
| `src/compression/` | Realtime history compression |
| `src/retrieval/` | Keyword retrieval (session + context/) |
| `src/tools/` | Tool interface, registry, builtins |
| `src/embeddings/` | Embedder, vector store, semantic search |
| `src/eval/` | Eval types, assertions, runner |
| `eval/cases.json` | Fixed eval cases |
| `src/orchestrator.ts` | Wire routing + compression + models |
| `src/types.ts` | Shared types |
| `src/index.ts` | CLI entry |

## Routing (Milestone 0)

- low / summarize / tool → local  
- medium code → local  
- high / research / reasoning → frontier (Grok)  


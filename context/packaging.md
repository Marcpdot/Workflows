# Packaging

## Layer packages under `packages/` (A–F complete)

**Status:** active  
**Evidence:** confirmed  
**Source:** `docs/PACKAGE_REFACTOR.md` (plan + execution); Step F layout; root `Orchestrator/` removed after  

Runnable glue is **`packages/orchestrator`**. Feature layers are sibling folders under `packages/`, each with `package.json` (`@workflows/<name>`, `file:` deps). No npm workspaces.

| Package | Role |
|---------|------|
| `orchestrator` | Router, handle, CLI, UI, config; integration HTTP |
| `memory` | Short-term + long-term SQLite |
| `models` | Ollama CLI + Grok/mid clients |
| `tools` | Registry, builtins, path safety, tool loop |
| `eval` | Cases, assertions, cost helpers, suite runner |
| `compression` | Realtime history compression |
| `embeddings` | Embedder + vector store |
| `retrieval` | Keyword (+ semantic when embeddings on) |
| `workspace` | Session namespace + project context |
| `policy` | Compute budgets / tiers |
| `structured` | completeStructured + JSON parse helpers |
| `observability` | JSONL events |
| `proactive` | Next-step suggestions |
| `agents` | Sequential multi-role pipeline |

**Integration HTTP** lives under `packages/orchestrator/src/integration` (not a separate package) so the HTTP adapter can import the Orchestrator class without a circular package graph.

**How to run:**

```bash
cd packages/orchestrator
npm install
npm run dev
```

**Reason:** After M0–M10 shells existed, the stack was unreadable as one fat app tree. Folders-by-layer answer “where is X?” without workspaces complexity.

**Rejected alternatives:**

- **npm workspaces monorepo tooling for A–F** — folders + `file:` deps were enough.
- **Separate `packages/integration`** — circular with the orchestrator brain.
- **Keep forever as single root `Orchestrator/src` monolith** — superseded by A–F.
- **Keep an empty root `Orchestrator/` pointer forever** — removed once the move was stable; only local leftovers if any are gitignored.

### Typecheck / imports

- **orchestrator:** `rootDir: "src"`; layers via `@workflows/*` (junctions under `node_modules`).
- **layers:** own `tsconfig` (`noEmit`); Node types often via `typeRoots` → `../orchestrator/node_modules/@types`.
- **eval runner** still constructs Orchestrator from `packages/orchestrator` so the suite hits the real handle path.

### Extraction order (what landed)

| Step | What moved |
|------|------------|
| A | `eval` |
| B | `models` |
| C | `memory` (+ longterm) |
| D | `tools` |
| E | satellites (compression → agents; integration stayed with glue) |
| F | thin `packages/orchestrator`; root pointer removed |

Full mechanical plan: `docs/PACKAGE_REFACTOR.md`.

### Historical note

> Superseded: “stay monolith after M10” (re-confirmed once, then reversed by executing the approved refactor plan).

Earlier the whole stack lived under root `Orchestrator/`. That was intentional until shells existed; A–F is the deliberate follow-up.

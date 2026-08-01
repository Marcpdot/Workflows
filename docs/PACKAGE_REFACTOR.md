# Package refactor plan

**Status:** complete (Steps A–F landed; see `packages/` + `packages/orchestrator`)  
**Goal:** Make the repo readable (a newcomer can find each layer) without changing runtime behavior.  
**Trigger:** M4–M10 shells delivered; almost everything still lives under `Orchestrator/`.

This document is the **only** authority for the packaging refactor. Implementers (human or AI) must follow it strictly.

---

## 1. Principles (non-negotiable)

1. **Behavior freeze** — No feature work, no “while we’re here” fixes, no score tuning, no new env vars unless required for path resolution after a move.
2. **Move, don’t redesign** — Same public functions, same CLI flags, same smokes.
3. **One step = one PR (or one commit series that can be reverted alone)** — Never mix two layers in one step.
4. **Green smokes after every step** — Listed checks must pass before starting the next step.
5. **Single door per layer** — Each layer exposes only `index.ts` (or documented entry). No deep imports from other layers into internals.
6. **Orchestrator becomes glue** — After the plan, it wires layers and owns CLI/UI entrypoints; it does not *contain* memory/tools/eval implementations.
7. **No new package manager complexity required** — Prefer folders + relative imports first. npm workspaces only if a later step explicitly needs them (out of scope for steps A–F).
8. **Update docs/paths in the same step** — README, `.env.example` comments, AGENTS.md paths, smoke import paths.
9. **Keep the Why** — If a packaging *decision* is made (e.g. keep single root package.json), add a short `context/packaging.md` update. Do not invent decisions.

### Explicitly forbidden during this refactor

- Renaming public APIs (`createMemory`, `retrieve`, tool names, CLI flags)
- Changing default env values
- “Improving” embeddings index, policy persistence, UI design
- Adding authentication, streaming, or new milestones
- Big-bang move of all folders in one PR
- Introducing abstract factories / DI frameworks

---

## 2. Target layout (child-readable)

```text
Workflows/
  README.md                 # what it is + map of folders
  ARCHITECTURE.md
  context/                  # Keep the Why (unchanged role)
  docs/
    PACKAGE_REFACTOR.md     # this file
  packages/
    orchestrator/           # thin: router, handle(), CLI, UI entry, HTTP wiring
    memory/                 # short-term + longterm
    models/                 # local + frontier/mid clients
    tools/                  # registry, builtins, path safety
    retrieval/              # keyword (+ calls embeddings when enabled)
    embeddings/             # embedder, vector store
    compression/            # realtime compression
    eval/                   # cases runner helpers
    policy/                 # compute policy
    workspace/              # session/workspace resolve
    integration/            # HTTP contract + server helpers
    structured/             # structured output helpers
    observability/          # JSONL observer
    proactive/              # suggestions
    agents/                 # role pipeline
  scripts/                  # optional: cross-cutting smokes at repo root
                            # OR keep smokes next to orchestrator during transition
```

**Note:** During intermediate steps, paths may still live under `Orchestrator/packages/...` if a single move is safer. End state should match the map above (or an equally flat `packages/` at repo root). Prefer **repo-root `packages/`** so Workflows is clearly multi-layer, not “one app folder.”

Minimum readable bar: *“Where is memory?” → `packages/memory`.*

---

## 3. Execution order

Do **not** skip ahead. After each step: run the step’s smoke list; fix only breakages caused by the move.

### Step A — `eval`

- Move eval implementation out of the orchestrator src tree into `packages/eval`.
- Keep `eval/cases.json` path discoverable (document new path; update runner).
- **Smoke:** existing eval unit/smoke scripts that don’t need a live model; `run-eval` import path works.

### Step B — `models`

- Move local + frontier (mid) clients to `packages/models`.
- Orchestrator imports from packages/models only.
- **Smoke:** typecheck; any model-client unit smoke if present; CLI `--route-only` still runs.

### Step C — `memory` (+ longterm)

- Move short-term + longterm to `packages/memory`.
- Preserve DB env paths and APIs.
- **Smoke:** `smoke-memory` / `smoke-longterm` (or current names).

### Step D — `tools`

- Move tool types, registry, builtins, path safety to `packages/tools`.
- **Smoke:** `smoke-tools`, `smoke-tools-phase-c`, `smoke-tool-loop`.

### Step E — satellite layers (one PR each is ideal; batch only if tiny)

Suggested sub-order:

1. `compression`
2. `retrieval` (depends on embeddings types carefully — move embeddings **before** or **with** retrieval if imports tangle)
3. `embeddings`
4. `workspace`
5. `policy`
6. `structured`
7. `observability`
8. `proactive`
9. `agents`
10. `integration` (HTTP helpers; entry may stay callable from orchestrator)

**Smoke:** each layer’s existing `scripts/smoke-*.ts` after its move.

### Step F — thin `packages/orchestrator`

- What remains: routing, `Orchestrator` class / `handle`, CLI `index`, UI entry, config load, wiring factories.
- Delete empty old `Orchestrator/src/...` shells.
- Root README: folder map + “start at packages/orchestrator”.
- **Smoke:** full offline suite + `smoke-integration` + `smoke-ui` (static) + one CLI `--json --route-only`.

---

## 4. Definition of done (whole refactor)

- [ ] No feature layer implementation remains under a bloated monolith src except thin wiring
- [ ] Layout matches §2 (or documented deviation with reason in `context/packaging.md`)
- [ ] All previous offline smokes pass from documented commands
- [ ] CLI flags and HTTP contract unchanged
- [ ] Root README has a simple map
- [ ] `context/packaging.md` records the final packaging decision

---

## 5. Prompt template for AI implementers

Copy per step:

```text
Execute ONLY Step <X> from docs/PACKAGE_REFACTOR.md.
- Move code as specified; update imports and doc paths.
- No behavior changes, no API renames, no new features.
- Run the smokes listed for this step and fix only move-related failures.
- Do not start Step <X+1>.
- If you must deviate, stop and document why; do not silently expand scope.
```

---

## 6. Rollback

Each step must be revertible with git revert of that step’s commits without leaving a half-moved layer. Prefer one layer per PR for that reason.

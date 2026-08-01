# Packaging

## Single Orchestrator package owns all layers (temporary)

**Status:** active  
**Evidence:** confirmed  
**Source:** repo layout; decision 2026-08-01; re-confirmed after M10 (working session)  
**Revisit when:** daily multi-project use makes boundary friction obvious, or a second consumer package is required

> **Re-confirmed after M10:** Vertical shells M0–M10 exist under `Orchestrator/`. Split into separately versioned layer packages is **still deferred** — ship usage and harden shells before packaging tax. Intended long-term shape (Orchestrator wires layers) unchanged; timeline is “not yet,” not “never.”

Implementation of memory, tools, eval, embeddings, integration HTTP, web UI, compute policy, observability, workspace, and structured output currently lives **under `Orchestrator/`**. The runnable unit is one Node package. Layer *names* show up as subfolders and local `AGENTS.md` files; layer *boundaries* as separately versioned packages remain deferred.

**Reason:** One place to run, one dependency tree, one path for Grok Build. The vertical is complete as shells; splitting without real multi-package consumers would still be speculative.

**Rejected alternatives:**

- **Split packages immediately after M10** — re-confirmed deferred: no second consumer yet, interfaces still thin, cost outweighs benefit.
- **Stop feature/usage work to split mid-stack** — same as pre-M10: speculative boundaries.
- **Keep forever as one package** — still rejected as the *final* state for a long-lived Jarvis-layer; only the *timing* of the split stays open.

**Intended follow-up:** When revisit triggers, split so Orchestrator primarily wires layers rather than containing all of them.

## Package folder extraction (in progress)

**Status:** active  
**Evidence:** confirmed  
**Source:** `docs/PACKAGE_REFACTOR.md` (approved plan); Step A executed  

Refactor proceeds **step-by-step** per `docs/PACKAGE_REFACTOR.md` (behavior freeze, one layer per step). Not a big-bang monorepo rewrite.

| Step | Layer | Location |
|------|--------|----------|
| A (done) | eval | `packages/eval/` (`cases.json` + `src/`) |

Orchestrator remains the runnable package (CLI/scripts). Further layers move only when their step runs — do not skip ahead.

### Typecheck / compile strategy (Step A follow-up)

**Status:** active  
**Evidence:** confirmed  
**Source:** Step A path cleanup after `rootDir: ".."` was rejected as too awkward  

- **Orchestrator** `tsconfig`: `rootDir: "src"`, `include` only `src/**/*` → `dist/index.js` (normal layout).
- **packages/eval** has its own `tsconfig` (`noEmit`) for **standalone** modules (`cost`, `assertions`, `types`). The suite `runner` still imports Orchestrator and is exercised via tsx scripts, not that isolated `tsc`.
- Orchestrator **runtime/type imports** of cost helpers use `file:../packages/eval` as `@workflows/eval` (`import … from "@workflows/eval/cost"`) so eval is resolved like a normal package (junction under `node_modules`), not compiled under Orchestrator’s `rootDir`.
- Scripts (`run-eval`, smokes) still use **relative** paths into `packages/eval` via tsx (suite runner still wires Orchestrator).

**Rejected:** `rootDir: ".."` + compiling `../packages/eval` into Orchestrator’s program — forces `dist/Orchestrator/src/...` and broken `main`/`start` paths.

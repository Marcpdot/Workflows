# Packaging

## Layer packages under `packages/` (Step F complete)

**Status:** active  
**Evidence:** confirmed  
**Source:** `docs/PACKAGE_REFACTOR.md` Steps A–F; layout after Step F  

Runnable glue is **`packages/orchestrator`**. Feature layers are sibling packages under `packages/` (memory, models, tools, eval, compression, embeddings, retrieval, workspace, policy, structured, observability, proactive, agents). Each layer is a folder with its own `package.json` (`@workflows/<name>`, `file:` deps). No npm workspaces required.

**Orchestrator package contains only:** routing, `Orchestrator` / `handle`, CLI `index`, UI entry, config load, and **integration HTTP** (must import the brain — kept with glue to avoid a circular package).

The old root `Orchestrator/` path is **removed** after Step F (no runtime role; start at `packages/orchestrator`).

**Reason:** Newcomers should answer “where is memory?” with `packages/memory`, not dig through a monolith `src/`. Glue stays thin; layers stay moveable.

**Rejected / deferred:**

- **npm workspaces monorepo tooling** — not required for A–F; folders + `file:` deps are enough.
- **Separate `packages/integration`** — circular with orchestrator brain; documented in Step E and kept inside `packages/orchestrator/src/integration`.
- **Keep forever as single `Orchestrator/src` monolith** — superseded by A–F extraction.

**How to run:**

```bash
cd packages/orchestrator
npm install
npm run dev
```

### Typecheck strategy

- **`packages/orchestrator`**: `rootDir: "src"`, imports layers as `@workflows/*` via `node_modules` junctions.
- **Layer packages**: own `tsconfig` (`noEmit`); `typeRoots` may point at `../orchestrator/node_modules/@types` for Node types.
- **Eval runner** still imports Orchestrator class from `packages/orchestrator` (suite exercises real handle path).

### Historical note

Earlier: single package under root `Orchestrator/` until M10 shells existed; then re-confirmed monolith briefly; then `PACKAGE_REFACTOR.md` executed A–F. Older context entries about “temporary monolith” are **superseded** by this layout.

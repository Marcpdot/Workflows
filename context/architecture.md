# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01  
**Revisit when:** post-M10 package refactor lands

Intended layers remain:

1. **Orchestration** — receive, route/policy, call model, return  
2. **Memory** — short-term + long-term (+ optional embeddings); session namespace per workspace (M9)  
3. **Tools** — external capabilities via one interface  
4. **Evaluation** — fixed cases, tokens/cost  
5. **Interface** — CLI, then optional UI  

Platform shells also present: embeddings, integration surface, compute policy, observability, **workspace/session (M9)**, **structured output (M10)**.

**Reason:** Jarvis-like personal system should be a **layer under many workflows**, not a single chatbot app. Layers let models and UIs change without losing progress.

## Current package shape

**Status:** active  
**Evidence:** confirmed  
**Source:** `docs/PACKAGE_REFACTOR.md` Step F; `packages/*` layout  

Feature layers live under **`packages/<layer>`**. Runnable glue is **`packages/orchestrator`** (router, handle, CLI, UI, integration HTTP). See [packaging.md](packaging.md).

**Reason:** Readable multi-layer layout without npm workspaces complexity; Orchestrator wires rather than owns every implementation.

**Rejected alternatives:**

- **One git repo per layer from day one** — more overhead than value while APIs were still moving.
- **Stay forever as single `Orchestrator/src` tree** — superseded by package refactor A–F.

See [packaging.md](packaging.md) and [milestones.md](milestones.md).

## Request path (conceptual)

**Status:** active  
**Evidence:** confirmed  
**Source:** `packages/orchestrator/src/orchestrator.ts`  

Typical `handle()` flow: resolve workspace/session (callers) → optional policy → route → retrieve/compress → complete or tool loop → optional suggestions → observability emit. Optional steps are env-gated so the core chat path stays simple. Pipeline planner can use **structured** plan JSON (M10) without changing raw chat.

**Reason:** One pipeline owns the vertical; features plug in without forking a second brain in UI or HTTP layers.

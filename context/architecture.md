# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01  
**Revisit when:** post-M10 package refactor

Intended layers remain:

1. **Orchestration** — receive, route/policy, call model, return  
2. **Memory** — short-term + long-term (+ optional embeddings)  
3. **Tools** — external capabilities via one interface  
4. **Evaluation** — fixed cases, tokens/cost  
5. **Interface** — CLI, then optional UI  

Plus platform concerns now present as shells: embeddings, integration surface, compute policy, observability. Still planned as first-class product work: workspace isolation (M9), structured output (M10).

**Reason:** Jarvis-like personal system should be a **layer under many workflows**, not a single chatbot app. Layers let models and UIs change without losing progress.

## Current package shape (pragmatic)

**Status:** active (temporary)  
**Evidence:** confirmed  
**Source:** repo layout under `Orchestrator/`  

Almost all implementation lives in the **Orchestrator package** (memory, tools, eval, embeddings, integration HTTP, web UI, policy, observability as subfolders). That is **not** the long-term discipline target.

**Reason:** Ship milestones end-to-end with one runnable package and one Build loop. Structure purity deferred until features exist to split.

**Rejected alternatives:**

- **One git repo per layer from day one** — more overhead than value while APIs were still moving.
- **Full modular monorepo packages before M3** — would slow delivery of a working path.

See [packaging.md](packaging.md) and [milestones.md](milestones.md).

## Request path (conceptual)

**Status:** active  
**Evidence:** confirmed  
**Source:** `Orchestrator/src/orchestrator.ts`  

Typical `handle()` flow: optional policy → route → retrieve/compress → complete or tool loop → optional suggestions → observability emit. Optional steps are env-gated so the core chat path stays simple.

**Reason:** One pipeline owns the vertical; features plug in without forking a second brain in UI or HTTP layers.

# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01; knowledge roadmap 2026-08-02  
**Revisit when:** layer list or handle pipeline shape changes

Intended layers remain:

1. **Orchestration** — receive, route/policy, call model, return  
2. **Memory** — short-term + long-term (+ optional embeddings); session namespace per workspace (M9)  
3. **Knowledge** (M11–M18 shells) — explicit concepts, claims, relations, events, provenance; extraction-with-approval; tools, project bind, ingest, FP workflow, read surface; optional voice I/O adapters only
4. **Tools** — external capabilities via one interface  
5. **Evaluation** — fixed cases, tokens/cost  
6. **Interface** — CLI, then optional UI  

Platform shells also present: embeddings, integration surface, compute policy, observability, **workspace/session (M9)**, **structured output (M10)**.

**Reason:** Jarvis-like personal system should be a **layer under many workflows**, not a single chatbot app. Layers let models and UIs change without losing progress. Plain MemoryFact text cannot carry first-principles structure; knowledge is the planned extension (see [knowledge.md](knowledge.md)).

## Current package shape

**Status:** active  
**Evidence:** confirmed  
**Source:** `docs/PACKAGE_REFACTOR.md` Step F; `packages/*` layout  

Feature layers live under **`packages/<layer>`**. Runnable glue is **`packages/orchestrator`** (router, handle, CLI, UI, integration HTTP). See [packaging.md](packaging.md).

When M11 lands, expect **`packages/knowledge`** (and possibly extraction helpers) wired the same way — orchestrator as lim, not owner of every implementation. M12 adds knowledge tools through the existing tools interface.

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

Future knowledge path (from M12): optional knowledge tools in the tool loop; neighborhood retrieval into context; extract proposals from a turn or file → review/commit. Same brain; no second orchestrator in UI. Voice (M18) is another client of the same tools.

**Reason:** One pipeline owns the vertical; features plug in without forking a second brain in UI or HTTP layers.

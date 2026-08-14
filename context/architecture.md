# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01; knowledge roadmap 2026-08-02; PR #33 WP1
**Revisit when:** layer list or handle pipeline shape changes

Intended layers remain:

1. **Orchestration** — receive, route/policy, call model, return  
2. **Memory** — durable raw experiences, compatible short-term history, and long-term memory (+ optional embeddings); session namespace per workspace (M9)
3. **Knowledge** — explicit concepts, claims, relations, events, provenance; extraction-with-approval; storage-independent canonical/graph/vector/spatial contracts; PostgreSQL/PostGIS canonical target; optional voice I/O adapters only
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

**`packages/knowledge`** owns knowledge-domain truth, repository contracts, extract, tools, ingest, identity, FP, and read. PostgreSQL/PostGIS is canonical; graph/vector backends are reconstructable projections. **`packages/voice`** is optional STT/TTS only. Orchestrator wires tools, CLI, inject, optional knowledge HTTP, and voice turns into the same `handle()` — not a second brain.

**Reason:** Readable multi-layer layout without npm workspaces complexity; Orchestrator wires rather than owns every implementation.

**Rejected alternatives:**

- **One git repo per layer from day one** — more overhead than value while APIs were still moving.
- **Stay forever as single `Orchestrator/src` tree** — superseded by package refactor A–F.

See [packaging.md](packaging.md) and [milestones.md](milestones.md).

## Request path (conceptual)

**Status:** active  
**Evidence:** confirmed  
**Source:** `packages/orchestrator/src/orchestrator.ts`  

Typical `handle()` flow: resolve workspace/session (callers) → persist the raw user experience → load session interaction mode → optional policy → route → retrieve/compress → optional knowledge inject → system prompt shaped by **active/neutral** → complete or tool loop (tool calls/results persist before later model steps consume them) → persist the final output → optional suggestions → **continuous conversation capture** with exact source experience IDs (pending proposals only, rate-limited) → observability emit. Optional steps are env-gated so the core chat path stays simple. Pipeline planner can use **structured** plan JSON (M10) without changing raw chat.

Knowledge path (M12+): tools in the loop; optional neighborhood/project-status inject; ingest/FP/continuous capture produce **proposals** only; accept remains explicit. Continuous capture uses conversation-optimised extract (post-M18 iteration `7d474bb`), not only generic batch ingest. Voice (M18) is STT→string→same `handle()`; TTS optional and default off. Same brain; no second orchestrator in UI or HTTP.

**Reason:** One pipeline owns the vertical; features plug in without forking a second brain in UI or HTTP layers.

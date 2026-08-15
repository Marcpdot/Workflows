# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01; knowledge roadmap 2026-08-02; PR #33 WP1–WP5
**Revisit when:** layer list or handle pipeline shape changes

Intended layers remain:

1. **Orchestration** — receive, route/policy, wire selected capabilities for one operation, return
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

Typical `handle()` flow: resolve available workspace/session metadata (callers) → persist the raw user experience → derive a bounded per-operation capability context → activate only justified information, transformations, tools, and models → let package-owned contributor functions append first-class operation values → select an already-produced deterministic result or invoke the required model/tool capability → persist every output that can affect later cognition → **continuous conversation capture** with exact source experience IDs (pending proposals only, rate-limited) → observability emit. Full operation values remain private to the operation; the activation trace records only IDs, counts, budgets, decisions, and degradation metadata. Session history, compression, context/knowledge retrieval, lineage hydration, long-term memory, tools, capture, model tiers, and contextual representation acquisition remain independently owned capabilities rather than mandatory stages. A material unresolved referent can activate canonical/metadata inspection, one bounded tool, or a deterministic clarification response; its durable knowledge proposal/event state closes and becomes reusable without making the orchestrator or activation primitives own identity reasoning. The active set may expand only for a concrete missing dependency or contradiction and within explicit depth/count bounds. Pipeline planner can use **structured** plan JSON (M10) without changing raw chat.

Knowledge path (M12+): tools in the loop; optional neighborhood/project-status inject; ingest/FP/continuous capture produce **proposals** only; accept remains explicit. Continuous capture uses conversation-optimised extract (post-M18 iteration `7d474bb`), not only generic batch ingest. Voice (M18) is STT→string→same `handle()`; TTS optional and default off. Same brain; no second orchestrator in UI or HTTP.

**Reason:** Capability contracts plus operation-local values make coordination inspectable without introducing an attention manager or another central intelligence. `Orchestrator.handle()` is the compatibility boundary and failure/observability shell; package-owned contributors perform the selected work. A complete deterministic result can finish an operation without a response-model call, while tools and models remain replaceable resources. Activation decisions expose WHAT participated, HOW it was processed, and HOW MUCH budget was allowed without logging private input, full capability values, or hidden model reasoning.

**Rejected alternatives:** an `AttentionService`/manager, a larger cognitive controller in the orchestrator, an always-on fixed pipeline, unbounded recursive expansion, or learned routing before deterministic activation has produced outcome evidence.

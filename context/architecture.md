# Architecture

## Layered system (intent)

**Status:** active  
**Evidence:** confirmed  
**Source:** root `ARCHITECTURE.md`; conversation 2026-08-01  
**Revisit when:** post-M10 package refactor

Intended layers remain:

1. **Orchestration** — receive, route, call model, return  
2. **Memory** — short-term + long-term  
3. **Tools** — external capabilities via one interface  
4. **Evaluation** — fixed cases, tokens/cost  
5. **Interface** — CLI, then optional UI  

Plus later platform concerns: embeddings, integration surface, compute policy, observability, workspace isolation, structured output.

**Reason:** Jarvis-like personal system should be a **layer under many workflows**, not a single chatbot app. Layers let models and UIs change without losing progress.

## Current package shape (pragmatic)

**Status:** active (temporary)  
**Evidence:** confirmed  
**Source:** repo layout under `Orchestrator/`  

Almost all implementation lives in the **Orchestrator package** (memory, tools, eval, embeddings, integration HTTP, web UI, policy as subfolders). That is **not** the long-term discipline target.

**Reason:** Ship milestones end-to-end with one runnable package and one Build loop. Structure purity deferred until features exist to split.

**Rejected alternatives:**

- **One git repo per layer from day one** — more overhead than value while APIs were still moving.
- **Full modular monorepo packages before M3** — would slow delivery of a working path.

See [packaging.md](packaging.md) and [milestones.md](milestones.md).

# Architecture

## Milestone 0 foundation shape

**Status:** active  
**Evidence:** confirmed  
**Source:** `ARCHITECTURE.md`; M0 orchestrator under `Orchestrator/`  
**Revisit when:** Milestone 1+ layers (eval, tools standardization, proactive multi-agent) start reshaping boundaries

The system is layered as **orchestration → memory → tools → evaluation → interface**. Milestone 0 only hardens the foundation:

1. **Orchestration** — receive prompt, rule-route local vs frontier, call one model, return reply (CLI entry).
2. **Memory** — short-term session history so restarts and model switches keep context (see [memory.md](memory.md)).
3. **Models** — Ollama CLI locally, Grok as frontier (see [models.md](models.md)).
4. **Routing** — fixed rules, not an LLM router yet (see [routing.md](routing.md)).

**Reason:** Ship a thin, modular path end-to-end before investing in embeddings, eval harnesses, or tool frameworks. Later milestones plug into the same seams rather than rewriting a monolith.

**Rejected alternatives:**

- **Build tools + multi-agent + long-term memory in the first cut** — deferred by the milestone plan; each is a later layer once M0 continuity works.
- **Web UI as the primary M0 interface** — CLI first; UI is optional later per architecture notes.

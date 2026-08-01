# Routing

## Rule-based local vs frontier selection (Milestone 0)

**Status:** active  
**Evidence:** confirmed  
**Source:** `ARCHITECTURE.md` (Orchestration); `packages/orchestrator/AGENTS.md` routing rules; `packages/orchestrator/src/router.ts`  
**Revisit when:** routing becomes model-driven, evaluation scores show systematic mis-routes, or task taxonomy changes

The orchestrator classifies each user prompt into a coarse **task type** (summarize, tool, code, research, reasoning, general) and **complexity** (low / medium / high), then picks **local** or **frontier** with fixed rules:

| Signal | Model |
|--------|--------|
| summarize / tool | local |
| low complexity | local |
| medium code | local |
| medium general (default) | local |
| research / reasoning | frontier |
| high complexity | frontier |

**Reason:** Milestone 0 needs a predictable, cheap default path. Most everyday prompts should stay on a local Ollama model to save tokens and latency; only work that benefits from stronger frontier reasoning goes to Grok. Architecture explicitly starts as a simple rule-based router that can become smarter later.

**Rejected alternatives:**

- **Always frontier** — rejected for cost and latency on routine tasks; conflicts with the product goal of token-efficient local-first use.
- **Always local** — rejected because research/reasoning and hard design work still need a frontier model in M0.
- **LLM-as-router on every request** — deferred. It adds latency, cost, and failure modes before evaluation exists to justify it. Smart routing is a later upgrade path, not the M0 baseline.

Budget caps and mid-tier selection are a separate **compute policy** layer (M7), default off — see [policy.md](policy.md).

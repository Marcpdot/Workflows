# Observability

## Local JSONL events, not SaaS (Milestone 8)

**Status:** active  
**Evidence:** confirmed  
**Source:** M8 commit `fe3dfee`; `Orchestrator/src/observability/`; `data/logs/` gitignored  

Structured **Observer** events (request / tool / error) record route, model, tokens, latency, tools, and errors. Default sink is **JSONL under `data/logs/`**, with optional stderr/`--verbose`. Full prompt bodies are **off by default** (`OBS_LOG_PROMPTS`).

Unlike most optional features, observability defaults **enabled** so operators see behavior without an extra flag; set `OBS_ENABLED=false` to disable.

**Reason:** Need a durable, local view of how the stack behaves over time without an external telemetry product. Prompt logging is privacy-sensitive and stays opt-in.

**Rejected alternatives:**

- **External SaaS / full OpenTelemetry distribution as M8 requirement** — heavy ops and accounts for a personal local stack; file sink first.
- **Real-time dashboard as M8 primary** — UI can read logs later; insight does not require a new product surface first.
- **Log full prompts by default** — convenient for debug, wrong default for personal/session content.

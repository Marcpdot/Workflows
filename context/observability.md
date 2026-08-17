# Observability

## Local JSONL events, not SaaS (Milestone 8)

**Status:** active  
**Evidence:** confirmed  
**Source:** M8 commit `fe3dfee`; `packages/observability/`; logs under gitignored `data/logs/`  

Structured **Observer** events (request / tool / error) record route, model, tokens, latency, tools, and errors. Default sink is **JSONL under `data/logs/`**, with optional stderr/`--verbose`. Full prompt bodies are **off by default** (`OBS_LOG_PROMPTS`).

Continuous Cognition additionally emits compact `cognition`, `knowledge`, and
`background` records. They are diagnostic projections of authoritative state:
stable IDs/references, activation decisions and limits, model/tool participation,
semantic write outcomes, correction/clarification reuse, degradation, and finite
background-pass metrics. PostgreSQL and durable experience storage remain truth;
telemetry failure is non-fatal. Private full content and hidden reasoning remain
outside these records, while the existing prompt-preview opt-in is unchanged.

Unlike most optional features, observability defaults **enabled** so operators see behavior without an extra flag; set `OBS_ENABLED=false` to disable.

**Reason:** Need a durable, local view of how the stack behaves over time without an external telemetry product. Prompt logging is privacy-sensitive and stays opt-in.

The compact CC schema also provides stable evidence for later evaluation and
adaptation without introducing learned routing or making observability control
cognition.

Voice-runtime transitions use the same observer as `kind: "voice"` records.
Capture, progressive speech, reversible cognition, commitment, output,
interruption, and degradation are joined by utterance/output/experience IDs,
bounded timings, counts, and reason codes. Full transcript and audio content are
excluded; telemetry remains non-authoritative and non-fatal.

**Rejected alternatives:**

- **External SaaS / full OpenTelemetry distribution as M8 requirement** — heavy ops and accounts for a personal local stack; file sink first.
- **Real-time dashboard as M8 primary** — UI can read logs later; insight does not require a new product surface first.
- **Log full prompts by default** — convenient for debug, wrong default for personal/session content.

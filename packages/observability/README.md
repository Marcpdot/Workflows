# packages/observability

Local JSONL observability for runtime and Continuous Cognition operations.

Events cover ordinary requests/tools/errors plus compact cognition, canonical
knowledge-write, and finite-background-pass records. CC records contain stable
experience/event/proposal/canonical/work IDs, activation decisions and limits,
model/tool identities, degradations, and factual outcomes. They do not contain
full prompts, responses, retrieved knowledge, tool output, memory content, or
hidden reasoning by default. Existing `OBS_LOG_PROMPTS=true` remains the only
prompt-preview opt-in.

Observers are diagnostic only. `emitSafely()` and the built-in sinks ensure a
telemetry failure cannot invalidate durable experience, canonical knowledge, or
background state.


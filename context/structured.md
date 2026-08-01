# Structured output

## Parseable JSON with repair, not constrained decoding (Milestone 10)

**Status:** active  
**Evidence:** confirmed  
**Source:** M10 commit `74cd7f2`; `packages/structured/`; pipeline planner path  
**Revisit when:** a backend gains reliable constrained decoding and eval shows repair is insufficient

`completeStructured` runs model complete → parse/validate → optional **repair turn** (default max 2 attempts). Schema is a **light JSON Schema subset** (no Zod). On failure: `ok: false`, raw text preserved — **does not crash** the pipeline.

Production wiring:

- **Planner** (multi-role pipeline) asks for `{"steps":[...],"summary"?}` and formats text for the worker; bad parse falls back to raw.
- **`parseToolCalls`** shares extract/lenient JSON helpers (reinforces tool text path).
- **Raw `handle()` chat** is intentionally unchanged.

**Reason:** Tools and pipeline need parseable output from weak local models without requiring grammar/constrained decoding on every backend. Repair + fallback keeps the stack usable when JSON is messy.

**Rejected alternatives:**

- **Constrained decoding / grammar as the only path** — not portable across Ollama CLI and all frontier modes in this stack.
- **Frontier-only structured mode** — local path must work offline for the planner shell.
- **Zod or full JSON Schema draft** — dependency and complexity tax for a small subset that is enough for plans and tool envelopes.
- **Fail the whole pipeline on parse error** — worse UX than raw text + metadata for the worker.

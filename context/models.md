# Models and local runtime

## Default local model: `llama3.1:8b`

**Status:** active  
**Evidence:** confirmed  
**Source:** maintainer request 2026-08-04; default in `packages/orchestrator/src/orchestrator.ts` and `packages/orchestrator/.env.example`  
**Revisit when:** hardware or quality needs change; eval shows a better default

The configured default Ollama model tag is **`llama3.1:8b`**, overridable via `OLLAMA_MODEL`.

**Reason:** `llama3.2:3b` is not usable enough for real dialogue (including active sparring / reasoning). An 8B-class Llama 3.1 model is the new baseline for local communication quality while still remaining Ollama-CLI local and env-overridable.

**Rejected / superseded:**

- **`llama3.2:3b` as project default** — chosen earlier for weak machines; superseded because quality is too low for intended use (conversation + knowledge capture coaching).
- **`gemma4:12b` as project default** — briefly used when that model was installed on one machine; rejected as the shared default because a 12B tag is heavy and not portable as a repo-wide assumption.
- **No default (always require explicit model)** — worse DX for first run; env override still covers power users.

> Superseded 2026-08-04: previous active default was `llama3.2:3b` (weak-machine baseline).

---

## Local client: Ollama CLI (`ollama run`), not the HTTP API

**Status:** active  
**Evidence:** confirmed  
**Source:** maintainer direction during M0 build; `packages/orchestrator/AGENTS.md`; `packages/models/src/local.ts`  
**Revisit when:** structured streaming, concurrent requests, or richer Ollama API features are required

Local inference is invoked by spawning the **Ollama CLI**: `ollama run <model> <prompt>` (subprocess), not by calling the Ollama daemon’s HTTP API.

**Reason:** Matches how the maintainer already runs models day to day, keeps the local path free of an extra HTTP client surface, and stays aligned with “minimal dependency” for Milestone 0. Binary path is configurable (`OLLAMA_BIN`).

**Rejected alternatives:**

- **Ollama HTTP API (`/api/generate` or chat endpoints)** — more natural for streaming and structured options later, but not chosen for M0 once CLI was specified as the local interface.
- **Embedding the model runtime in-process** — out of scope; Ollama remains the external local runtime.

---

## Frontier: xAI Grok (OpenAI-compatible chat completions)

**Status:** active  
**Evidence:** confirmed  
**Source:** maintainer direction during M0 build; `packages/models/src/frontier.ts`  
**Revisit when:** multi-provider routing or cost/latency eval favors another frontier

Frontier calls use the **xAI Grok** Chat Completions API (`XAI_API_KEY`, default base `https://api.x.ai/v1`, default model `grok-3`).

**Reason:** Explicit product choice for this stack (Grok as the cloud side paired with Ollama locally).

**Rejected alternatives:**

- **Anthropic-native client as the only frontier** — considered in the early orchestrator spec (“OpenAI-compatible or Anthropic”); Grok was selected instead.
- **OpenAI as the primary frontier brand** — OpenAI-compatible wire format is used for Grok, but the provider is xAI, not OpenAI.

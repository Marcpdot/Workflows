# Integration surface

## CLI contract + thin HTTP, same brain (Milestone 5)

**Status:** active  
**Evidence:** confirmed  
**Source:** M5 commit `86c49f6`; `packages/orchestrator/src/integration/`; CLI `--workspace`, pure `--json`  

Other projects call Workflows through a **documented CLI contract** and optional **thin HTTP** (`GET /health`, `GET /v1/status`, `POST /v1/chat`, `GET /v1/events`, `GET /v1/session`). Tools bind to the caller’s workspace; orchestration logic stays inside the orchestrator package (not a second brain in the HTTP layer). Inventory: `packages/orchestrator/src/integration/surface-contract.md`.

**M9 boundaries (after shell delivery):** short-term sessions are namespaced per workspace; retrieval prefers `{workspace}/context` when present; LTM stays personal/global unless `LONGTERM_PROJECT_SCOPED`. See [workspace.md](workspace.md).

**M17 knowledge read (optional):** when `KNOWLEDGE_HTTP_READ=true`, the same integration server exposes `GET /v1/knowledge/*` and a minimal `/knowledge` HTML page behind the same bearer token. Read-only; writes stay CLI/tools + accept gate. See [knowledge.md](knowledge.md).

**Session proposals queue (capture UI):** `GET /v1/knowledge/proposals?sessionId=` returns pending proposals for continuous-capture sessions and is available even when the full knowledge read catalog is off — so the web proposals panel works without flipping every M17 flag. Same token gate as other `/v1/*` routes. Chat responses also include `interactionMode`, `proposals` (this turn), and session-scoped `pendingProposalCount`. HTTP `POST /v1/knowledge/proposals/:id/accept|reject` is a thin wrap of the existing store methods (no auto-accept).

**Status, streaming, focus, events, session metadata:** `/v1/status` is best-effort probes (knowledge health, local `ollama --version`, env voice/model flags, in-flight busy) — a failed probe sets `degraded`, not a 5xx, and is not a new central controller. `POST /v1/chat` accepts optional structured `focus` (node ids/labels/project) and forwards it into knowledge retrieval via `handle()`; existing clients that omit it are unchanged. Chat SSE (`token|status|done|error`) is the same result as JSON; `done` is authoritative because `ModelClient.complete()` is still one-shot. `GET /v1/events` is an in-process SSE hub of observed turn/proposal/degraded/error events. `GET /v1/session` returns metadata only (no transcript dump). Command Center UI and voice duplex over this HTTP surface stay out of this adapter.

**Reason:** External repos must use the stack without living in Orchestrator’s cwd or reimplementing routing/memory. A thin adapter layer is enough; a second orchestrator in the API would drift.

**Rejected alternatives:**

- **HTTP-only platform API first** — automation and CI already need stable CLI stdout/exit codes; HTTP reuses the same handle path.
- **Auth, multi-tenant SaaS, gRPC streaming in M5** — out of scope until the local integration story is proven.
- **Duplicate chat logic in the HTTP layer** — violates “same brain”; UI (M6) and clients must not become a second product core.
- **Separate knowledge HTTP service (M17)** — would fork read path and auth; reusing integration host keeps one token gate and one process.
- **Panel driven only by last chat payload** — fails after refresh; sessionId query is required for a trustworthy queue.
- **A process-wide status/event controller** — `/v1/status` probes existing stores/env; `/v1/events` republishes what HTTP already observed from `handle()` / knowledge.
- **WebSocket or gRPC streaming in this pass** — SSE reuses the existing Node HTTP server; `done` matches the JSON chat body so clients can ignore tokens.
- **Dumping the private transcript from `GET /v1/session`** — session metadata is enough for shells; full history stays on `handle()` / memory internals.

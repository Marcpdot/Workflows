# Integration surface

## CLI contract + thin HTTP, same brain (Milestone 5)

**Status:** active  
**Evidence:** confirmed  
**Source:** M5 commit `86c49f6`; `packages/orchestrator/src/integration/`; CLI `--workspace`, pure `--json`  

Other projects call Workflows through a **documented CLI contract** and optional **thin HTTP** (`GET /health`, `POST /v1/chat`). Tools bind to the caller’s workspace; orchestration logic stays inside the orchestrator package (not a second brain in the HTTP layer).

**M9 boundaries (after shell delivery):** short-term sessions are namespaced per workspace; retrieval prefers `{workspace}/context` when present; LTM stays personal/global unless `LONGTERM_PROJECT_SCOPED`. See [workspace.md](workspace.md).

**M17 knowledge read (optional):** when `KNOWLEDGE_HTTP_READ=true`, the same integration server exposes `GET /v1/knowledge/*` and a minimal `/knowledge` HTML page behind the same bearer token. Read-only; writes stay CLI/tools + accept gate. See [knowledge.md](knowledge.md).

**Session proposals queue (capture UI):** `GET /v1/knowledge/proposals?sessionId=` returns pending proposals for continuous-capture sessions and is available even when the full knowledge read catalog is off — so the web proposals panel works without flipping every M17 flag. Same token gate as other `/v1/*` routes. Chat responses also include `interactionMode`, `proposals` (this turn), and session-scoped `pendingProposalCount`.

**Reason:** External repos must use the stack without living in Orchestrator’s cwd or reimplementing routing/memory. A thin adapter layer is enough; a second orchestrator in the API would drift.

**Rejected alternatives:**

- **HTTP-only platform API first** — automation and CI already need stable CLI stdout/exit codes; HTTP reuses the same handle path.
- **Auth, multi-tenant SaaS, gRPC streaming in M5** — out of scope until the local integration story is proven.
- **Duplicate chat logic in the HTTP layer** — violates “same brain”; UI (M6) and clients must not become a second product core.
- **Separate knowledge HTTP service (M17)** — would fork read path and auth; reusing integration host keeps one token gate and one process.
- **Panel driven only by last chat payload** — fails after refresh; sessionId query is required for a trustworthy queue.

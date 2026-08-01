# Integration surface

## CLI contract + thin HTTP, same brain (Milestone 5)

**Status:** active  
**Evidence:** confirmed  
**Source:** M5 commit `86c49f6`; `Orchestrator/src/integration/`; CLI `--workspace`, pure `--json`  

Other projects call Workflows through a **documented CLI contract** and optional **thin HTTP** (`GET /health`, `POST /v1/chat`). Tools bind to the caller’s workspace; orchestration logic stays inside Orchestrator.

**Reason:** External repos must use the stack without living in Orchestrator’s cwd or reimplementing routing/memory. A thin adapter layer is enough; a second orchestrator in the API would drift.

**Rejected alternatives:**

- **HTTP-only platform API first** — automation and CI already need stable CLI stdout/exit codes; HTTP reuses the same handle path.
- **Auth, multi-tenant SaaS, gRPC streaming in M5** — out of scope until the local integration story is proven.
- **Duplicate chat logic in the HTTP layer** — violates “same brain”; UI (M6) and clients must not become a second product core.

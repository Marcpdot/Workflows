# Milestones

## Delivery style: shell first, optimize later

**Status:** active  
**Evidence:** confirmed  
**Source:** working session 2026-08-01  
**Revisit when:** stronger local models are in daily use and gaps hurt

Milestones are implemented as **working shells**: interfaces, env-gated features, smokes, keyword/fallback paths. Deep calibration (embedding reindex, score fusion, rich UI) is intentionally thin.

**Reason:** Weak local models and incomplete product use cases make early optimization noise. A complete vertical path (spec → code → smoke) compounds better than polishing one layer.

**Rejected alternatives:**

- **Production-harden each milestone before the next** — delays the platform surface and invents requirements without usage.
- **Skip milestones that need a strong model** — still worth having the code path so 12b+ can be dropped in later.

## Defaults-off for costly or side-effecting paths

**Status:** active  
**Evidence:** confirmed  
**Source:** env flags across tools, policy, embeddings, proactive, pipeline; M8 config exception below  
**Revisit when:** daily use shows a safer default for a given feature

Most optional brain features start **off** until explicitly enabled (`TOOLS_ENABLED`, `POLICY_ENABLED`, `EMBEDDINGS_ENABLED`, `PROACTIVE_ENABLED`, `AGENTS_PIPELINE_ENABLED`, LTM auto-inject, knowledge auto-ingest, etc.). Chat + rule routing remain usable without them.

**Exception:** observability defaults **on** (JSONL under gitignored `data/logs/`) so operators can see route/model/tokens without flipping a flag first. Prompt bodies stay off (`OBS_LOG_PROMPTS=false`).

**Reason:** A personal stack should not burn tokens, run tools, or inject LTM by surprise. Seeing *what happened* is cheap and local; *acting* is gated.

## Order after M3 (2026-08-01)

**Status:** active  
**Evidence:** confirmed  

| # | Focus | Why this order |
|---|--------|----------------|
| M4 | Embeddings | Retrieval/LTM hit keyword ceiling |
| M5 | Integration surface | Other projects must call in without living inside Orchestrator cwd |
| M6 | UI shell | Visible shell over M5 HTTP; CLI remains for CI |
| M7 | Compute policy | Budget/tier rules before paying for tokens habitually |
| M8 | Observability | See route/tokens/tools once policy and UI exist |
| M9 | Workspace/session | Multi-project without mixing context |
| M10 | Structured output | Stabilize tools/pipeline parsing |

**After M10:** package layout was refactored (A–F). See [packaging.md](packaging.md).

## Knowledge track (M11–M18)

**Status:** active  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02; [knowledge.md](knowledge.md)  
**Revisit when:** M11 is in daily use

Semantic world model beyond `MemoryFact` text. Same shell-first rule: each row is a stoppable vertical.

| # | Focus | Delivers | Why this order |
|---|--------|----------|----------------|
| **M11** | Semantic knowledge shell | Concepts/claims/edges/events in SQLite; extract → propose → approve → neighborhood query | Proves representation + approval loop |
| **M12** | Knowledge tools + orchestrator wire | `knowledge.*` tools; optional subgraph in context | Models use the graph, not only CLI |
| **M13** | Project & workspace binding | Link claims/events to project/workspace; status queries | Project-state questions become real |
| **M14** | Continuous / batch ingest | Chat segment or markdown → proposals (no blind permanent write) | Graph grows from daily work |
| **M15** | Identity, merge & contradiction | Aliases, merge, supports/contradicts, revision | Avoid semantic chaos at volume |
| **M16** | First-principles workflow | Template analysis as structured events/claims | Native support for FP analysis style |
| **M17** | Read surface | Subgraph view and/or structured read API | Navigate without 3D |
| **M18** | Voice / multimodal I/O (optional) | Speech → same knowledge tools | Interface only |

**Bands:** M11–M13 make FP/project use *possible*; M14–M16 make growth *robust*; M17–M18 improve *interface*.

**Out of early roadmap:** Neo4j as hard dependency, fully autonomous permanent writes, 3D Stark UI, full Workflows self-model on day one.

Details, invariants, and M11 done-when: [knowledge.md](knowledge.md).

## Implementation status (shells)

**Status:** active  
**Evidence:** confirmed  
**Source:** git through M10 (`74cd7f2`) and package refactor A–F (`e07dc0f` Step F, later cleanup); knowledge roadmap 2026-08-02  

| Range | State |
|-------|--------|
| M0–M3 | Delivered (chat path, compression/retrieval/eval, tools A–C, LTM API, proactive suggestions, sequential multi-role pipeline) |
| M4–M8 | Delivered as shells (embeddings, CLI+thin HTTP, localhost web UI, compute policy, JSONL observability) |
| M9 | Delivered as shell — session/workspace namespace, project context, list-sessions (see [workspace.md](workspace.md)) |
| M10 | Delivered as shell — completeStructured, planner plan JSON, shared tool JSON extract (see [structured.md](structured.md)) |
| Packaging | **Done** — layers under `packages/*`, glue at `packages/orchestrator` (see [packaging.md](packaging.md)) |
| **M11** | **Delivered as shell** — `packages/knowledge`; extract→propose→approve→neighborhood; smoke + CLI |
| **M12** | **Delivered as shell** — `knowledge_*` tools; optional inject default off; smoke-knowledge-tools |
| **M13** | **Delivered as shell** — project ensure/link/status; `workspaceId` defaults; M13 tools + CLI; smoke-knowledge-projects |
| **M14** | **Delivered as shell** — `ingestText`/`ingestFile`; light dedupe; tool+CLI; auto-chat opt-in proposals-only; smoke-knowledge-ingest |
| **M15** | **Delivered as shell** — aliases, merge rewire, contradictions, supersede; tools+CLI; smoke-knowledge-identity |
| **M16–M18** | **Planned** (roadmap only) — FP workflow, read surface, optional voice |

Vertical M0–M15 shells are in place. Next knowledge target is **M16** (first-principles workflow) when ready.

Thin spots accepted under shell-first (e.g. heuristic score fusion, static UI, linear vector scan, repair-not-constrained-decoding) are documented per topic.

## Milestone 3 privacy cut

**Status:** active  
**Evidence:** confirmed  

Long-term memory is an **API + private storage path**. A rich personal model of the user does **not** live in the public repo.

Knowledge store follows the same rule: schema and fake/demo data may live in-repo; real claims and conversation excerpts stay under gitignored paths / `PERSONAL_CONTEXT_DIR`.

See [privacy.md](privacy.md) and [knowledge.md](knowledge.md).

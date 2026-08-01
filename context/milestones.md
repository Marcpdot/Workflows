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

Most optional brain features start **off** until explicitly enabled (`TOOLS_ENABLED`, `POLICY_ENABLED`, `EMBEDDINGS_ENABLED`, `PROACTIVE_ENABLED`, `AGENTS_PIPELINE_ENABLED`, LTM auto-inject, etc.). Chat + rule routing remain usable without them.

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

## Implementation status (shells)

**Status:** active  
**Evidence:** confirmed  
**Source:** git through M10 (`74cd7f2`) and package refactor A–F (`e07dc0f` Step F, later cleanup)  

| Range | State |
|-------|--------|
| M0–M3 | Delivered (chat path, compression/retrieval/eval, tools A–C, LTM API, proactive suggestions, sequential multi-role pipeline) |
| M4–M8 | Delivered as shells (embeddings, CLI+thin HTTP, localhost web UI, compute policy, JSONL observability) |
| M9 | Delivered as shell — session/workspace namespace, project context, list-sessions (see [workspace.md](workspace.md)) |
| M10 | Delivered as shell — completeStructured, planner plan JSON, shared tool JSON extract (see [structured.md](structured.md)) |
| Packaging | **Done** — layers under `packages/*`, glue at `packages/orchestrator` (see [packaging.md](packaging.md)) |

Vertical M0–M10 shells are in place and the package map is readable. Near-term focus is **usage** and deepening any shell that daily use shows is thin.

Thin spots accepted under shell-first (e.g. heuristic score fusion, static UI, linear vector scan, repair-not-constrained-decoding) are documented per topic.

## Milestone 3 privacy cut

**Status:** active  
**Evidence:** confirmed  

Long-term memory is an **API + private storage path**. A rich personal model of the user does **not** live in the public repo.

See [privacy.md](privacy.md).

# Milestones

## Delivery style: shell first, optimize later

**Status:** active  
**Evidence:** confirmed  
**Source:** working session 2026-08-01  
**Revisit when:** stronger local models are in daily use and gaps hurt

Milestones are implemented as **working shells**: interfaces, defaults off, smokes, keyword/fallback paths. Deep calibration (embedding reindex, score fusion, rich UI) is intentionally thin.

**Reason:** Weak local models and incomplete product use cases make early optimization noise. A complete vertical path (spec → code → smoke) compounds better than polishing one layer.

**Rejected alternatives:**

- **Production-harden each milestone before the next** — delays the platform surface and invents requirements without usage.
- **Skip milestones that need a strong model** — still worth having the code path so 12b+ can be dropped in later.

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

**After M10:** package refactor so layers are not all owned by the Orchestrator folder (see [packaging.md](packaging.md)).

## Milestone 3 privacy cut

**Status:** active  
**Evidence:** confirmed  

Long-term memory is an **API + private storage path**. A rich personal model of the user does **not** live in the public repo.

See [privacy.md](privacy.md).

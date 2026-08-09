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

**Status:** active (shell track complete; deepen with use)  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02; delivery through M18 `6f11d1f`; [knowledge.md](knowledge.md)  
**Revisit when:** daily use shows which shell to harden next; or a cross-cutting invariant (propose→accept, defaults-off) is challenged

Semantic world model beyond `MemoryFact` text. Same shell-first rule: each row is a stoppable vertical. **All eight rows have working shells** (M18 optional I/O, default off).

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

**Out of early roadmap (unchanged):** Neo4j as hard dependency, fully autonomous permanent writes, 3D Stark UI, full Workflows self-model on day one.

## Implementation status (shells)

**Status:** active  
**Evidence:** confirmed  
**Source:** git through M10 + packaging A–F; knowledge M11–M18 through `6f11d1f`; interaction capture through `7d474bb`  
 

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
| **M16** | **Delivered as shell** — first-principles template/runner → proposals; tool+CLI; smoke-knowledge-fp |
| **M17** | **Delivered as shell** — read helpers + renderers; CLI `--json`; optional HTTP `/v1/knowledge/*`; minimal HTML; smoke-knowledge-read |
| **M18** | **Delivered as optional shell** — `@workflows/voice` STT/TTS adapters; `--voice-once` / `/voice`; mock smoke; same `handle()` |
| **Post-M18** | **Interaction mode + continuous capture** — foundation `04415a5` + iteration `7d474bb` (session mode, conversation extract, session proposals queue, sparring prompts); design in `docs/INTERACTION_*` |

Vertical **M0–M18** shells are in place (M18 is interface-only and default off). Continuous capture is the next product surface on top of the knowledge track (propose→accept unchanged).

Thin spots accepted under shell-first (e.g. heuristic score fusion, static UI, linear vector scan, repair-not-constrained-decoding; conversation extract still offline-heuristic until model path is daily-used) are documented per topic.

## Next phase: Continuous Cognitive Capture

**Status:** active — next product/system phase  
**Evidence:** confirmed  
**Source:** design decision 2026-08-09 after Knowledge Infrastructure v2  
**Revisit when:** sustained real use shows the interaction/capture loop should be decomposed differently

**Decision:** The next phase of Workflows is **Continuous Cognitive Capture**.

The goal is to make the first complete, continuously useful human↔system loop real: natural interaction and project work should become structured, persistent, provenance-preserving knowledge that is integrated into the world model and reused to improve later learning, reasoning, and project execution.

Core loop:

```text
interact
  → capture
  → structure
  → integrate
  → retrieve
  → augment the next interaction
  → repeat
```

Text and voice are interaction modalities over the same system rather than separate products. Conversations are not only transient model context: when they contain durable knowledge, observations, decisions, project state, evidence, or useful relationships, the system should be able to turn that activity into reviewable structured knowledge and connect it to existing canonical identities.

The intended compounding effect is two-way: as the human learns and builds, the system's world model improves; as the world model improves, the system can supply more relevant context, connections, prior work, evidence, and project understanding back into future learning and building.

This phase is **not** defined as “build a frontend” or “add chat memory”. The interaction surface is part of the capability, but the product objective is the complete cognitive loop across interaction, curation, persistent knowledge, retrieval, and reuse. A cognitive workspace should make that loop observable and usable, including what the system captured, connected, retrieved, or proposed.

The phase should build on the current Knowledge Infrastructure v2 boundaries: canonical PostgreSQL/PostGIS truth, rebuildable graph/vector projections, bounded hybrid retrieval, and proposal/approval semantics. It should exercise those components in real use before another major abstract iteration of the orchestrator/system-intelligence layer.

**Initial direction, deliberately not frozen:**

- natural text interaction first-class; voice feeds the same interaction/capture path
- low-friction continuous capture from conversations and project activity
- structured curation into canonical identities, claims, observations, evidence, relations, projects, and provenance
- dynamic retrieval of relevant prior knowledge into later interactions
- a cognitive workspace for conversation, knowledge inspection, project context, and curation/review
- enough visibility to observe and debug how the system learns from use
- later attention/reflection/system-intelligence layers should be driven by observed usage rather than designed entirely in the abstract

**Not decided by this phase declaration:** exact frontend layout, final cognitive object vocabulary, degree of future curation autonomy, voice UX, agent decomposition, attention model, or richer world-model visualizations. Those should be iterated as the complete loop is used.

**Reason:** The backend now has enough durable structure to support a real compounding interaction loop. Building more orchestration intelligence before the system has functioning user-facing cognitive workflows would optimize abstractions without enough behavioral evidence. Conversely, building only a thin UI shell would underuse the available architecture. Continuous Cognitive Capture provides a high-ceiling product target while allowing implementation details to evolve through real use.

## Milestone 3 privacy cut

**Status:** active  
**Evidence:** confirmed  

Long-term memory is an **API + private storage path**. A rich personal model of the user does **not** live in the public repo.

Knowledge store follows the same rule: schema and fake/demo data may live in-repo; real claims and conversation excerpts stay under gitignored paths / `PERSONAL_CONTEXT_DIR`.

See [privacy.md](privacy.md) and [knowledge.md](knowledge.md).

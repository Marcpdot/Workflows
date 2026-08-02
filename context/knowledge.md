# Knowledge (semantic world model)

## Vision: first-principles world model over plain facts

**Status:** active (direction)  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02 (first-principles graphs + voice use)  
**Revisit when:** first extraction→commit loop is used daily

Workflows already has short-term session memory and long-term `MemoryFact`
(content + tags + optional key). That is necessary but not sufficient for
the intended Jarvis-like use: continuous first-principles analysis, project
state queries, and voice-driven reasoning over *understanding*, not only
retrieved text.

The next layer is a **semantic knowledge model**:

- Explicit **concepts** (what exists)
- Explicit **claims** (what is asserted, with status and confidence)
- Explicit **relations** (how they connect: requires, limits, causes, increases, …)
- **Events** (learning/analysis moments that produced claims)
- **Sources / provenance** (conversation span, file, experiment)
- **Projects / artifacts** (what the claim affects)

Goal in one sentence:

> Continuously transform conversations, analyses, and project activity into
> a reliable, machine-readable model of what is known, believed, and being
> built — so both human and models can navigate and extend it (including via voice).

**Reason:** Text memory can recall a sentence. It cannot represent
`strøm → øker → kobbertap → produserer → varme → begrenser → kontinuerlig moment`
with provenance, hypothesis status, and project linkage. First-principles
work and “what is the status of actuator-v2?” need that structure. Those are
**usage patterns**, not a limit on the model’s domain.

**Rejected alternatives:**

- **Only richer MemoryFact text** — still no explicit graph or claim identity.
- **Jump straight to Neo4j / Graphiti as core** — define *our* objects and
  approval loop first; storage can change later.
- **Auto-write every chat turn into the permanent graph** — pollutes the
  model; proposals + human (or strict) approval are required early.
- **Separate “JARVIS knowledge” repo** — Workflows already owns memory,
  structured output, tools, workspaces, observability; extend here.

## Core objects (M11 minimum)

**Status:** active  
**Evidence:** confirmed (implemented shell in `packages/knowledge`)  

| Object | Role |
|--------|------|
| **Concept** | Named entity/topic (motor, heat, workspace, …) |
| **Claim** | Subject–relation–object style assertion, or labelled statement |
| **Relation / edge** | Typed link between nodes (`requires`, `limits`, `causes`, `increases`, `reduces`, `measures`, `controls`, `supports`, `contradicts`, `used_in`, …) |
| **Event** | Extraction or analysis event (source type + ref) |
| **Source** | Conversation id + excerpt, file path, measurement |
| **Evidence** | Claim ↔ source with stance (supports / contradicts / mentions) |
| **Project / artifact** | Optional anchors for work product |

Status on claims/nodes: `proposed | accepted | disputed | rejected`.

Invariants that must survive any implementation:

1. **Provenance** — machine-created claims trace to origin.
2. **Identity** — same concept should not explode into near-duplicates.
3. **Context + time** — claims can be hypothesis, formerly true, or scoped.
4. **Uncertainty** — confidence / status explicit.
5. **Reversibility** — proposals and commits can be undone without graph rot.

## Extraction loop (not direct write)

**Status:** active  
**Evidence:** confirmed (design constraint)

```
Raw activity (chat / markdown / project)
  → ExtractionEvent (structured output)
  → Proposals (concepts, claims, edges)
  → Identity / duplicate check
  → Human (or policy) approve / edit / reject
  → Commit to knowledge store
  → Retrieval / neighborhood for next turn
```

AI **proposes**; it does not silently own the permanent model. M10 structured
output is the right engine for the extraction step.

## Relation to existing memory

**Status:** active  
**Evidence:** confirmed

| Layer | Responsibility |
|-------|----------------|
| `packages/memory` short-term | Session turns, continuity across model switch |
| `packages/memory` long-term | Simple durable facts, preferences, keywords + optional vectors |
| **knowledge (new)** | Explicit concepts, claims, relations, events, provenance |

Not everything said in chat belongs in the world model. LTM remains useful
for “user prefers X”. Knowledge is for *structure of understanding*.

## Implementation specs (per milestone)

| # | Spec |
|---|------|
| M11 | [`AGENTS.md`](../packages/knowledge/src/AGENTS.md) |
| M12 | [`AGENTS-M12.md`](../packages/knowledge/src/AGENTS-M12.md) |
| M13 | [`AGENTS-M13.md`](../packages/knowledge/src/AGENTS-M13.md) |
| M14 | [`AGENTS-M14.md`](../packages/knowledge/src/AGENTS-M14.md) |
| M15 | [`AGENTS-M15.md`](../packages/knowledge/src/AGENTS-M15.md) |
| M16 | [`AGENTS-M16.md`](../packages/knowledge/src/AGENTS-M16.md) |
| M17 | [`AGENTS-M17.md`](../packages/knowledge/src/AGENTS-M17.md) |
| M18 | [`AGENTS-M18.md`](../packages/knowledge/src/AGENTS-M18.md) |

## Voice / natural-language use (intent)

**Status:** active (product intent; interface milestone M18)  
**Evidence:** confirmed

Speech I/O is **not** required for M11–M17. Voice is an interface on top of
the same query + extraction tools once the graph and tools exist (M18).

## Storage choice for first shell

**Status:** active  
**Evidence:** confirmed

SQLite tables alongside existing DBs. No new infrastructure required for M11–M18 shells.

## Knowledge milestone roadmap (M11–M18)

**Status:** active  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02  
**Revisit when:** M11 is in daily use or priorities shift

| # | Focus | Delivers | Status |
|---|--------|----------|--------|
| **M11** | Semantic knowledge shell | Store, proposals, neighborhood | **shell delivered** |
| **M12** | Knowledge tools + wire | Models use graph via tools | **shell delivered** |
| **M13** | Project & workspace binding | Project nodes, links, `getProjectStatus`, workspaceId defaults | **shell delivered** |
| **M14** | Continuous / batch ingest | `ingestText`/`ingestFile`, light dedupe, tool+CLI, auto-chat opt-in (proposals only) | **shell delivered** |
| **M15** | Identity, merge & contradiction | Aliases, merge rewire, contradicts list, supersede (no silent delete) | **shell delivered** |
| **M16** | First-principles workflow | Template analysis → structured proposals (not sole purpose of knowledge) | **shell delivered** |
| **M17** | Read surface | Reader helpers, renderers, CLI `--json`, optional HTTP + minimal HTML | **shell delivered** |
| **M18** | Voice / multimodal I/O (optional) | STT/TTS adapters → same `handle()` / tools; default off | **shell delivered (optional)** |

**M13 shell notes:** Project is a graph node (`type: "project"`), not a separate table. Binding uses edges (`used_in` | `about` | `part_of`). One knowledge.db with `workspaceId` filters (same idea as M9 session namespace). Accept applies `defaultWorkspaceId` when payload omits workspace. Tools: `knowledge_ensure_project`, `knowledge_link_project`, `knowledge_unlink_project`, `knowledge_project_status`. Inject prefers project status when the prompt matches a project label.

**M14 shell notes:** Graph grows via **proposals only** — `ingestText` / `ingestFile` / `knowledge_ingest` never accept. Light dedupe skips node proposals whose type+label is already accepted. CLI: `--knowledge ingest --text| --file`. Auto chat segment (`KNOWLEDGE_INGEST_AUTO_ON_CHAT`) default off and still proposals-only.

**M15 shell notes:** `knowledge_aliases` table + `normalizeLabel` (trim/case/diacritics). `mergeNodes` rewires edges/evidence, aliases the from-label, marks from **rejected** (history kept). `findContradictions` / `markContradiction` are explicit flags — no auto truth. `supersedeClaim` uses edge `supersedes` and can mark old disputed. Tools: `knowledge_add_alias`, `knowledge_merge`, `knowledge_find_contradictions`, `knowledge_mark_contradiction`, `knowledge_supersede`.

**M16 shell notes:** First-principles is **one workflow** on the general graph (`runFirstPrinciplesAnalysis` → pending proposals). Template steps: goal, laws, absolute/contingent limits, bottlenecks, scaling, next experiment. Offline heuristic + optional model `complete` + fixture for smoke. Optional `projectLabel` ensures M13 project and proposes `used_in` edges. Tool `knowledge_first_principles`; CLI `--knowledge fp --topic "..."`.

**M17 shell notes:** Read-only surface over M11–M16 — `createKnowledgeReader` (search, node, neighborhood, project status, contradictions, proposals) + compact renderers (table/list/subgraph/report/HTML). CLI uses stable `--json` envelopes. Optional `KNOWLEDGE_HTTP_READ=true` exposes `GET /v1/knowledge/*` behind the same integration token; `GET /knowledge` is a no-framework browse page. No write UI.

**M18 shell notes:** Voice is **I/O only** (`@workflows/voice`): mock/local/cloud STT + off/mock/local/cloud TTS → `Orchestrator.handle` (same tools/knowledge). Default off (`VOICE_ENABLED=false`, TTS off). Cloud requires `VOICE_ALLOW_REMOTE_AUDIO`. CLI: `--voice-once --transcript "..."`, REPL `/voice ...`. Local path: `VOICE_STT_COMMAND` / `VOICE_TTS_COMMAND`. No second brain; propose/accept unchanged.

**Capability bands**

- **M11–M13** — make structured use *possible*
- **M14–M16** — make growth and analysis *robust*
- **M17–M18** — improve *interface*

**Explicitly out of early roadmap:** Neo4j-as-required, fully autonomous permanent writes, 3D UI, complete self-model of Workflows on day one.

## First-principles root question (kept)

> How can continuous conversations, analyses, and projects be transformed
> into a durable, reliable model that both I and AI can understand, navigate,
> and extend — without the structure collapsing under duplicates, ambiguity,
> and error?

Branches: Information → Representation → Transformation → Use.

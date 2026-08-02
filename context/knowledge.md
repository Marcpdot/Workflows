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
work and “what is the status of actuator-v2?” need that structure.

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

Package shape (M11 shell):

```
packages/
  memory/       # unchanged role
  knowledge/    # store + query + commit API (+ extract helpers)
```

Tools (from M12): `knowledge.findConcept`, `knowledge.getNeighborhood`,
`knowledge.proposeClaims`, `knowledge.commitProposal`,
`knowledge.traceProvenance`, `knowledge.findContradictions`.

## Voice / natural-language use (intent)

**Status:** active (product intent; interface milestone M18)  
**Evidence:** confirmed

Example interaction the model is meant to support:

> “Do a first-principles analysis on why thermal management becomes the
> bottleneck when we scale actuators 10×.”

System loads neighborhood of actuator / torque density / copper loss / heat,
reasons with stored claims, proposes new claims, offers to attach to project
`aktuator-v2`, then answers project status from the same graph.

Speech I/O is **not** required for M11–M17. Voice is an interface on top of
the same query + extraction tools once the graph and tools exist (M18).

## Storage choice for first shell

**Status:** active  
**Evidence:** confirmed

SQLite tables (`knowledge_nodes`, `knowledge_edges`, `knowledge_evidence`,
`knowledge_events`, `knowledge_proposals`, optional `knowledge_aliases`)
alongside existing DBs. No new infrastructure. Migrate to a graph engine only
if query patterns demand it.

**Reason:** Personal scale; matches M0/M3 patterns; easy backup and tests.

## Knowledge milestone roadmap (M11–M18)

**Status:** active  
**Evidence:** confirmed  
**Source:** design conversation 2026-08-02  
**Revisit when:** M11 is in daily use or priorities shift

Shell-first sequence. Each milestone is a complete vertical you can stop after
and still use. Do not collapse these into one “build the full world model” drop.

| # | Focus | Delivers | Why this order |
|---|--------|----------|----------------|
| **M11** | Semantic knowledge shell | Types + SQLite; extract → propose → approve → commit; neighborhood query; smoke | Proves representation and the approval loop |
| **M12** | Knowledge tools + orchestrator wire | `knowledge.*` tools; optional neighborhood into model context | Models can *use* the graph, not only CLI |
| **M13** | Project & workspace binding | Claims/events linked to workspace/project; status queries | “Status on aktuator-v2?” becomes real |
| **M14** | Continuous / batch ingest | New chat segment or markdown → proposals (still not blind commit) | Graph grows from daily work |
| **M15** | Identity, merge & contradiction | Aliases, duplicate merge, supports/contradicts, revision | Prevents semantic chaos as volume grows |
| **M16** | First-principles workflow | Fixed analysis template stored as events/claims (goal → laws → limits → scale → next bottleneck) | Direct support for the analysis style that motivated this layer |
| **M17** | Read surface | Simple subgraph view and/or structured CLI/HTTP read API | Navigation without requiring 3D |
| **M18** | Voice / multimodal I/O (optional) | Speech → same knowledge tools | Interface only; same brain |

**Explicitly out of early roadmap**

- Neo4j / Graphiti as a hard dependency
- Fully autonomous agent that writes the permanent graph without approval
- 3D “Stark” UI
- Complete self-model of Workflows inside the graph on day one

**Capability bands**

- **M11–M13** — make first-principles and project-status use *possible*
- **M14–M16** — make growth and analysis *robust*
- **M17–M18** — improve *interface*

### M11 detail (first shell)

**Implementation spec:** [`packages/knowledge/src/AGENTS.md`](../packages/knowledge/src/AGENTS.md) (types, schema, API, extraction, smoke, done-when).

**In scope**

1. Types + SQLite store for nodes, edges, evidence, events, proposals
2. Extraction via structured output from one conversation excerpt or markdown
3. Terminal review: list proposals → accept / edit / reject → commit
4. Query: fetch local neighborhood (1–2 hops) and print
5. Smoke test on temp DB
6. Optional workspace scoping consistent with M9

**Out of scope for M11** — everything listed under M12–M18 and the explicit out-of-roadmap items above.

**Done when**

- [x] One vertical path works: excerpt/fixture → proposals → approve → store → neighborhood query
- [x] Provenance fields populated for committed claims (`sourceEventId` on edges; event + inputHash)
- [x] No personal secrets in public repo; DB path gitignored / `PERSONAL_CONTEXT_DIR` pattern as for LTM
- [x] Smoke: `packages/orchestrator` → `npx tsx scripts/smoke-knowledge.ts`

Later milestones get their own AGENTS.md / context notes when implementation starts; this file remains the roadmap and invariants source.

## First-principles root question (kept)

> How can continuous conversations, analyses, and projects be transformed
> into a durable, reliable model that both I and AI can understand, navigate,
> and extend — without the structure collapsing under duplicates, ambiguity,
> and error?

Branches: Information → Representation → Transformation → Use.
Recursive questions under each node: requires / must preserve / can fail /
limits / detect / correct / next bottleneck.

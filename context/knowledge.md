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

| # | Focus | Delivers |
|---|--------|----------|
| **M11** | Semantic knowledge shell | Store, proposals, neighborhood |
| **M12** | Knowledge tools + wire | Models use graph via tools |
| **M13** | Project & workspace binding | Project status queries |
| **M14** | Continuous / batch ingest | Graph grows from work (proposals only) |
| **M15** | Identity, merge & contradiction | Prevents semantic chaos |
| **M16** | First-principles workflow | One analysis template on the general graph |
| **M17** | Read surface | Navigate without 3D |
| **M18** | Voice / multimodal I/O (optional) | Same brain, speech interface |

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

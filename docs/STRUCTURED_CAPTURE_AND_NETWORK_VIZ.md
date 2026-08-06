# Structured Capture + Knowledge Network Visualization

## Implementation status

**Status:** delivered

- Structured capture pipeline: `00e5d39`
- Subgraph read API and interactive Cytoscape network: `d16a54a`
- Verification: orchestrator typecheck and all 27 offline smoke scripts pass (2026-08-06)

The accepted-knowledge network is now the primary Graph view. The list and detail
pane remain secondary navigation, and pending proposals remain outside the graph
until a human accepts them.

## Purpose

Two gaps block the knowledge system from matching the intended use:

1. **Capture** still materialises conversation fragments (questions, half-sentences, stutter) as proposals — not structured knowledge.
2. **Graph UI** is a searchable list + text neighborhood — not a **network visualisation** of nodes, relations, and context.

This design specifies both at the level required for daily first-principles and systems reasoning: high-signal proposals worth accepting, and a visual graph that behaves like a navigable knowledge network.

## Design principles

- The knowledge **model stays general** (concepts, claims, typed edges, provenance). First-principles and other analyses are usage patterns on top.
- AI **proposes**; humans **accept**. No auto-write to the permanent graph.
- Capture optimises for **structure**, not coverage of every utterance.
- Visualisation optimises for **relations and context**, not spreadsheet browsing.
- One brain: orchestrator + `@workflows/knowledge`. Clients (web now; other surfaces later) consume the same store and read API.
- Prefer a **strong model for extraction** when available; never pretend a weak local model will produce Stark-grade structure unaided.

## Non-goals

- Auto-accept under confidence thresholds
- FP-only or domain-locked node types in the core schema
- 3D / cinematic “Iron Man” chrome as a requirement
- Replacing SQLite as the first store
- A second knowledge database or parallel agent brain

---

# Part 1 — Structured capture

## Problem

Current continuous / heuristic extract often emits:

- Interrogative fragments as nodes or edges
- Broken or duplicated tokens from weak generation
- Labels that embed pseudo-syntax (`-[causes]->`) instead of clean endpoints + relation field
- Little systematic use of limit classification, assumptions, or next-bottleneck chains

Accepting such proposals poisons the graph. Rejecting everything makes capture useless.

## Target output

From a reasoning segment, proposals should be dominated by items of these forms:

| Kind | Example intent |
|------|----------------|
| **Concept** | `rotor`, `battery energy density`, `continuous hover` |
| **Claim** | “Continuous hover power is limited by motor thermal rejection under sustained load” |
| **Edge** | `copper loss —causes→ heat`, `heat —limits→ continuous torque` |
| **Properties on claims/nodes** | `limitKind=fundamental\|technological\|industrial\|economic\|regulatory` |
| **Open / assumption markers** | Claims or concepts explicitly tagged in description/properties, still general types |

**Reject at extract time (do not propose):**

- Pure questions (“How would…?”, “What if…?”)
- Greetings, process talk, mode/system chatter
- Labels under a minimum semantic length / quality bar
- Edges whose endpoints are not resolvable to concept/claim labels
- Near-duplicates of pending or accepted nodes (identity)

## Extraction architecture

### Pipeline

```
Conversation segment (user + relevant assistant turns)
  → Segment gate (substance, rate limit, mode)
  → Structured extract (schema-constrained)
  → Normalise (labels, relations, strip junk)
  → Quality filter (questions, stutter, empty endpoints)
  → Identity / dedupe (accepted + pending)
  → Rank + cap
  → addProposals (pending only) + provenance
```

### Schema-constrained extract (required)

Move off “whatever the heuristic regex finds” as the primary path for quality.

Use `packages/structured` / `completeStructured` with a **strict JSON schema**, for example:

```ts
interface StructuredCaptureResult {
  concepts: Array<{ label: string; description?: string }>;
  claims: Array<{
    label: string;           // declarative sentence or tight noun claim
    description?: string;    // may include limitKind=...
    confidence?: number;
  }>;
  relations: Array<{
    from: string;            // must match a concept/claim label in this result or known graph
    relation: KnowledgeRelation; // enum from existing vocabulary
    to: string;
    confidence?: number;
  }>;
  // optional explicit lists — still stored as claims/concepts + properties, not new core types
  assumptions?: string[];
  openQuestions?: string[];  // stored as claims with marker, or omitted from graph proposals if policy says so
}
```

**Model policy for extract**

- Prefer **frontier or strong local** for the extract call when quality matters (configurable: `KNOWLEDGE_CAPTURE_MODEL` / route tier).
- Chat reply may stay on a cheaper/faster model; extract is a separate completion.
- Offline/heuristic path remains for smoke and degraded mode only — not the quality path.

### Normalisation rules

- Trim, collapse whitespace, reject labels with embedded `-[` / `]->` relation markup
- Map synonym relation strings into the canonical `KnowledgeRelation` set
- Split combined “A causes B which limits C” into multiple edges when the model returns them structured; do not invent multi-hop in one edge
- Attach `limitKind` only when explicitly supported by the segment (no hallucinated fundamentalism)

### Ranking

Prefer, in order:

1. Edges with both endpoints clean + relation in vocabulary
2. Claims with declarative form and optional limitKind
3. Concepts that participate in at least one proposed edge
4. Isolated concepts last

Hard cap per turn remains (e.g. 8). Drop open-question proposals from default continuous capture if they dominate noise; allow them under explicit `/capture` policy if desired.

### Provenance

Every proposal: `sourceType: "conversation"`, `sourceRef` including session + turn/timestamp so UI and audit can link back.

### Done when (capture)

- On a deliberate 10–15 minute first-principles dialogue with a strong extract model, **most** pending proposals are items a careful user would consider accepting.
- Question-shaped and stutter-shaped proposals are rare in the default path.
- Accepted subgraph after a clean session shows real causal/limit structure, not chat debris.

---

# Part 2 — Knowledge network visualisation

## Problem

The Graph tab (list + detail + edge list) makes data *findable* but not *spatial*. The user wants a **network**: nodes and relations visible as a connected structure with context — closer to a mental model than a directory.

## Target experience

- Canvas (or equivalent) showing **accepted** nodes as nodes and **accepted** edges as labelled links.
- Pan / zoom; click node → focus + detail (type, description, properties, provenance summary).
- Click edge → highlight endpoints + relation.
- Filter by type, relation, workspace/project; search pans/highlights matching nodes.
- Neighborhood mode: select node → emphasise 1–2 hop subgraph (dim the rest).
- Empty state: only accepted knowledge; point to proposals for pending.
- Performance: usable for hundreds of nodes initially; document limits; no requirement for million-edge scale in v1.

## Architecture

```
Web client (Graph network view)
  → GET search / neighborhood / node (existing knowledge read HTTP)
  → Optional: GET subgraph?root=&hops= or bulk edges-for-ids if needed for layout
  → Layout in the browser (force-directed or hierarchical)
  → Same store; no duplicate graph database
```

### Data needs

Existing M17 reader covers much of this. Add only if required for smooth viz:

- Batch fetch of edges for a set of node ids, or
- `getSubgraph({ nodeIds?, hops?, status: "accepted" })` returning nodes[] + edges[]

Prefer extending the reader over ad-hoc SQL in the UI server.

### Visual design (requirements, not pixel-perfect chrome)

| Element | Requirement |
|---------|-------------|
| Node | Label + type encoding (colour or shape) |
| Edge | Visible relation label on or near the link |
| Selection | Clear focus; detail panel remains (reuse current detail pane) |
| Filters | Type / relation / text without leaving the canvas |
| Pending | **Not** drawn on the network; stay in proposals panel |

### Library choice

Implement with a focused graph library suitable for a static ES module UI without a full React rewrite, e.g.:

- **Cytoscape.js**, or
- **sigma.js** / graphology, or
- **vis-network**

Pick one; vendor or npm-manage inside the orchestrator UI build path **without** forcing a heavy SPA framework. If the current UI stays plain JS, use a UMD/ESM build dropped into `public/` or a minimal bundling step documented in the package README.

Do **not** block on building a layout engine from scratch.

### Interaction map

1. Open Graph → load accepted nodes + edges (capped initial window or full small graph).
2. Layout runs; user pans/zooms.
3. Click node → select, show detail, optional “expand neighborhood” to pull 2 hops and relayout local region.
4. Search → highlight / center matches.
5. Accept in proposals panel → refresh network (incremental if possible, full reload acceptable in v1).

### Done when (visualisation)

- User can see a multi-node accepted structure as a **connected diagram**, not only as lists.
- User can follow a relation chain visually (e.g. loss → heat → torque limit).
- Filters and selection work without breaking chat/proposals chrome or viewport scroll rules.

---

# Implementation order

1. **Structured capture pipeline** (schema extract, normalise, filter, model routing for extract, tests with fixture + optional live strong model).
2. **Read helpers for subgraph/bulk** if network load needs them.
3. **Network canvas in Graph tab** (library + layout + select/detail integration).
4. **Wire accept → network refresh**; empty/error states; basic filters.
5. **Context docs** (`context/knowledge.md`, `context/interface.md`) — capture quality bar and network viz as the real explore surface; list view becomes secondary.

Ship capture first if they must be split: a beautiful network over bad data is worse than good data with a temporary list.

## Verification

**Capture**

- Fixture segment with clear causal/limit language → proposals are declarative + typed edges; no question-only set.
- Noisy segment (greetings, “how would…”) → few or zero proposals.
- Dedupe: second identical segment does not double pending.

**Network**

- Seed 5+ accepted nodes and 4+ edges via CLI or accept path.
- Graph network shows all; click path heat←causes←copper loss works.
- Pending items never appear as network nodes.

## Success criteria

- Structured reasoning sessions produce a **high accept rate** on proposals.
- The user inspects knowledge primarily through a **network view** of accepted structure.
- Propose → accept and general graph invariants hold.
- Path remains open to Linux/daemon clients using the same HTTP/read APIs later.

## Related docs

- `docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`
- `docs/INTERACTION_CAPTURE_ITERATION.md`
- `docs/KNOWLEDGE_EXPLORE_UI.md` (list/detail baseline; network supersedes it as primary explore)
- M17 `packages/knowledge/src/read.ts`

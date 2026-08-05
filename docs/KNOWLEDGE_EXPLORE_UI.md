# Knowledge Explore UI

## Purpose

Make the **accepted knowledge graph visible and navigable** in the same web surface used for reasoning and capture.

Today the system can store concepts, claims, and typed relations after human accept, but the user cannot see the graph. Pending proposals appear in a side panel; the permanent model is effectively invisible. Without a read/explore path, accept/reject is guesswork and continuous capture has no feedback loop.

This design closes that gap. It does not replace the general graph model, does not auto-accept, and does not require a heavy SPA or 3D visualiser.

## Goals

1. See **accepted** nodes (type, label, description, status, useful properties such as limitKind when present).
2. See **typed edges** between them (`requires`, `limits`, `causes`, …).
3. Open a node → **neighborhood** (1–2 hops) with nodes + edges.
4. Search / filter (label, type, workspace when available).
5. Clear separation: **Pending (proposals)** vs **Accepted (graph)**.
6. Reuse existing `@workflows/knowledge` read surface (`createKnowledgeReader`, store APIs) and existing HTTP integration where present — no second brain.

## Non-goals

- Full graph editor (drag layout, manual edge drawing as primary workflow)
- 3D / cinematic visualisation
- Auto-accept or write paths beyond existing accept/reject
- Replacing CLI/`--json` read paths
- FP-specific UI or new core node types

## Current baseline

| Piece | Exists |
|-------|--------|
| SQLite store, propose → accept | yes |
| `getNode`, `findNodes`, `getNeighborhood` | yes |
| `createKnowledgeReader` + DTOs (M17) | yes |
| Optional `KNOWLEDGE_HTTP_READ` + `GET /v1/knowledge/*` | yes (gated) |
| Web chat + proposals panel | yes |
| Visual explore of accepted graph in web | **no** |

## Target experience

From the orchestrator web UI the user can switch between (or dock):

- **Chat** — free-form reasoning, active/neutral, continuous proposals
- **Proposals** — pending queue (already largely there)
- **Graph** — accepted knowledge explore

### Graph view (minimum that counts as done)

**A. Node list / search**

- Default: accepted nodes, newest or alphabetical, capped (e.g. 50) with “load more” or search
- Filters: text on label, type (`concept` | `claim` | …), optional workspace
- Empty state copy: explains that only **accepted** proposals appear here; pending live in the proposals panel

**B. Node detail**

Selecting a node shows:

- id, type, label, description
- status, workspaceId, timestamps
- Parsed properties from description when present (e.g. `limitKind=technological`) — display clearly, do not require schema migration for v1
- Actions: “Show neighborhood”, optional “copy id”

**C. Neighborhood**

- 1 hop default; toggle 2 hops
- List (required): for each edge, show `fromLabel —relation→ toLabel` with node ids available
- Optional lightweight visual (nice-to-have, not blocking): simple force-free layout or hierarchical list; a readable edge list is enough for v1 if time is tight
- Clicking a neighbor node selects it (detail + can re-center neighborhood)

**D. Integration with proposals**

- After accept in proposals panel, graph list can refresh (or shows a “refresh” control)
- Optional later: from a pending proposal, “preview impact” (which labels would link) — not required for v1

## Architecture

```
Web UI (static)
  → same origin HTTP
    → GET /v1/knowledge/nodes?status=accepted&label=&type=&limit=
    → GET /v1/knowledge/nodes/:id
    → GET /v1/knowledge/neighborhood/:id?hops=1|2
    → (existing) GET /v1/knowledge/proposals?sessionId=
```

- Enable knowledge HTTP read when UI needs it (document env: `KNOWLEDGE_HTTP_READ=true` alongside UI), **or** fold the same handlers into the UI server so one `npm run ui` works without a second mental switch.
- Prefer **one process** UX: `npm run ui` should serve chat + proposals + graph without requiring the user to remember a second flag if avoidable. Implementation may reuse integration routes or mount the same read handlers on the UI server.
- All reads go through store / `createKnowledgeReader` — no parallel query logic in the frontend.

### Response shapes

Reuse M17 DTOs:

- `KnowledgeNodeDto`
- `KnowledgeEdgeDto`
- `NeighborhoodRead`
- `SearchRead`

Do not invent a second JSON dialect for the web client.

## UI structure (concrete)

Extend the existing shell rather than a new app:

**Option A (recommended):** Third primary column or tab within the main area:

- Tabs on main: `Chat` | `Graph`
- Right column remains **Proposals** (pending)
- Graph tab contains search + list + detail/neighborhood split

**Option B:** Replace main content via a top-level mode toggle `Chat / Graph` (same data requirements).

Layout must respect the existing viewport-locked scroll rules (`docs/FIX_UI_CHAT_LAYOUT_WRAP.md`): graph panes scroll internally; chrome stays put.

### Empty and error states

- No accepted nodes: explain propose → accept; link attention to proposals panel
- HTTP/store unavailable: show error, do not blank the whole UI
- Neighborhood with only the root: “No accepted edges from this node yet”

## Implementation order

1. **API wiring for UI** — ensure list nodes, get node, neighborhood are reachable from the web origin used by `npm run ui` (enable/mount knowledge read).
2. **Graph tab/panel shell** — navigation between Chat and Graph without breaking chat/proposals.
3. **Search + node list** (accepted default).
4. **Node detail + neighborhood list** (1–2 hops).
5. **Refresh after accept** (events or explicit refresh).
6. Polish: filters, empty states, optional simple visual.

## Files likely touched

- `packages/orchestrator/src/ui/web/public/index.html`
- `packages/orchestrator/src/ui/web/public/app.js`
- `packages/orchestrator/src/ui/web/public/styles.css`
- `packages/orchestrator/src/ui/web/main.ts` and/or `src/integration/httpServer.ts` (mount/read routes)
- Possibly thin reuse of `packages/knowledge` reader only — no store redesign

## Verification

1. Accept 2–3 clean nodes and at least one edge (via UI or CLI).
2. Open Graph view → both nodes visible.
3. Select node → neighborhood shows the edge with correct relation.
4. Search by label filters the list.
5. Pending proposals still only in proposals panel; rejected never appear in Graph.
6. Long chat + graph switch does not break viewport scroll behaviour.

## Success criteria

- User can answer: “What is in my knowledge graph?” by looking at the UI, not only CLI.
- User can answer: “How does node A relate to B?” via neighborhood.
- Accepting a proposal has a visible effect in Graph after refresh.
- Same propose → accept gate; same general graph; no second knowledge system.

## Relation to other docs

- Parent capability: `docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`
- Capture quality iteration: `docs/INTERACTION_CAPTURE_ITERATION.md`
- Layout constraints: `docs/FIX_UI_CHAT_LAYOUT_WRAP.md`
- Read API baseline: M17 / `packages/knowledge/src/read.ts`
- Decision log: update `context/knowledge.md` and `context/interface.md` when this ships

# Milestone 12 — Knowledge tools + orchestrator wire

## Mål

La **modeller bruke** den semantiske knowledge-grafen via det eksisterende tool-interfacet — ikke bare CLI.

M11 leverte store + proposals + neighborhood + offline smoke.  
M12 kobler det inn i `packages/tools` + orchestrator tool-loop, med valgfri undergraf i modellkontekst.

**Invariant fra M11 beholdes:** AI foreslår; permanent graf endres bare via `accept` (tool eller CLI), ikke blind write fra chat-tur.

Roadmap: `context/knowledge.md`.

## Scope

1. Registrer knowledge-tools i tool registry (samme `Tool` / `ToolResult` kontrakt som M2)
2. Tools kan lese og foreslå; write til permanent graf kun via eksplisitt accept/reject tools
3. Orchestrator: knowledge-store tilgjengelig når tools er enabled; tools får store via context/closure
4. Valgfri **neighborhood inject** inn i system/context før complete (env-gated, default off)
5. Smoke: registry list + execute read tools + propose/accept path på temp DB
6. Eksisterende `--knowledge` CLI forblir; tools er tillegg, ikke erstatning

## Utenfor scope (M12)

- Prosjekt/workspace hard binding og status-API (M13)
- Auto-ingest av hver chat-tur (M14)
- Alias-merge / contradiction engine (M15)
- First-principles template workflow (M16)
- Graf-UI (M17), stemme (M18)
- Endre default `handle()` til alltid å hente hele grafen
- Auto-accept av proposals fra modellen
- Nye persistensmotorer (Neo4j etc.)

## Filer (foreslått)

```
packages/knowledge/src/
  AGENTS.md           # M11 (uendret som store-spec)
  AGENTS-M12.md       # denne filen
  tools.ts            # createKnowledgeTools(store): Tool[]
  formatNeighborhood.ts  # optional: nodes/edges → compact text for prompts
  index.ts            # re-export tools helpers

packages/tools/src/
  # either register from orchestrator factory, or
  # thin adapter if tools package must stay free of knowledge dep
  # Prefer: orchestrator wires knowledge tools into registry at startup
  # so packages/tools does not hard-depend on knowledge (avoid cycles).

packages/orchestrator/src/
  orchestrator.ts / index.ts  # wire store + register knowledge tools when enabled
  # optional: injectNeighborhoodIfEnabled(messages)

scripts/smoke-knowledge-tools.ts
```

**Dependency rule:** `packages/knowledge` may depend on `packages/tools` *types only* if needed, **or** define tools inside knowledge and register from orchestrator. Prefer **orchestrator owns wiring** so `tools` stays generic and `knowledge` stays domain.

## Tools (minimum set)

Names are stable for models; keep descriptions short and action-oriented.

| Tool | Side effect | Purpose |
|------|-------------|--------|
| `knowledge_find` | read | Find nodes by label/type/status |
| `knowledge_neighborhood` | read | 1–2 hop subgraph around a node id |
| `knowledge_list_proposals` | read | List proposals (default pending) |
| `knowledge_propose` | write proposals only | Create event + proposals from structured payload or short text |
| `knowledge_accept` | permanent write | Accept proposal id (optional label edits) |
| `knowledge_reject` | proposal state | Reject proposal id |

### Optional in M12 (nice, not required for done-when)

| Tool | Purpose |
|------|--------|
| `knowledge_get` | Get single node by id |
| `knowledge_trace` | Return event / evidence for a node or edge if cheap to implement |

Defer `knowledge_find_contradictions` to M15 unless trivial.

### Parameter sketches

```ts
// knowledge_find
{ label?: string, type?: string, status?: string, limit?: number }

// knowledge_neighborhood
{ nodeId: string, hops?: 1 | 2 }

// knowledge_list_proposals
{ status?: "pending" | "accepted" | "rejected" }

// knowledge_propose
// Prefer structured fields when model is reliable; allow text for shell
{
  text?: string,           // optional free text → heuristic or structured extract later
  concepts?: Array<{ label: string, description?: string }>,
  claims?: Array<{ label: string, description?: string, confidence?: number }>,
  relations?: Array<{ from: string, relation: string, to: string, confidence?: number }>,
  sourceRef?: string       // default "tool-propose"
}

// knowledge_accept
{ proposalId: string, label?: string, description?: string }

// knowledge_reject
{ proposalId: string }
```

### ToolResult conventions

- `ok: true` → `output` human-readable summary; `data` machine-readable (nodes/edges/proposals JSON-serializable)
- Business failures (`unknown id`, empty graph) → `ok: false` + `error`, do not throw
- Cap `output` size (e.g. 8–16 KiB) so tool results do not blow context; put full lists in `data` only if small, else truncate `output` with counts

## Orchestrator wire

### Enablement (defaults off)

```
KNOWLEDGE_TOOLS_ENABLED=false   # register knowledge tools into tool registry
KNOWLEDGE_INJECT_ENABLED=false  # inject compact neighborhood/facts into context
KNOWLEDGE_INJECT_MAX_CHARS=2000
KNOWLEDGE_INJECT_HOPS=1
KNOWLEDGE_DB_PATH=...           # already from M11
```

When `TOOLS_ENABLED` is false, knowledge tools are also unavailable (same global gate), unless you explicitly document a knowledge-only path — prefer one gate: tools on + `KNOWLEDGE_TOOLS_ENABLED`.

### Startup

1. Resolve db path (`resolveKnowledgeDbPath`)
2. `createKnowledgeStore({ dbPath })` — long-lived for process, or per-request if simpler (document choice; prefer one store per CLI/HTTP process)
3. If `KNOWLEDGE_TOOLS_ENABLED`: `registry.register` each knowledge tool
4. Tool closures capture `store` (or resolve store inside execute from process-level singleton)

### Tool loop

No special case beyond registration: existing tool-call parse → `registry.execute` → append result → re-complete. Knowledge tools are normal tools.

### Optional context inject

When `KNOWLEDGE_INJECT_ENABLED=true`:

1. Derive query tokens from latest user message (simple keywords; no heavy NLP required)
2. `findNodes({ label: token, status: "accepted", limit: N })` for top tokens
3. For best hit(s), `getNeighborhood(id, { hops: KNOWLEDGE_INJECT_HOPS })`
4. Format compact text (labels + `from -[relation]-> to` lines)
5. Append as system/context block, hard-capped by `KNOWLEDGE_INJECT_MAX_CHARS`

If no hits, inject nothing. Never inject pending proposals as facts.

## Propose policy (important)

`knowledge_propose` must:

- create an **event** + **pending proposals** only
- never mark nodes/edges accepted
- return proposal ids in `data` so the model or user can call `knowledge_accept`

Models may call accept in the same turn if the product allows it; that is explicit tool use, not silent auto-commit. Document in tool description: *"Creates pending proposals only. Call knowledge_accept to commit."*

For `text`-only propose in M12: reuse M11 heuristic extract **or** call `runExtraction` when a `complete` fn is available. Prefer structured fields when the model supplies them. Live LLM extract inside the tool is optional; fixture/heuristic is enough for smoke.

## formatNeighborhood (helper)

```ts
function formatNeighborhood(input: {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  maxChars?: number;
}): string;
```

Stable, boring format for prompts and tool `output`.

## Smoke (`smoke-knowledge-tools.ts`)

Offline, temp DB, no live frontier required:

1. create store + register knowledge tools on a fresh registry
2. `knowledge_propose` with structured concepts/relations
3. `knowledge_list_proposals` → pending count ≥ 1
4. `knowledge_accept` on node proposals then edge proposals
5. `knowledge_find` finds accepted concept
6. `knowledge_neighborhood` returns edges
7. `knowledge_reject` on an extra pending proposal
8. Assert tools are absent/no-op path when `KNOWLEDGE_TOOLS_ENABLED` false (unit or conditional)

## Privacy

Same as M11: no real personal graph data in repo; smoke uses fake labels; db under gitignore / `PERSONAL_CONTEXT_DIR`.

## Ferdig når

- [ ] Knowledge tools implementert og registrerbare via orchestrator when enabled
- [ ] Tool loop can call find / neighborhood / propose / accept / reject
- [ ] Propose never auto-accepts
- [ ] Optional inject behind flag, default off, max chars enforced
- [ ] `smoke-knowledge-tools.ts` passes offline
- [ ] Default chat path unchanged when flags off
- [ ] M11 CLI `--knowledge` still works
- [ ] `context/milestones.md` / knowledge status updated when delivered

## Design notes (why this shape)

- **Tools over bespoke handle branches** — one extension mechanism; voice/UI later call the same tools (M18).
- **Orchestrator wires** — keeps `packages/tools` free of domain deps; knowledge remains the domain package.
- **Defaults off** — matches Workflows policy: no surprise token use or graph writes.
- **Accept still explicit** — minimizes iteration toward a trustworthy world model; autonomy comes later via policy (not by skipping the proposal table).

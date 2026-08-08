# Milestone 11 — Semantic knowledge model (shell)

## Knowledge Infrastructure v2 — current storage contract

The M11 domain objects and proposal/approval invariants below remain active.
The SQLite schema and factory are now a compatibility adapter during migration,
not the long-term canonical architecture.

- Consumers depend on storage-independent contracts from `storage/contracts.ts`.
- PostgreSQL/PostGIS is the canonical structured/spatial target.
- Schema changes use ordered SQL files in `packages/knowledge/migrations` and
  the checksum/lock/transaction runner in `postgres/migrations.ts`.
- Canonical IDs are UUIDs shared by SQL, graph, vector, source and audit records.
- Graph/vector backends are reconstructable projections, never competing truth.
- Do not bypass proposal acceptance, provenance, workspace, identity/merge, or
  contradiction/supersession semantics in a database adapter.
- Keep PostgreSQL/PostGIS/graph-specific APIs inside adapters; orchestrator stays
  thin and existing `KnowledgeStore` callers remain compatible during cutover.
- PostgreSQL canonical writes that affect accepted projections append outbox
  work in the same transaction; adapters never synchronously depend on graph or
  vector availability.
- SQLite import preserves canonical UUIDs and provenance, is safe to retry, and
  must fail visibly on real identity/alias conflicts rather than guessing.

## Mål

Gi en **minimal, utskiftbar semantisk verdensmodell** over plain `MemoryFact`:

- eksplisitte konsepter, påstander (claims), relasjoner, hendelser og proveniens
- extraction via structured output → **forslag** → menneskelig godkjenning → permanent store
- hent lokal undergraf (neighborhood)

Dette er første vertikale bevis på at representasjonen fungerer. Short-term memory og LTM forblir uendret.

Visjon og M12–M18-roadmap: `context/knowledge.md`.

## Privacy

| OK i public repo | Ikke i public repo |
|------------------|--------------------|
| Interface, schema, types, smoke med *fake* data | Ekte samtaler, claims, personlige analyser |
| Tom/demo DB under gitignore | Committed knowledge med ekte innhold |
| Docs / denne AGENTS.md | |

Default storage path (samme mønster som LTM):

```
KNOWLEDGE_DB_PATH=./data/knowledge.db   # under Orchestrator/data — gitignore data/
# eller
PERSONAL_CONTEXT_DIR=/path/outside/repo  # knowledge.db der
```

## Scope

1. `packages/knowledge` med types, SQLite store, API, index
2. Node-typer: `concept | claim | event | source | project | artifact`
3. Edges med typed relation + optional confidence + sourceEventId
4. Proposals (ikke direkte write til permanent graf fra AI)
5. Extraction: én tekstkilde (samtaleutdrag eller markdown) → structured JSON → proposals
6. Review-API / CLI: list proposals → accept | reject | edit-label → commit
7. `getNeighborhood(nodeId, hops?)` (1–2 hops)
8. Factory `createKnowledgeStore(config)`
9. Smoke på temp-DB
10. Valgfri workspace-scope-felt (string) for senere M13 — kan være `null` i M11

## Utenfor scope (M11)

- `knowledge.*` tools i orchestrator tool-loop (M12)
- Auto-injeksjon av undergraf i hver `handle()` (M12+)
- Prosjektstatus-API og hard workspace-binding (M13)
- Kontinuerlig ingest av hver chat-tur (M14)
- Alias-merge, contradiction-motor (M15)
- First-principles template-workflow (M16)
- Graf-UI / 2D-visning (M17)
- Stemme (M18)
- Neo4j / Graphiti / embeddings på knowledge-noder
- Blind auto-commit av AI-forslag

## Filer

```
packages/knowledge/
  package.json
  tsconfig.json
  README.md
  src/
    AGENTS.md          # denne filen
    types.ts
    store.ts           # SQLite
    knowledge.ts       # API
    extract.ts         # parse structured extraction result → proposals
    index.ts

packages/orchestrator/scripts/smoke-knowledge.ts
```

Orchestrator-wire i M11: **minimal** — CLI eller script som importerer pakken er nok. Ingen krav om endring i `handle()`.

## Types (minimum)

```ts
export type KnowledgeNodeType =
  | "concept"
  | "claim"
  | "event"
  | "source"
  | "project"
  | "artifact";

export type KnowledgeStatus =
  | "proposed"
  | "accepted"
  | "disputed"
  | "rejected";

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  description?: string;
  status: KnowledgeStatus;
  workspaceId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Core relation vocabulary for M11 — extend later, do not explode early */
export type KnowledgeRelation =
  | "requires"
  | "limits"
  | "causes"
  | "increases"
  | "reduces"
  | "measures"
  | "controls"
  | "supports"
  | "contradicts"
  | "used_in"
  | "part_of"
  | "about";

export interface KnowledgeEdge {
  id: string;
  fromNodeId: string;
  relation: KnowledgeRelation | string; // string allowed for forward-compat
  toNodeId: string;
  confidence?: number;
  sourceEventId?: string;
  status: KnowledgeStatus;
  createdAt: number;
}

export interface KnowledgeEvidence {
  id: string;
  claimNodeId: string;
  sourceNodeId: string;
  excerpt?: string;
  stance: "supports" | "contradicts" | "mentions";
  confidence?: number;
  createdAt: number;
}

export interface KnowledgeEvent {
  id: string;
  sourceType: "conversation" | "file" | "project" | "manual";
  sourceRef: string;
  model?: string;
  inputHash?: string;
  createdAt: number;
}

export interface KnowledgeProposal {
  id: string;
  eventId: string;
  kind: "node" | "edge" | "evidence";
  payload: Record<string, unknown>; // shape depends on kind
  status: "pending" | "accepted" | "rejected";
  createdAt: number;
  resolvedAt?: number;
}
```

## Compatibility schema (SQLite; historical M11 adapter)

```sql
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  workspace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kn_type ON knowledge_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kn_label ON knowledge_nodes(label);
CREATE INDEX IF NOT EXISTS idx_kn_workspace ON knowledge_nodes(workspace_id);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  confidence REAL,
  source_event_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (from_node_id) REFERENCES knowledge_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES knowledge_nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_ke_from ON knowledge_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_ke_to ON knowledge_edges(to_node_id);

CREATE TABLE IF NOT EXISTS knowledge_events (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  model TEXT,
  input_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_evidence (
  id TEXT PRIMARY KEY,
  claim_node_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  excerpt TEXT,
  stance TEXT NOT NULL,
  confidence REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_proposals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
```

## API

```ts
export interface KnowledgeStore {
  /** Record an extraction/analysis event */
  createEvent(input: {
    sourceType: KnowledgeEvent["sourceType"];
    sourceRef: string;
    model?: string;
    inputHash?: string;
  }): Promise<KnowledgeEvent>;

  /** Store structured extraction output as pending proposals */
  addProposals(
    eventId: string,
    items: Array<{ kind: KnowledgeProposal["kind"]; payload: Record<string, unknown> }>
  ): Promise<KnowledgeProposal[]>;

  listProposals(filter?: {
    status?: KnowledgeProposal["status"];
    eventId?: string;
  }): Promise<KnowledgeProposal[]>;

  /** Accept: materialize node/edge/evidence; mark proposal accepted */
  acceptProposal(id: string, edits?: Record<string, unknown>): Promise<void>;

  rejectProposal(id: string): Promise<void>;

  getNode(id: string): Promise<KnowledgeNode | null>;

  findNodes(query: {
    type?: KnowledgeNodeType;
    label?: string; // exact or simple LIKE
    workspaceId?: string | null;
    status?: KnowledgeStatus;
    limit?: number;
  }): Promise<KnowledgeNode[]>;

  /** 1 hop default; max 2 in M11 */
  getNeighborhood(
    nodeId: string,
    options?: { hops?: 1 | 2; status?: KnowledgeStatus }
  ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>;

  close(): void;
}

export function createKnowledgeStore(config: {
  dbPath: string;
}): KnowledgeStore;
```

Identity in M11: **simple**. Matching on exact `label` + `type` when accepting a concept proposal may reuse an existing accepted node id instead of inserting a duplicate. No fuzzy merge engine (M15).

## Extraction (structured output)

Input: plain text (conversation excerpt or markdown).

Use `packages/structured` (`completeStructured` + JSON parse/validate).

Suggested output shape (validate with a small schema in knowledge or structured):

```ts
interface ExtractionResult {
  concepts: Array<{ label: string; description?: string }>;
  claims: Array<{
    label: string; // short statement
    description?: string;
    confidence?: number;
  }>;
  relations: Array<{
    from: string; // concept/claim label
    relation: string;
    to: string;
    confidence?: number;
  }>;
  evidence?: Array<{
    claimLabel: string;
    excerpt: string;
    stance: "supports" | "contradicts" | "mentions";
  }>;
}
```

Flow:

1. `createEvent({ sourceType, sourceRef, model })`
2. Model returns `ExtractionResult`
3. `addProposals` — one proposal per concept, claim, relation, evidence item
4. Human reviews via `listProposals` / accept / reject
5. On accept of edge: resolve endpoint labels to node ids (create concept nodes if accepted in same batch or already present)

Extraction helper can live in `extract.ts` as pure functions + optional `runExtraction({ complete, text, ... })` that calls structured complete. Orchestrator does not need to own this in M11.

## CLI / script (minimal)

Not a full product UI. Enough to exercise the vertical:

```bash
# example — exact flags flexible
npx tsx scripts/smoke-knowledge.ts
# or thin CLI later:
# knowledge:extract --file ./sample.md
# knowledge:proposals
# knowledge:accept <id>
# knowledge:neighborhood <nodeId>
```

Smoke is mandatory; interactive CLI is optional if smoke covers the path.

## Env

```
KNOWLEDGE_DB_PATH=./data/knowledge.db
# Optional: reuse PERSONAL_CONTEXT_DIR if set (same policy as LTM)
```

No auto-extract-on-chat flag in M11.

## Testing (`smoke-knowledge.ts`)

1. createEvent + addProposals from a fixed fake `ExtractionResult` (no live model required)
2. listProposals → pending count
3. acceptProposal for a concept → getNode / findNodes
4. accept edge between two concepts → getNeighborhood includes both + edge
5. rejectProposal → status rejected, not in neighborhood of accepted graph
6. Temp DB path; delete after

Optional second smoke path: live model extraction behind env flag (default off).

## Integrasjon (M11)

- **Ikke** endre default `handle()` behaviour
- Pakken eksporteres som `@workflows/knowledge` (eller repo-lokal path pattern som andre packages)
- M12 vil legge tools oppå denne API-en

## Ferdig når

- [x] `packages/knowledge` eksisterer med types, store, API
- [x] Smoke passerer uten live model
- [x] Én dokumentert vertical: text/fixture → proposals → accept → neighborhood
- [x] Ingen ekte persondata i repo; DB under gitignore
- [x] Short-term + LTM uendret
- [x] `context/knowledge.md` / milestones forblir source of truth for roadmap

## Avhengigheter

- SQLite via same stack as memory (`better-sqlite3` or existing shared pattern)
- `packages/structured` for extraction path when using a live model
- **Ikke** packages/embeddings required for M11

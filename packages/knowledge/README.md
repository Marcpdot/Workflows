# @workflows/knowledge

Semantic knowledge domain, canonical PostgreSQL repository, ingest, identity,
first-principles workflows and read surfaces.

## Canonical runtime

PostgreSQL/PostGIS is the sole authoritative knowledge backend.
`createKnowledgeStore()` resolves `KNOWLEDGE_DATABASE_URL` and returns the
storage-independent `CanonicalKnowledgeRepository`; orchestrator callers do not
select a database implementation.

```bash
docker compose -f compose.knowledge.yml up -d
cd packages/orchestrator
npm run knowledge:migrate
npm run knowledge:test:postgres
npm run knowledge:test:canonical
```

Configuration:

- `KNOWLEDGE_POSTGRES_PORT` controls the Compose host port (default `55432`)
- `KNOWLEDGE_DATABASE_URL` defaults to
  `postgresql://workflows:workflows@127.0.0.1:55432/workflows`
- `KNOWLEDGE_DATABASE_SSL=true|false` (default `false`)
- `KNOWLEDGE_DATABASE_APPLICATION_NAME` (default `workflows-knowledge`)
- `KNOWLEDGE_MIGRATIONS_DIR` is normally auto-resolved

Migrations are checksum-verified, advisory-locked and transactional. Accepted
canonical writes append retryable projection-outbox work; graph and vector
systems remain rebuildable projections and cannot invalidate PostgreSQL truth.

## Semantic vector projection

`PostgresVectorRepository` stores derived representations in pgvector. Records
reference canonical target UUIDs plus optional canonical source/chunk UUIDs;
they contain embedding/filter metadata, not duplicated canonical content.
Embeddable canonical nodes are all accepted current or future types with their
type, label and optional description as deterministic semantic text.

The active schema uses `vector(1536)` with an HNSW cosine index. Providers must
declare model, model version and dimension, and searches require the matching
model/version so incompatible embedding spaces are not mixed. A different
dimension requires a forward schema/index migration rather than silent coercion.
`rebuildSemanticVectorProjection()` scans the complete accepted canonical state
with keyset pagination in one repeatable-read snapshot, embeds it, then
atomically replaces only the selected model/version projection. Other embedding
spaces remain intact. `processVectorProjectionOutbox()` handles only vector
jobs, serializes workers with an advisory lock, and leaves failed jobs retryable.
Embedding generation remains behind `SemanticEmbeddingProvider`; the repository
never invents embeddings and similarity results never merge identities.

## Graph projection

`Neo4jGraphRepository` is the dedicated, rebuildable topology projection.
Canonical nodes become `:CanonicalNode` nodes keyed by PostgreSQL UUIDs;
canonical edges become directed `:CANONICAL_RELATION` relationships keyed by
their PostgreSQL edge UUIDs with exact canonical `relation` values. The stable
shape supports future type/relation vocabulary without a second graph ontology.
Only accepted nodes and edges with accepted endpoints are projected, and valid
self-relations are retained.

`rebuildGraphProjection()` scans complete accepted topology through a keyset-
paginated repeatable-read PostgreSQL snapshot and replaces Neo4j topology in one
Neo4j transaction. `processGraphProjectionOutbox()` handles node/edge upsert,
delete and rebuild with advisory-lock serialization and retryable errors.
Expansion, relation filtering and directed shortest paths execute in Cypher.
Canonical status/topology mutations enqueue invalidation in the same PostgreSQL
transaction: disputed/rejected nodes trigger graph reconciliation and vector
deletion, edge deletes enqueue graph deletion, and merge uses graph rebuild plus
survivor/retired vector updates. Projection processing remains asynchronous and
retryable.

Local defaults from `compose.knowledge.yml` are Bolt
`bolt://127.0.0.1:57687` and HTTP `http://127.0.0.1:57474`, configurable through
`KNOWLEDGE_NEO4J_BOLT_PORT`, `KNOWLEDGE_NEO4J_HTTP_PORT`,
`KNOWLEDGE_NEO4J_USER`, `KNOWLEDGE_NEO4J_PASSWORD` and
`KNOWLEDGE_NEO4J_DATABASE`.

## Hybrid retrieval

`HybridKnowledgeRetrievalService` is the deterministic retrieval substrate over
canonical PostgreSQL, Neo4j, pgvector and optional PostGIS candidates. Requests
can combine explicit canonical IDs/aliases, project or graph roots, workspace
and entity filters, relation/hop constraints, a caller-supplied query vector and
model/version, and bounded evidence/observation/source hydration.

Exact lookup skips graph/vector when unnecessary. Root/project graph results can
narrow pgvector candidate IDs; unconstrained semantic discovery can optionally
request bounded graph enrichment. Ranking is transparent: exact/project and
explicit candidate signals, graph/spatial membership, then semantic cosine
score. Every discovery hit is rehydrated from canonical PostgreSQL, so an
unattributed graph/vector object cannot become a result.

Results report which strategies ran, skipped, degraded or were unavailable.
Missing graph/vector layers degrade independently, but a requested narrowing
scope never silently widens to global semantic search. Hard limits cover results,
hops, edges, semantic candidates, provenance rows, sources and a deterministic
context-unit budget.

## Knowledge Agent

`KnowledgeAgentService` is the bounded cognitive interface over retrieval and
canonical domain contracts. Navigator tools resolve identities, run hybrid
retrieval, traverse graph paths, and inspect canonical provenance. Curator tools
inspect possible duplicates/conflicts/structure and create pending entity,
claim, relation, evidence, observation, merge, or supersession proposals.
Their allowlists and policies remain separate even while they share a runtime.

The model boundary is `KnowledgeAgentModelAdapter`; storage has no model-vendor
dependency. Runs cap tool calls, context characters, graph hops, results, and
proposal count. Structured audit events record run ID, mode, tools, canonical
IDs, retrieval degradation, proposal IDs, counts, and outcome without prompts
or full content by default. No agent tool exposes SQL, Cypher, filesystem,
proposal acceptance, or direct merge/supersede operations.

Agent curation never commits permanent truth. Merge and supersession are
first-class pending proposal kinds; only separate canonical approval executes
them transactionally. Similarity, label equality, graph proximity, and
retrieval confidence support inspection, never identity collapse or truth
arbitration.

## Identity

Every independently referable thing may have one stable canonical UUID. A label,
workspace, source, repeated observation or semantic similarity is not an
identity key. Explicit canonical IDs and aliases can reuse an identity; explicit
merge consolidates IDs only after sameness is established. Ambiguous labels
remain ambiguous for review.

The initial node vocabulary remains useful, but PostgreSQL accepts future
referable node kinds without requiring a new identity architecture.

Accepted node proposals append provenance to `knowledge_observations`, including
explicit `canonicalId` and alias reuse. Rows retain target, event, optional
source, occurrence kind, timestamp and metadata; normal reads do not write.
Qualified `supports`, `contradicts` and `test_evidence` live separately in
`knowledge_evidence` and may target any canonical type. `mentions` is an
observation rather than evidence.

## Tests

From `packages/orchestrator`:

```bash
npm run typecheck
npm run knowledge:test:postgres
npm run knowledge:test:canonical
npm run knowledge:test:vector
npm run knowledge:test:graph
npm run knowledge:test:hybrid
npm run knowledge:test:agent
```

Knowledge smoke scripts create isolated PostgreSQL databases and clean them up.
No SQLite knowledge import or compatibility runtime exists. SQLite use in memory
and other independent packages is outside this package.

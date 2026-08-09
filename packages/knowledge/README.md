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

Local defaults from `compose.knowledge.yml` are Bolt
`bolt://127.0.0.1:57687` and HTTP `http://127.0.0.1:57474`, configurable through
`KNOWLEDGE_NEO4J_BOLT_PORT`, `KNOWLEDGE_NEO4J_HTTP_PORT`,
`KNOWLEDGE_NEO4J_USER`, `KNOWLEDGE_NEO4J_PASSWORD` and
`KNOWLEDGE_NEO4J_DATABASE`.

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
```

Knowledge smoke scripts create isolated PostgreSQL databases and clean them up.
No SQLite knowledge import or compatibility runtime exists. SQLite use in memory
and other independent packages is outside this package.

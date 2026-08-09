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
```

Knowledge smoke scripts create isolated PostgreSQL databases and clean them up.
No SQLite knowledge import or compatibility runtime exists. SQLite use in memory
and other independent packages is outside this package.

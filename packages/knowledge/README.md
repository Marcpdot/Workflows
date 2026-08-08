# @workflows/knowledge

Semantic knowledge domain, storage contracts, ingest, identity, first-principles, and read surface.

## Knowledge Infrastructure v2 foundation

`KnowledgeStore` remains the backwards-compatible domain/service API. New code
should depend on `CanonicalKnowledgeRepository`, `GraphRepository`,
`VectorRepository`, or `SpatialRepository` rather than a concrete database.
SQLite remains available through `createSqliteKnowledgeRepository()` during
the migration; PostgreSQL/PostGIS is the canonical target.

Local PostgreSQL with PostGIS and pgvector in the same instance:

```bash
docker compose -f compose.knowledge.yml up -d
cd packages/orchestrator
npm run knowledge:migrate
```

Configuration:

- `KNOWLEDGE_POSTGRES_PORT` controls the Compose host port (default `55432`;
  container port remains `5432`)
- `KNOWLEDGE_DATABASE_URL` (default `postgresql://workflows:workflows@127.0.0.1:55432/workflows`)
- `KNOWLEDGE_DATABASE_SSL=true|false` (default `false`)
- `KNOWLEDGE_DATABASE_APPLICATION_NAME` (default `workflows-knowledge`)
- `KNOWLEDGE_MIGRATIONS_DIR` (normally auto-resolved)

Migrations live in `packages/knowledge/migrations`, are checksum-verified, run
under a PostgreSQL advisory lock, and apply one transaction per migration.
The migrations enable PostGIS and pgvector, create the canonical schema plus a
projection outbox, and keep label-based identity resolution in the domain layer.
They do not switch application traffic away from SQLite yet.

The real database integration check creates an isolated temporary database,
runs migrations twice, exercises canonical and spatial reads/writes, and drops
the database in a `finally` cleanup:

```bash
cd packages/orchestrator
npm run knowledge:test:postgres
```

```bash
cd packages/knowledge
npm install

cd ../orchestrator
npx tsx scripts/smoke-knowledge.ts
npx tsx scripts/smoke-knowledge-tools.ts
npx tsx scripts/smoke-knowledge-projects.ts
npx tsx scripts/smoke-knowledge-ingest.ts
npx tsx scripts/smoke-knowledge-identity.ts
npx tsx scripts/smoke-knowledge-fp.ts
npx tsx scripts/smoke-knowledge-read.ts
```

Vertical: extract → propose/accept → neighborhood → project → ingest → identity → FP → **read**.

CLI (from `packages/orchestrator`):

```bash
npx tsx src/index.ts --knowledge proposals
npx tsx src/index.ts --knowledge accept <proposalId>
npx tsx src/index.ts --knowledge neighborhood <nodeId>
npx tsx src/index.ts --knowledge extract --text "Copper losses produce heat that limits continuous torque."
npx tsx src/index.ts --knowledge ensure-project label=aktuator-v2
npx tsx src/index.ts --knowledge link nodeId=... projectId=...
npx tsx src/index.ts --knowledge project-status label=aktuator-v2
npx tsx src/index.ts --knowledge ingest --text "..."
npx tsx src/index.ts --knowledge ingest --file notes.md projectLabel=aktuator-v2
npx tsx src/index.ts --knowledge add-alias aliasLabel=... canonicalNodeId=...
npx tsx src/index.ts --knowledge merge fromId=... intoId=...
npx tsx src/index.ts --knowledge contradictions
npx tsx src/index.ts --knowledge mark-contradiction fromId=... toId=...
npx tsx src/index.ts --knowledge supersede oldClaimId=... newClaimId=...
npx tsx src/index.ts --knowledge fp --topic "continuous torque" projectLabel=aktuator-v2
npx tsx src/index.ts --json --knowledge find label=heat
npx tsx src/index.ts --json --knowledge neighborhood <nodeId>
npx tsx src/index.ts --knowledge find label=heat --table
```

Read library: `createKnowledgeReader(store)`, renderers in `@workflows/knowledge`.

Optional HTTP (integration server):

```bash
# KNOWLEDGE_HTTP_READ=true INTEGRATION_HTTP_PORT=8787 npm run serve
# GET /v1/knowledge/search?label=heat
# GET /knowledge  (minimal HTML browse)
```

Env: `KNOWLEDGE_DB_PATH`, `KNOWLEDGE_HTTP_READ`, plus M11–M16 flags (see AGENTS-M17.md).

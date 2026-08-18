# Knowledge Infrastructure v2

`packages/knowledge` owns knowledge-domain behavior and storage-independent
contracts. PostgreSQL/PostGIS is the sole canonical knowledge runtime.

## Invariants

- Models and extraction produce proposals; permanent truth requires acceptance.
- Preserve provenance, evidence, workspace/context, temporal state,
  contradiction and supersession history.
- Durable experience records are authoritative for raw experienced content.
  Knowledge events reference their stable IDs and must not copy that payload;
  `source_content` is only a fallback when no durable experience IDs exist.
- Every independently referable object can receive one stable canonical UUID.
- Labels, workspace, source, observation frequency and semantic similarity are
  resolution signals, never identity keys.
- Identity is the referent; provenance is event/source encounter history;
  context is participation in relationships, projects, time and space.
- Mentions/observations are occurrences, distinct from qualified
  supports/contradicts/test evidence. Both may target every canonical type.
- Reuse requires an explicit canonical ID, explicit alias, or an unambiguous
  resolution decision. Preserve ambiguity instead of silently collapsing IDs.
- Representation gaps reuse knowledge events/proposals: the proposal ID is the
  stable gap ID, its event retains experience lineage, and resolution appends a
  contextual canonical reference without merging identities. Semantic
  candidates alone can never resolve a gap.
- Explicit merge is transactional, retains the retired identity as history and
  may only clean conflicts created by that merge. Never perform global graph
  cleanup as a side effect.
- One canonical identity can participate in multiple projects/workspaces through
  relationships; context does not manufacture identity.
- The current node types are an initial ontology, not a closed identity universe.
- Accepted canonical writes append projection-outbox work in the same
  transaction. Graph/vector backends remain reconstructable and non-canonical.
- Background cognition is knowledge-owned, persisted-state-driven, idempotent,
  and finite-pass. Its narrow work ledger stores references/status only; raw
  content remains in durable experiences and projection work remains in the
  projection outbox. Idle passes must not scan all experience or canonical state.
- Background reconsideration may resolve from strong evidence or persist one
  bounded escalation. It must not auto-promote semantic truth, repeatedly prompt
  a human, or launch recursive/model-driven cognition.
- Knowledge diagnostics are optional, reference-only, and emitted only after a
  canonical change commits. Sink failure must never affect PostgreSQL truth,
  projection work, or proposal lifecycle.
- Semantic search runs in PostgreSQL/pgvector against a declared model/version;
  returned candidates never establish or merge canonical identity.
- Embedding generation stays behind an explicit provider. Never invent vectors
  or let projection failure invalidate a canonical transaction.
- Neo4j is derived topology only. Preserve canonical node/edge UUIDs, exact
  direction/relation values, accepted-only visibility and valid self-relations.
- Run expansion/path logic in Cypher. Graph proximity never establishes
  identity, and graph failure never participates in a canonical transaction.
- Hybrid retrieval must canonical-hydrate every graph/vector candidate, report
  strategy degradation, enforce hard context bounds and never widen a failed
  requested scope silently. Keep agent planning outside this service.
- Knowledge Agent models receive only controlled, allowlisted domain tools.
  Navigator is read-only; Curator creates pending proposals but cannot accept,
  merge, supersede or arbitrate truth directly. Every run is bounded and emits
  privacy-preserving structured audit metadata.
- Keep PostgreSQL-specific code inside adapters and the orchestrator thin.
- Expose controlled domain/tools contracts, not unrestricted SQL access.

## Runtime and tests

- Schema changes use ordered files under `packages/knowledge/migrations`.
- `createKnowledgeStore()` always creates the PostgreSQL canonical repository.
- Knowledge integration/smoke tests use isolated PostgreSQL databases.
- Every `createKnowledgePostgresPool` attaches a non-fatal idle `error`
  listener. Close work pools with `endKnowledgePostgresPool` before
  `DROP DATABASE` / `pg_terminate_backend`. Expected admin-shutdown codes
  (`57P01` and related closed-connection states) must not crash Node during
  intentional teardown. Query failures during active work still reject.
- Do not add SQLite knowledge runtime, importer or cutover compatibility code.
- SQLite in memory/embeddings is separately owned and must not be removed here.
- Use fake data only in public tests; private knowledge stays in the configured
  PostgreSQL instance.

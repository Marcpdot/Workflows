# @workflows/knowledge

Semantic knowledge model shell (M11–M17): graph, ingest, identity, first-principles, **read surface**.

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

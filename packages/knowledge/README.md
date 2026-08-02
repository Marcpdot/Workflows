# @workflows/knowledge

Semantic knowledge model shell (M11–M14): concepts, claims, edges, proposals, neighborhood, project/workspace binding, batch ingest.

```bash
cd packages/knowledge
npm install

cd ../orchestrator
npx tsx scripts/smoke-knowledge.ts
npx tsx scripts/smoke-knowledge-tools.ts
npx tsx scripts/smoke-knowledge-projects.ts
npx tsx scripts/smoke-knowledge-ingest.ts
```

Vertical: fixture extraction → proposals → accept/reject → neighborhood → ensure project → link → status → ingest (proposals only).

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
```

Env: `KNOWLEDGE_DB_PATH`, `PERSONAL_CONTEXT_DIR`, `KNOWLEDGE_DEFAULT_WORKSPACE_ID`,
`KNOWLEDGE_TOOLS_ENABLED`, `KNOWLEDGE_INJECT_ENABLED`,
`KNOWLEDGE_INGEST_AUTO_ON_CHAT`, `KNOWLEDGE_INGEST_MIN_CHARS` (see AGENTS-M14.md).

# @workflows/knowledge

Semantic knowledge model shell (M11–M15): concepts, claims, edges, proposals, neighborhood, project binding, batch ingest, identity/merge/contradictions.

```bash
cd packages/knowledge
npm install

cd ../orchestrator
npx tsx scripts/smoke-knowledge.ts
npx tsx scripts/smoke-knowledge-tools.ts
npx tsx scripts/smoke-knowledge-projects.ts
npx tsx scripts/smoke-knowledge-ingest.ts
npx tsx scripts/smoke-knowledge-identity.ts
```

Vertical: extract → propose/accept → neighborhood → project bind → ingest → alias/merge/contradict.

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
```

Env: `KNOWLEDGE_DB_PATH`, `PERSONAL_CONTEXT_DIR`, `KNOWLEDGE_DEFAULT_WORKSPACE_ID`,
`KNOWLEDGE_TOOLS_ENABLED`, `KNOWLEDGE_INJECT_ENABLED`,
`KNOWLEDGE_INGEST_AUTO_ON_CHAT`, `KNOWLEDGE_INGEST_MIN_CHARS` (see AGENTS-M14/M15.md).

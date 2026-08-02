# @workflows/knowledge

Semantic knowledge model shell (Milestone 11): concepts, claims, edges, proposals, neighborhood query.

```bash
cd packages/knowledge
npm install

cd ../orchestrator
npx tsx scripts/smoke-knowledge.ts
```

Vertical: fixture extraction → proposals → accept/reject → neighborhood.

CLI (from `packages/orchestrator`):

```bash
npx tsx src/index.ts --knowledge proposals
npx tsx src/index.ts --knowledge accept <proposalId>
npx tsx src/index.ts --knowledge neighborhood <nodeId>
npx tsx src/index.ts --knowledge extract --text "Copper losses produce heat that limits continuous torque."
```

Env: `KNOWLEDGE_DB_PATH` or `PERSONAL_CONTEXT_DIR` (see AGENTS.md).

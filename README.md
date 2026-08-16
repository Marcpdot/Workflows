[![Keep the Why](https://keepthewhy.com/assets/badge.svg)](https://keepthewhy.com)

# Workflows

Workflows is a local-first cognitive systems stack for orchestrating models,
tools, memory, structured knowledge, and bounded agents.

## Current architecture

```text
CLI / HTTP / Voice / Agents
            |
            v
  thin handle() compatibility boundary
            |
            v
 durable input experience
   -> operation-local selective activation
   -> capability-owned retrieval / tools / models / deterministic work
   -> durable outputs
   -> pending semantic proposals with lineage
            |
            v
 persistent experience + canonical knowledge continuity
```

Capabilities contribute only when the operation needs them; no project/task is
required. PostgreSQL-backed knowledge and durable experience survive model
replacement. Unresolved referents use contextual representation acquisition,
and knowledge-owned finite background passes consolidate/reconcile pending state
without a scheduler-brain. Structured observability records IDs, decisions,
budgets, outcomes, and lineage—not private full content by default.

The knowledge layer keeps structured and spatial truth canonical while treating
topology and semantic indexes as derived projections:

```text
Knowledge Agent (bounded, tool-driven)
     |
     v
Hybrid Retrieval
     |
     +-- PostgreSQL/PostGIS -- canonical structured/spatial truth
     +-- Neo4j             -- rebuildable topology projection
     `-- pgvector          -- rebuildable semantic projection
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the high-level system shape and
[context/knowledge.md](context/knowledge.md) for the knowledge invariants and
design rationale.

## Start here

Run the orchestrator:

```bash
cd packages/orchestrator
npm install
npm run dev -- "your prompt"
npx tsx src/index.ts --json --route-only "Oppsummer denne teksten kort"
```

See [packages/orchestrator/README.md](packages/orchestrator/README.md) for CLI,
HTTP, and UI usage.

### Knowledge infrastructure

From the repository root, start the local knowledge services and apply the
canonical PostgreSQL/PostGIS migrations:

```bash
docker compose -f compose.knowledge.yml up -d
cd packages/orchestrator
npm run knowledge:migrate
```

From `packages/orchestrator`, run the bounded Knowledge Agent with
`npm run knowledge:agent -- navigator "goal"` (or `curator`) and process derived
projection work with `npm run knowledge:projections -- incremental`. See
[packages/knowledge/README.md](packages/knowledge/README.md) for setup,
configuration, rebuilds, and verification commands.

Run the complete operational Continuous Cognition regression/evaluation suite:

```bash
cd packages/orchestrator
npm run test:cc
```

## Folder map

```text
Workflows/
  README.md                 # this file
  ARCHITECTURE.md           # high-level system shape
  context/                  # durable decisions and rationale
  packages/
    orchestrator/           # thin wiring: router, handle(), CLI, UI, HTTP
    knowledge/              # canonical domain, PostgreSQL/PostGIS runtime,
                            # graph/vector projections, hybrid retrieval, agent
    memory/                 # short-term and long-term memory
    models/                 # local and remote model clients
    tools/                  # registry, built-ins, path safety, tool loop
    retrieval/              # memory retrieval strategies
    embeddings/             # embedding and vector-store abstractions
    compression/            # realtime history compression
    eval/                   # cases, assertions, cost, suite runner
    policy/                 # compute budgets and tiers
    workspace/              # session namespace and project context
    structured/             # structured completion and JSON helpers
    observability/          # JSONL events
    proactive/              # next-step suggestions
    agents/                 # bounded agent workflows
    voice/                  # optional speech I/O over the same orchestrator
```

| Question | Look in |
|----------|---------|
| Where do I run chat/CLI? | `packages/orchestrator` |
| Where is memory? | `packages/memory` |
| Where is structured knowledge? | `packages/knowledge` |
| Where are tools? | `packages/tools` |
| Why was X decided? | `context/index.md` |

## Docs

- **System architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Documentation index:** [context/index.md](context/index.md)
- **Knowledge design rationale:** [context/knowledge.md](context/knowledge.md)
- **Orchestrator usage:** [packages/orchestrator/README.md](packages/orchestrator/README.md)
- **Knowledge infrastructure:** [packages/knowledge/README.md](packages/knowledge/README.md)

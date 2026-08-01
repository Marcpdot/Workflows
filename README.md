[![Keep the Why](https://keepthewhy.com/assets/badge.svg)](https://keepthewhy.com)

# Workflows

Personal multi-model orchestration stack: local models (Ollama) and frontier
(Grok), with routing, tools, memory, and evaluation over time.

## Start here

```bash
cd packages/orchestrator
npm install
npm run dev -- "your prompt"
npx tsx src/index.ts --json --route-only "Oppsummer denne teksten kort"
```

**Runnable glue:** [`packages/orchestrator`](packages/orchestrator/README.md)

## Folder map

```text
Workflows/
  README.md                 # this file
  ARCHITECTURE.md           # high-level system shape
  context/                  # Keep the Why (decision rationale)
  docs/
    PACKAGE_REFACTOR.md     # packaging plan (A–F)
  packages/
    orchestrator/           # thin glue: router, handle(), CLI, UI, HTTP
    memory/                 # short-term + long-term SQLite
    models/                 # Ollama CLI + Grok/mid clients
    tools/                  # registry, builtins, path safety, tool loop
    retrieval/              # keyword (+ semantic when embeddings on)
    embeddings/             # embedder + vector store
    compression/            # realtime history compression
    eval/                   # cases, assertions, cost, suite runner
    policy/                 # compute budgets / tiers
    workspace/              # session namespace + project context
    structured/             # completeStructured + JSON helpers
    observability/          # JSONL events
    proactive/              # next-step suggestions
    agents/                 # sequential multi-role pipeline
```

| Question | Look in |
|----------|---------|
| Where do I run chat/CLI? | `packages/orchestrator` |
| Where is memory? | `packages/memory` |
| Where are tools? | `packages/tools` |
| Why was X decided? | `context/index.md` |

## Docs

- **Architecture & milestones:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Orchestrator usage:** [packages/orchestrator/README.md](packages/orchestrator/README.md)
- **Why decisions were made:** [context/index.md](context/index.md)
- **Package refactor plan:** [docs/PACKAGE_REFACTOR.md](docs/PACKAGE_REFACTOR.md)

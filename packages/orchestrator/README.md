# @workflows/orchestrator

Thin glue package for the Workflows stack: routing, `handle()`, CLI, UI/HTTP entrypoints.
Layer implementations live under sibling `packages/*` folders.

## Start here

```bash
cd packages/orchestrator
npm install
npm run dev -- "your prompt"
# or
npx tsx src/index.ts --json --route-only "Oppsummer denne teksten kort"
npm run serve   # HTTP integration
npm run ui      # localhost web shell
```

## Layout (this package)

| Path | Role |
|------|------|
| `src/router.ts` | Task type / complexity rules |
| `src/orchestrator.ts` | Wire layers: policy → route → retrieve → compress → model/tools |
| `src/index.ts` | CLI entry |
| `src/types.ts` | Shared orchestrator result/config types |
| `src/integration/` | Thin HTTP (imports brain; stays with glue) |
| `src/ui/` | Localhost static web shell |
| `scripts/` | Offline smokes + eval CLI |

## Layer packages (siblings)

See repo root [README.md](../../README.md) for the full folder map (`packages/memory`, `packages/tools`, …).

## Knowledge (M11 shell)

```bash
npx tsx scripts/smoke-knowledge.ts
npx tsx src/index.ts --knowledge extract --text "..."
npx tsx src/index.ts --knowledge proposals
npx tsx src/index.ts --knowledge accept <id>
npx tsx src/index.ts --knowledge neighborhood <nodeId>
```

See `packages/knowledge` and `context/knowledge.md`.

## Env

Copy `.env.example` to `.env` and set `XAI_API_KEY` / `OLLAMA_*` as needed.

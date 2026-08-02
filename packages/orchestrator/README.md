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

## Knowledge (M11–M12 shell)

```bash
npx tsx scripts/smoke-knowledge.ts
npx tsx scripts/smoke-knowledge-tools.ts
npx tsx src/index.ts --knowledge extract --text "..."
npx tsx src/index.ts --knowledge proposals
npx tsx src/index.ts --knowledge accept <id>
npx tsx src/index.ts --knowledge neighborhood <nodeId>
npx tsx src/index.ts --knowledge ensure-project label=aktuator-v2
npx tsx src/index.ts --knowledge link nodeId=... projectId=...
npx tsx src/index.ts --knowledge project-status label=aktuator-v2
npx tsx src/index.ts --knowledge ingest --text "Copper losses produce heat..."
npx tsx src/index.ts --knowledge ingest --file notes.md
npx tsx scripts/smoke-knowledge-projects.ts
npx tsx scripts/smoke-knowledge-ingest.ts
npx tsx scripts/smoke-knowledge-identity.ts
npx tsx scripts/smoke-knowledge-fp.ts
npx tsx scripts/smoke-knowledge-read.ts
npx tsx scripts/smoke-voice.ts
npx tsx src/index.ts --knowledge merge fromId=... intoId=...
npx tsx src/index.ts --knowledge contradictions
npx tsx src/index.ts --knowledge fp --topic "continuous torque"
npx tsx src/index.ts --json --knowledge find label=heat
# Knowledge HTTP read (optional):
# KNOWLEDGE_HTTP_READ=true npm run serve
# open http://127.0.0.1:8787/knowledge
# Voice I/O (M18 optional; mock STT, TTS off by default):
# npx tsx src/index.ts --voice-once --transcript "What limits continuous torque?" --voice-silent
# Local Whisper-class: VOICE_STT_PROVIDER=local VOICE_STT_COMMAND='whisper-cli -f {input} -nt'

# Tool loop (models can call knowledge_* tools):
# TOOLS_ENABLED=true KNOWLEDGE_TOOLS_ENABLED=true npm run dev -- "..."
# Optional context inject (default off; prefers project status when label matches):
# KNOWLEDGE_INJECT_ENABLED=true
# KNOWLEDGE_DEFAULT_WORKSPACE_ID=  # else active workspace id from --workspace
# Optional auto chat→proposals only (never accept):
# KNOWLEDGE_INGEST_AUTO_ON_CHAT=true
```

See `packages/knowledge`, `packages/voice`, and `context/knowledge.md`.

## Env

Copy `.env.example` to `.env` and set `XAI_API_KEY` / `OLLAMA_*` as needed.

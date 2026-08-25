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
npm run ui      # localhost web shell (M6)
# Work surface client: packages/surface (HTTP to 127.0.0.1:8787)
```

## Layout (this package)

| Path | Role |
|------|------|
| `src/router.ts` | Task type / complexity rules |
| `src/capabilityActivation.ts` | Operation-local WHAT/HOW/HOW MUCH decisions and trace |
| `src/capabilityContributors.ts` | Small adapters for package-owned capability results |
| `src/cognitiveObservability.ts` | Privacy-safe diagnostic projections; never truth state |
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
npx tsx src/index.ts --knowledge ingest --dir work
npx tsx src/index.ts --knowledge jobs
npx tsx src/index.ts --knowledge accept-job <jobId>
npx tsx src/index.ts --knowledge chunks query="copper"
npx tsx scripts/smoke-knowledge-projects.ts
npx tsx scripts/smoke-knowledge-ingest.ts
npx tsx scripts/smoke-knowledge-identity.ts
npx tsx scripts/smoke-knowledge-fp.ts
npx tsx scripts/smoke-knowledge-read.ts
npm run test:voice
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
# Hardware-free deterministic runtime suite (the command CI runs):
# npm run test:voice
# Optional real microphone smoke; never run by CI:
# VOICE_MIC_CAPTURE_COMMAND='arecord -d 4 -f S16_LE -r 16000 -c 1 {output}' \
# VOICE_STT_COMMAND='whisper-cli -f {input} -nt' \
# npm run test:voice:microphone -- --show-transcript
# Live raw-PCM microphone runtime; no complete recording file (manual, never CI):
# VOICE_ENABLED=true \
# VOICE_MIC_STREAM_COMMAND='arecord -q -t raw -f S16_LE -r 16000 -c 1' \
# VOICE_STT_COMMAND='whisper-cli -f {input} -nt' \
# npm run voice:live
# PTT: VOICE_ENGAGEMENT_MODE=push_to_talk — Enter starts one window, Enter
# releases it; session stops after one committed input. Default mode listens
# continuously until Ctrl+C.
# This local fallback emits one final transcript per bounded VAD segment; it
# does not claim native partial-transcript support.

# Tool loop (models can call knowledge_* tools):
# TOOLS_ENABLED=true KNOWLEDGE_TOOLS_ENABLED=true npm run dev -- "..."
# Optional context inject (default off; prefers project status when label matches):
# KNOWLEDGE_INJECT_ENABLED=true
# KNOWLEDGE_DEFAULT_WORKSPACE_ID=  # else active workspace id from --workspace
# Optional auto chat → transform job (never accept):
# KNOWLEDGE_INGEST_AUTO_ON_CHAT=true
# Optional conversation extract (not the default write path):
# KNOWLEDGE_CAPTURE_ENABLED=true
```

## Interaction mode + capture

Conversation extract is **off by default**. Ingest files with `--knowledge ingest`
and accept transform jobs. Explicit `/capture` still works when capture is enabled.
Commands:

```bash
/mode active|neutral
/proposals on|off
/capture
/accept <proposalId>
/reject <proposalId>
```

Web UI (`npm run ui`): mode toggle + proposals panel. Design:
`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`.

```bash
npx tsx scripts/smoke-interaction-capture.ts
```

See `packages/knowledge`, `packages/voice`, and `context/knowledge.md`.

## Continuous Cognition evaluation

```bash
npm run test:cc                 # WP1-WP7 operational regression report
npm run test:cc:activation      # selective activation only
npm run test:cc:operational     # continuity/correction scenario
npm run test:cc:representation  # ambiguity/clarification/reuse
npm run test:cc:background      # finite background pass
npm run test:cc:observability   # privacy/reconstruction/model swap hooks
```

`test:cc` writes a JSON-compatible report under `data/eval-results/cc/`.

## Env

Copy `.env.example` to `.env` and set `XAI_API_KEY` / `OLLAMA_*` as needed.

# packages/models

Local Ollama CLI client + frontier/mid OpenAI-compatible (Grok) client.

**Step B** of `docs/PACKAGE_REFACTOR.md`: moved out of `Orchestrator/src/models`.

| Path | Role |
|------|------|
| `src/local.ts` | `OllamaCliClient` (`ollama run`) |
| `src/frontier.ts` | `GrokClient` (chat completions; mid uses same client) |
| `src/types.ts` | ModelClient / request-response shapes (no Orchestrator dep) |

Orchestrator depends on `file:../packages/models` as `@workflows/models`.

```bash
cd Orchestrator
npm install
npx tsc --noEmit
npx tsx src/index.ts --json --route-only "Oppsummer denne teksten kort"
```

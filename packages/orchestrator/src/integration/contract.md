# Orchestrator integration contract (Milestone 5)

Other projects/scripts call **in** without knowing internal modules.

```text
external repo / script
        ↓
  CLI  and/or  HTTP (127.0.0.1)
        ↓
  Orchestrator (single brain)
```

For the **work surface** client boundary (status, streaming chat, knowledge
maps, events, voice-turn, proposals), see **[surface-contract.md](./surface-contract.md)**.
That document is the target contract for a usable surface; this file remains
the baseline CLI + HTTP chat contract.

## CLI

```bash
cd path/to/Orchestrator   # or invoke via absolute path to index

npx tsx src/index.ts [options] "prompt"
npx tsx src/index.ts --json "prompt"
npx tsx src/index.ts --workspace /abs/path/to/project "prompt"
npx tsx src/index.ts --json --route-only "Oppsummer dette"
```

| Flag / env | Meaning |
|------------|---------|
| `--workspace` / `WORKSPACE_ROOT` | Tool path root (also accepts legacy `TOOL_WORKSPACE_ROOT`) |
| `--session` / `SESSION_ID` | Short-term history isolation |
| `--json` | **stdout is only JSON** (logs go to stderr) |
| `--route-only` | Routing decision only (no model call) |
| `--no-memory` | Do not load/save session history |
| exit `0` | Success |
| exit `1` | Error |

### JSON stdout (`--json`)

Parseable object. Chat form includes at least:

```json
{
  "reply": "…",
  "routing": { "model": "local", "reason": "…", "taskType": "…", "complexity": "…" },
  "model": "…",
  "provider": "local",
  "latencyMs": 123,
  "workspaceRoot": "/abs/path",
  "sessionId": "default"
}
```

Optional fields when features run: `usage`, `compression`, `retrieval`, `toolSteps`, `suggestions`.

`--route-only --json` prints the routing decision object only.

## HTTP (optional)

```bash
npm run serve
# INTEGRATION_HTTP_PORT=8787
# INTEGRATION_HTTP_TOKEN=secret   # optional; require Authorization: Bearer …
```

| Method | Path | Body / notes |
|--------|------|----------------|
| `GET` | `/health` | `{ "ok": true, "service": "orchestrator", "version": "…" }` |
| `POST` | `/v1/chat` | `{ "prompt", "sessionId?", "workspaceRoot?", "options?" }` → chat JSON |

Default bind: `127.0.0.1`.

Full surface-oriented routes (status, stream, knowledge, events, voice): [surface-contract.md](./surface-contract.md).

## Boundaries (M5)

| Concern | Binding |
|---------|---------|
| **Tools** (`read_file`, …) | Always `workspaceRoot` from call / `--workspace` |
| **Short-term session** | Namespaced `ws:<workspaceId>:<logical>` in shared `memory.db` (M9); `SESSION_NAMESPACE=false` for legacy |
| **Retrieval `context/`** | Prefers `{workspace}/context` when present; else `RETRIEVAL_CONTEXT_DIR` / default (M9) |
| **LTM** | Global/env path by default; `LONGTERM_PROJECT_SCOPED=true` for DB under workspace (M9) |

## Examples

See `examples/integration/curl-chat.sh` and `minimal-client.ts`.

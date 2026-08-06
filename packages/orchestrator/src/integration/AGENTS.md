# Milestone 5 — Integrasjonsflate ut

## Mål
Gjøre Workflows/Orchestrator **brukbar fra andre prosjekter og mapper** uten å måtte «stå inni Orchestrator og vite alt internt».

Stabil kontrakt ut:

```text
annet repo / script / tool
        ↓
  CLI og/eller tynn HTTP
        ↓
  Orchestrator (uendret hjerne)
```

## Prinsipper
1. **Samme hjerne** — ingen parallell orchestrator-logikk i API-laget
2. **Workspace-root er eksplisitt** — kallende prosjekt styrer hvilken mappe som er workspace
3. **Kontrakt først** — dokumentert CLI er minimum; HTTP er valgfritt men anbefalt i samme milestone hvis lite ekstra arbeid
4. **Ikke avhengig av M4** — fungerer med dagens keyword/LTM; embeddings er transparent når de finnes

## Scope
1. Dokumentert **CLI-kontrakt** (exit codes, stdout/JSON, env, cwd/workspace)
2. `WORKSPACE_ROOT` / `--workspace` som førsteklasses parameter for tools + relativ context
3. Valgfri **tynn HTTP-server** (`POST /v1/chat`, evt. `/v1/tool`, health)
4. Enkel klient-eksempel (curl + minimal TS) i `examples/integration/`
5. Smoke som verifiserer kontrakten (CLI JSON mode + evt. server)

## Utenfor scope
- Auth/OAuth (kan bli M12-aktig senere; local bind + optional token er nok)
- Multi-tenant cloud SaaS
- gRPC / WebSocket streaming (kan komme senere)
- Å skrive om hele CLI til ny framework

## CLI-kontrakt (minimum)

### Innvokering
```bash
# Fra Orchestrator-pakken, eller via global/npx path senere
npx tsx src/index.ts [options] "prompt"
npx tsx src/index.ts --json "prompt"
npx tsx src/index.ts --workspace /path/to/project "prompt"
```

### Viktige flagg / env
| Navn | Betydning |
|------|-----------|
| `--workspace` / `WORKSPACE_ROOT` | Absolutt path; tools og relativ fil-context binder hit |
| `--session` / `SESSION_ID` | Isoler short-term history |
| `--json` | Maskinlesbar stdout (OrchestratorResult-form) |
| `--route-only` | Kun routing-beslutning |
| exit `0` | OK |
| exit `1` | Feil / eval-fail stil |

### JSON-resultat (skisse)
```ts
{
  reply: string,
  routing: { model: string, reason?: string },
  model: string,
  provider: string,
  usage?: { … },
  latencyMs?: number,
  // eksisterende valgfrie felt: compression, retrieval, toolSteps, suggestions
}
```

Stderr kan ha menneske-logger; ved `--json` skal **stdout være kun JSON** (eller tydelig dokumentert delimiter — foretrekk pure JSON).

## HTTP (valgfritt men ønsket i M5)

```
POST /v1/chat
{
  "prompt": "…",
  "sessionId": "optional",
  "workspaceRoot": "/path",
  "options": { "toolsEnabled": false }
}
→ 200 + samme form som JSON CLI

GET /health → { ok: true, version?: string }
```

- Bind default `127.0.0.1`
- Env: `INTEGRATION_HTTP_PORT`, `INTEGRATION_HTTP_TOKEN` (hvis satt, krev header)
- Ingen tung framework-krav (Node `http` eller lett router)

## Workspace-grense

- Tools (`read_file`, …) skal bruke workspace root fra kall, ikke stille anta Orchestrator-cwd
- `context/` retrieval: documentér om den er relative til workspace, Orchestrator-repo, eller begge (anbefaling: configurable `RETRIEVAL_CONTEXT_DIR` forblir, workspace styrer tools)
- LTM path forblir global/per-env — ikke automatisk per-workspace i M5 (det er nærmere M9); dokumentér begrensningen

## Filer
```
src/integration/
  AGENTS.md
  contract.md       # menneskelig kontrakt (kan merges inn i README)
  httpServer.ts     # valgfri
  types.ts          # delte request/response-typer for JSON

examples/integration/
  curl-chat.sh
  minimal-client.ts

scripts/smoke-integration.ts
```

## Testing
1. `--json` produserer parsebar JSON med `reply`
2. `--workspace` påvirker tool path safety root (smoke med temp dir)
3. HTTP health + chat hvis server implementert
4. Uten server: CLI-kontrakt alene er nok til å merge M5 minimum

## Krav
- Ingen breaking change for interaktiv REPL-bruk
- Orchestrator-kjerne forblir source of truth
- Dokumenter i README under «Integration»

## Ferdig når
- Dokumentert CLI-kontrakt + `--workspace` + ren `--json` stdout
- Minst ett eksempel utenfor Orchestrator-mappa som kaller inn
- Smoke grønn
- (Stretch) lokal HTTP `/v1/chat` + `/health`

## Knowledge read (M17)

When `KNOWLEDGE_HTTP_READ=true`, the integration server also serves:

| Method | Path |
|--------|------|
| GET | `/v1/knowledge` (route index) |
| GET | `/v1/knowledge/node?id=` |
| GET | `/v1/knowledge/search?label=&type=&status=` |
| GET | `/v1/knowledge/neighborhood?nodeId=&hops=` |
| GET | `/v1/knowledge/subgraph?rootId=|nodeIds=&hops=&limit=` |
| GET | `/v1/knowledge/project-status?label=` |
| GET | `/v1/knowledge/contradictions` |
| GET | `/v1/knowledge/proposals?status=` |
| GET | `/knowledge` (minimal HTML browse; no framework) |

Same `INTEGRATION_HTTP_TOKEN` bearer gate as other `/v1/*` routes.

# @workflows/surface

Work surface: a **localhost HTTP client** of the orchestrator integration server.
It is not a second brain and not the M6 chat shell.

```text
browser 127.0.0.1:5173
        │
        │  GET /health, GET /v1/status, GET /v1/events
        │  POST /v1/chat (SSE)  GET /v1/knowledge/*  POST …/accept|reject
        ▼
orchestrator  http://127.0.0.1:8787
        ▼
handle() · knowledge · memory
```

One persistent room. Search pulls objects onto a stage; work goes through
`POST /v1/chat` with `sessionId=surface-main` and optional `focus` from the
selected object. Voice HTTP (`POST /v1/voice/turn`) is not implemented here
until that API exists.

## Prerequisites

1. Knowledge infrastructure (for maps / proposals):

   ```bash
   docker compose -f compose.knowledge.yml up -d
   ```

   From `packages/orchestrator`, migrate if needed: `npm run knowledge:migrate`.

2. Integration server **must** be up, with knowledge read on:

   ```bash
   cd packages/orchestrator
   set KNOWLEDGE_HTTP_READ=true
   npm run serve
   ```

   Linux/macOS: `KNOWLEDGE_HTTP_READ=true npm run serve`

   Default bind is `127.0.0.1:8787`. If `INTEGRATION_HTTP_TOKEN` is set, put the
   same value in `localStorage.INTEGRATION_HTTP_TOKEN` or
   `VITE_INTEGRATION_HTTP_TOKEN`.

## Run the surface

```bash
cd packages/surface
npm install
npm run dev
```

Open http://127.0.0.1:5173

Override the orchestrator URL with `VITE_ORCHESTRATOR_URL` (default
`http://127.0.0.1:8787`). An empty value uses the Vite proxy to the same host.
The integration server allows CORS from `127.0.0.1` / `localhost` so the
browser can call `:8787` directly.

## Wake (compose + serve + surface)

From this package:

```bash
npm run awake
```

That starts knowledge compose, `npm run serve` with `KNOWLEDGE_HTTP_READ=true`,
then the Vite dev server. Stop with Ctrl+C.

## Boot sequence

1. `GET /health`
2. `GET /v1/status` → presence chrome (knowledge, model, voice, busy, degraded)
3. Subscribe `GET /v1/events`
4. Work: `POST /v1/chat` with `stream: true`
5. Knowledge search / node / neighborhood into the object stage
6. Proposals: `GET /v1/knowledge/proposals?sessionId=` then
   `POST /v1/knowledge/proposals/:id/accept|reject`

## Layout

| Region | Role |
|--------|------|
| Presence strip | System here / degraded / busy, knowledge, models, voice |
| Find | Search accepted objects; click to stage |
| On stage | Selected object + neighborhood + latest work result |
| Proposals | Session pending queue; explicit accept/reject |
| Work | Intent input; not a chat transcript product |

## Out of scope

- Command Center redesign
- `POST /v1/voice/turn`
- Importing `@workflows/orchestrator` or running `handle()` in the browser

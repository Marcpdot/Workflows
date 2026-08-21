# Work surface ↔ orchestrator contract

Stable HTTP boundary for the **work surface** (and any other first-class client).
The surface is a client, not a second brain. All cognition, knowledge writes,
policy, and durable experiences stay in the orchestrator / capability packages.

This document extends [contract.md](./contract.md) (Milestone 5 CLI/HTTP).
It states what a **usable** surface requires — not a minimal chat demo.

```text
Work surface (UI)
      │
      │  HTTP 127.0.0.1 (optional Bearer token)
      ▼
Orchestrator integration server  →  handle() / knowledge read / status
      │
      ▼
knowledge · memory · models · tools · voice · experiences
```

Default bind: `127.0.0.1`. Port: `INTEGRATION_HTTP_PORT` (default `8787`).
Auth: if `INTEGRATION_HTTP_TOKEN` is set, require `Authorization: Bearer <token>`.

---

## Design invariants

1. **Same brain** — surface never reimplements routing, CC, or knowledge rules.
2. **Same durable path** — text, surface actions, and voice land in the same experience / knowledge pipeline.
3. **Objects have ids** — knowledge nodes, proposals, workspaces are referenced by stable ids, not only free text in the UI.
4. **One persistent room** — the surface pulls objects in; it does not own exclusive "scenes" as separate system worlds.
5. **System presence first** — health/status is enough for the surface to show whether the system is live, degraded, or busy.
6. **Out of band secrets** — API keys and model credentials stay in server `.env`, never in the surface.

---

## Implementation status legend

| Tag | Meaning |
|-----|--------|
| **LIVE** | Implemented in current integration server |
| **PLANNED** | Required for usable surface; implement in orchestrator integration before or with surface UI |

---

## 1. Presence

### `GET /health` — LIVE

Liveness only.

```json
{ "ok": true, "service": "orchestrator", "version": "optional" }
```

### `GET /v1/status` — LIVE

Rich presence for the surface shell ("system is here"). Best-effort probes;
failures set `degraded` and stay HTTP 200. Not a central controller; the
surface does not probe Docker itself.

```json
{
  "ok": true,
  "service": "orchestrator",
  "version": "optional",
  "busy": false,
  "degraded": false,
  "knowledge": { "configured": true, "ok": true, "backend": "postgresql", "detail": "optional" },
  "model": {
    "local": { "ok": true, "bin": "ollama", "model": "llama3.1:8b" },
    "frontier": { "configured": false, "model": "grok-3" },
    "mid": { "configured": false }
  },
  "voice": {
    "enabled": false,
    "sttProvider": "mock",
    "ttsProvider": "off",
    "allowRemoteAudio": false,
    "language": "en"
  }
}
```

---

## 2. Work (intent)

### `POST /v1/chat` — LIVE

Full turn through `handle()`.

**Request**

```json
{
  "prompt": "string (required)",
  "sessionId": "string (optional, default from env/server)",
  "workspaceRoot": "absolute path (optional)",
  "focus": {
    "knowledgeId": "string (optional, alias for a seed node id)",
    "nodeIds": ["optional canonical ids"],
    "labels": ["optional"],
    "projectId": "string (optional)",
    "projectLabel": "string (optional)",
    "workspaceId": "string (optional)",
    "hops": 1
  },
  "stream": false,
  "options": {
    "toolsEnabled": false,
    "forceModel": "local | frontier",
    "noMemory": false
  }
}
```

- `focus` is an attention hint for knowledge retrieval. Existing clients that omit it keep prompt-based selection.
- Prefer a stable surface session id (e.g. `surface-main`) for continuity.

**Response** — same machine-readable chat shape as CLI `--json` / `IntegrationChatResponse`:

```json
{
  "reply": "…",
  "routing": { "model": "…", "reason": "…", "taskType": "…", "complexity": "…" },
  "model": "…",
  "provider": "local | frontier | …",
  "latencyMs": 0,
  "sessionId": "…",
  "logicalSessionId": "…",
  "workspaceRoot": "…",
  "workspaceId": "…"
}
```

Optional fields when features run: `usage`, `compression`, `retrieval`, `toolSteps`, `suggestions`, knowledge capture metadata.

### `POST /v1/chat` with streaming — LIVE

Same request semantics as `/v1/chat`. Enable with `stream: true` or
`Accept: text/event-stream`.

- Events: `token` | `status` | `done` | `error`.
- Final `done` payload is the non-streaming chat response.
- `ModelClient.complete()` is still one-shot; `token` is currently emitted after `handle()` returns. `done` is authoritative.

Surface must not block the whole room on a single turn; streaming is part of usable latency, not a luxury.

---

## 3. Knowledge read

Enable with `KNOWLEDGE_HTTP_READ=true`. Same bearer gate as other `/v1/*` routes.

| Method | Path | Status | Role |
|--------|------|--------|------|
| `GET` | `/v1/knowledge` | LIVE | Route index |
| `GET` | `/v1/knowledge/node?id=` | LIVE | Single object |
| `GET` | `/v1/knowledge/search?label=&type=&status=` | LIVE | Find objects |
| `GET` | `/v1/knowledge/neighborhood?nodeId=&hops=` | LIVE | Local graph around focus |
| `GET` | `/v1/knowledge/subgraph?rootId=\|nodeIds=&hops=&limit=` | LIVE | Wider projection for maps |
| `GET` | `/v1/knowledge/project-status?label=` | LIVE | Project / subject status |
| `GET` | `/v1/knowledge/contradictions` | LIVE | Conflicts |
| `GET` | `/v1/knowledge/proposals?status=` | LIVE | Pending proposals |
| `GET` | `/knowledge` | LIVE | Minimal HTML browse (debug) |

Surface uses these to **pull objects into the room** without a full model turn.

---

## 4. Knowledge / continuity actions

Writes stay owned by the system. Surface triggers them; it does not write Postgres/Neo4j itself.

| Action | Contract target | Status |
|--------|-----------------|--------|
| Accept proposal | `POST /v1/knowledge/proposals/:id/accept` | LIVE |
| Reject proposal | `POST /v1/knowledge/proposals/:id/reject` | LIVE |
| Explicit capture / ingest | `POST /v1/knowledge/ingest` `{ text \| refs }` or documented tool/chat path | PLANNED as explicit API or single documented path |

Accept/reject are thin wraps of `store.acceptProposal` / `store.rejectProposal` (optional `{ edits }` on accept). They do not auto-accept.

---

## 5. Session / workspace

| Mechanism | Status | Role |
|-----------|--------|------|
| `sessionId` on chat | LIVE | Short-term continuity |
| `workspaceRoot` on chat | LIVE | Tool + workspace binding |
| Namespaced sessions `ws:<workspaceId>:<logical>` | LIVE (M9) | Isolation |
| `GET /v1/session?sessionId=` | LIVE | Metadata only (`exists`, `historyCount`, mode/flags). No transcript dump. |

Recommended surface default: `sessionId=surface-main` unless the user switches room context intentionally.

---

## 6. Events (system → surface)

### `GET /v1/events` — LIVE

SSE stream so the surface does not poll. In-process observations from chat and
proposal HTTP paths; no durable event log. Heartbeat is an SSE comment.

**Event types (minimum)**

| Type | When |
|------|------|
| `presence` | first event on subscribe |
| `turn.started` | chat/voice turn begins |
| `turn.progress` | optional status line (**PLANNED**) |
| `turn.completed` | turn finished (session / latency) |
| `turn.failed` | chat handler threw |
| `proposal.created` | new pending proposal from a chat result |
| `degraded` | capability lost (from `handle()` activation) |
| `error` | recoverable client-visible error |

Surface subscribes on boot after `GET /health` succeeds.

---

## 7. Voice

Voice is a capability on the **same** durable path as text.

### `POST /v1/voice/turn` — PLANNED

```json
{
  "sessionId": "surface-main",
  "workspaceRoot": "optional",
  "focus": { },
  "audio": { "encoding": "pcm_s16le", "sampleRate": 16000, "channels": 1 },
  "transcript": "optional if STT already done",
  "options": { }
}
```

Or chunked upload / streaming variant later. Response aligns with chat result (`reply`, routing, session) plus voice-specific metadata (provider, barge-in, cancelled).

Until this exists: local `voice:live` / scripts remain valid for host testing; surface should still be designed against this contract so UI does not assume a separate voice brain.

Env (existing direction): `VOICE_ENABLED`, `VOICE_LANGUAGE`, STT/TTS providers and commands — server-side only.

---

## 8. Error shape

All failing JSON endpoints SHOULD use:

```json
{ "ok": false, "error": "machine_or_human_readable_message" }
```

HTTP status codes: `400` validation, `401` auth, `404` missing object, `503` dependency down, `500` unexpected.

---

## 9. Wake path (host)

Not an HTTP route. Host-side entry that brings the system up before the surface attaches:

```text
1. knowledge docker compose up
2. orchestrator `npm run serve` (KNOWLEDGE_HTTP_READ=true when surface needs maps)
3. start surface client → GET /health → GET /v1/status → subscribe /v1/events
```

One user-facing command (e.g. `workflows-awake`) should orchestrate this.

---

## 10. Non-goals on this boundary

- Exposing raw SQL / Neo4j / internal CC graphs
- Moving policy or model selection into the surface
- Multi-tenant cloud auth (local bind + optional token is enough)
- Replacing Linux as OS; surface runs *on* the host and talks *to* Workflows
- Command Center UI in the integration server (surface remains an HTTP client)

---

## 11. Client checklist (usable surface)

On start:

1. `GET /health`
2. `GET /v1/status` (when LIVE)
3. Subscribe `GET /v1/events` (when LIVE)

While working:

4. `POST /v1/chat` (stream when LIVE) with stable `sessionId` and optional `focus`
5. Knowledge GETs to pull objects into the room
6. Proposal accept/reject via explicit routes when LIVE

Voice when host audio is ready:

7. `POST /v1/voice/turn` (or streaming equivalent)

---

## 12. Relation to existing files

| File | Role |
|------|------|
| [contract.md](./contract.md) | Original M5 CLI + basic HTTP |
| [types.ts](./types.ts) | Shared TS request/response types — extend as PLANNED fields land |
| [httpServer.ts](./httpServer.ts) | Implementation of LIVE routes |
| [AGENTS.md](./AGENTS.md) | Agent rules for integration package |

When implementing PLANNED items: update this doc status tags, `types.ts`, and `contract.md` summary in the same change when practical.

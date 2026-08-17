# Interface

## CLI remains the default automation surface

**Status:** active  
**Evidence:** confirmed  
**Source:** M5/M6 specs and README; commit `86c49f6`; run from `packages/orchestrator`  

Scripts, eval, and CI use CLI (`tsx src/index.ts`, pure `--json` stdout, `--workspace`, `--session`, `--list-sessions`). The web UI is optional human shell.

**Reason:** Automation and agents need stable stdout/exit codes. UI can change without breaking pipelines.

See [integration.md](integration.md) for the external call-in contract and [workspace.md](workspace.md) for session/workspace isolation.

## Milestone 6 chose simple localhost web over TUI

**Status:** active  
**Evidence:** confirmed  
**Source:** M6 implementation `b695dd8`; `npm run ui`  

Primary human shell is a **minimal static web UI** on the same origin as M5 `POST /v1/chat` (not a separate SPA framework, not a terminal TUI).

**Reason:** One HTTP server already existed from integration surface; web shell reuses it with low dependency cost and shows route/model/latency metadata. TUI would be a second interaction stack.

**Rejected alternatives:**

- **TUI as M6 primary** — fine for terminal-native users, but weaker reuse of M5 HTTP and harder smoke without extra harness.
- **Full product web app (React, auth, design system)** — noise before the brain and workflows are proven; UI is a shell, not the product.

## Voice is optional I/O (M18), not a second UI product

**Status:** active  
**Evidence:** confirmed  
**Source:** M18 shell `6f11d1f`; PR #34; `@workflows/voice`; CLI `--voice-once`, `voice:live`, REPL `/voice`
**Revisit when:** local STT is daily-driven or ambient wake is required

Live speech is represented as timestamped audio frames, VAD activity, and provisional transcript events. Only an engaged, endpointed final transcript enters the same orchestrator path as typed chat. Partial work stays reversible and non-durable. Output is incrementally playable and cancellable while microphone perception continues; correlated recent self-audio does not create commitment or barge-in. The one-shot file path remains compatible, TTS is default **off**, microphone/cloud paths are env-gated, and automated smokes require no device.

**Reason:** Interface layer only — same tools, knowledge propose/accept, and session memory as text. Avoids a voice-specific product stack.

**Rejected alternatives:**

- **Always-on ambient listening without wake policy** — privacy and noise risk for a personal machine.
- **Voice-owned knowledge or tool loop** — forks the brain; violates “one handle path”.
- **Cloud STT/TTS as default** — audio/text leave the machine unless explicitly allowed.

## Interaction mode + proposals as first-class UI

**Status:** active  
**Evidence:** confirmed  
**Source:** design + iteration docs; foundation `04415a5`; UI/queue iteration `7d474bb`  
**Revisit when:** multi-hour sessions show the panel or mode chrome still get in the way

**Decision:** The web surface (and CLI/REPL) treat **active vs neutral** mode and a **proposals panel** as primary workflow chrome — not optional widgets on a bare chat shell. Mode is persisted per session (`session_state` in memory). Capture commands (`/mode`, `/capture`, `/accept`, `/reject`) work on CLI and UI so agents stay consistent.

**Reason:** Continuous knowledge capture only succeeds if review/accept is low-friction and always visible; a thin M6 chat shell is not enough for that loop.

**Rejected alternatives:**

- Keep M6 as “minimum chat only” and hope CLI accept is enough.
- Wizard/forms as the only capture path (kills free-form reasoning).
- Auto-accept so the UI never needs a proposals panel.
- Drive the panel only from the last chat payload (stale after refresh/session switch).

**Live behaviour**

| Surface | Behaviour |
|---------|-----------|
| Mode toggle | Persists `active`/`neutral`; next model turn uses matching system prompt (sparring vs quiet) |
| Proposals panel | Full **session** pending queue via `GET /v1/knowledge/proposals?sessionId=` (namespaced id from chat response); refresh re-fetches; accept/reject update queue |
| Capture | Continuous when active + proposals on; `/capture` forces extract; never auto-accept |
| CLI/REPL | Same slash commands; response shows mode, pending count, new proposal summaries |

**Related:** [knowledge.md](knowledge.md) (capture decisions); [memory.md](memory.md); [`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`](../docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md).

## Accepted knowledge exploration in the reasoning UI

**Status:** active
**Evidence:** confirmed
**Source:** [`docs/KNOWLEDGE_EXPLORE_UI.md`](../docs/KNOWLEDGE_EXPLORE_UI.md); [`docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md`](../docs/STRUCTURED_CAPTURE_AND_NETWORK_VIZ.md); web UI implementation 2026-08-05
**Revisit when:** hundreds of nodes no longer remain usable with the browser layout, or users need direct graph editing

**Decision:** The existing web shell has `Chat | Graph` views while the right column remains the pending proposals queue. Graph is primarily an interactive Cytoscape network of accepted nodes and labelled relations, loaded through the stable same-origin `/v1/knowledge/subgraph` envelope. Search, type/relation filters, node and edge selection, and 1–2-hop focus operate on the canvas; the list and detail pane remain secondary navigation. Accept actions refresh the graph without changing the propose-to-accept gate.

**Reason:** Accept/reject is hard to trust when permanent knowledge is invisible. Keeping exploration beside chat and proposals closes that feedback loop without creating a second frontend product or knowledge implementation.

**Rejected alternatives:** keep the graph as only a list plus textual neighborhood; a separate graph application; a heavy SPA/3D visualizer; build a layout engine from scratch; frontend-owned database queries; combining pending proposals and accepted nodes into one ambiguous list.

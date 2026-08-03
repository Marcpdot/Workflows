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
**Source:** M18 shell `6f11d1f`; `@workflows/voice`; CLI `--voice-once`, REPL `/voice`  
**Revisit when:** local STT is daily-driven or ambient wake is required

Speech enters as **transcript string** into the same orchestrator path as typed chat. TTS is default **off**. Mic/cloud paths are env-gated; mock STT supports offline smoke without a device.

**Reason:** Interface layer only — same tools, knowledge propose/accept, and session memory as text. Avoids a voice-specific product stack.

**Rejected alternatives:**

- **Always-on ambient listening without wake policy** — privacy and noise risk for a personal machine.
- **Voice-owned knowledge or tool loop** — forks the brain; violates “one handle path”.
- **Cloud STT/TTS as default** — audio/text leave the machine unless explicitly allowed.

## Interaction mode + proposals as first-class UI (design)

**Status:** active (design confirmed; implementation in progress)  
**Evidence:** confirmed  
**Source:** [`docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md`](../docs/INTERACTION_MODE_AND_KNOWLEDGE_CAPTURE.md)  
**Revisit when:** web UI is preferred for multi-hour reasoning sessions

**Decision:** The web surface (and CLI/REPL) treat **active vs neutral** mode and a **proposals panel** as primary workflow chrome — not optional widgets on a bare chat shell. Mode is persisted per session. Capture commands (`/mode`, `/capture`, `/accept`, `/reject`) work on CLI and UI so agents stay consistent.

**Reason:** Continuous knowledge capture only succeeds if review/accept is low-friction and always visible; a thin M6 chat shell is not enough for that loop.

**Rejected alternatives:**

- Keep M6 as “minimum chat only” and hope CLI accept is enough.
- Wizard/forms as the only capture path (kills free-form reasoning).
- Auto-accept so the UI never needs a proposals panel.

**Related:** [knowledge.md](knowledge.md) (propose→accept invariant + capture decision).

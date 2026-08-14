# Memory

## Minimal SQLite session history without embeddings (Milestone 0)

**Status:** active  
**Evidence:** confirmed  
**Source:** `packages/memory/`; early M0  
**Revisit when:** multi-device sync is required

Short-term conversation memory is SQLite (`better-sqlite3`) keyed by `sessionId`. Continuity across restart and model switch was the M0 goal. System prompts are not auto-persisted—only explicit user/assistant turns.

From **M9**, effective session ids are **namespaced per workspace** (`ws:<id>:<logical>`) so the same logical name does not mix projects in one DB. See [workspace.md](workspace.md).

**Reason:** Relational short-term history is enough for thread continuity. Embeddings were deferred.

**Rejected alternatives:**

- **SQLite + embeddings in M0** — too much surface before chat continuity worked.
- **In-memory only** — dies on restart.
- **Full long-term structured memory in M0** — later milestone.

## Durable experience spine (Continuous Cognition WP1)

**Status:** active
**Evidence:** confirmed
**Source:** PR #33 WP1 contract; `packages/memory/src/types.ts`; `packages/memory/src/store.ts`
**Revisit when:** multi-device experience sync is required, sustained input volume exceeds SQLite, or a modality needs a specialized payload store

Raw interactions are persisted as stable-ID **experience records before semantic
interpretation**. The minimum source vocabulary covers user messages,
assistant/model outputs, tool calls, tool results, explicit human corrections,
and external observations. Session/workspace/source metadata is optional; large
or future modalities may retain an external payload reference instead of copying
all bytes into SQLite.

The experience store extends `packages/memory` because that package already owns
restart-safe interaction continuity and its lifecycle. Existing `messages` and
`add`/`getHistory` APIs remain as a compatibility projection: new chat writes
atomically create both the exact source experience and the historical message.
Legacy message rows receive stable experience IDs when an existing database is
opened.

Tool calls/results enter this path before later model reasoning can use them.
Conversation knowledge capture keeps its session-scoped source reference while
also embedding the exact experience IDs represented by the capture event. An
experience records what occurred; it does not promote its content to accepted
truth or bypass knowledge proposals.

**Reason:** Semantic extraction, summaries, and claims are revisable derived
views. Keeping their exact source independently addressable prevents later
interpretation from replacing the evidence it came from, while reusing the
existing memory lifecycle avoids a second interaction database and coordination
boundary.

**Rejected alternatives:**

- **A new experience package/store for WP1** — duplicates the existing SQLite
  lifecycle before a distinct scaling or modality requirement exists.
- **Replace the messages API/table immediately** — breaks established CLI,
  HTTP, voice, and session-history callers for no capability gain.
- **Use only observability logs or synthetic session/turn strings** — neither
  provides a durable, exact source identity for content that influenced
  reasoning or knowledge capture.
- **Persist summaries instead of raw source activity** — loses fidelity and
  allows derived interpretation to displace its evidence.

## Session interaction state (post-M18 capture)

**Status:** active  
**Evidence:** confirmed  
**Source:** foundation `04415a5`; table `session_state` in short-term memory DB  
**Revisit when:** multi-device session sync is required

Per-session **`interactionMode`** (`active` | `neutral`, default active), **`proposalsEnabled`**, extract caps, and last-extract timestamp live in SQLite beside messages — not only in the UI client.

**Reason:** Mode and capture settings must survive process restart and be shared by CLI, HTTP, and web. Knowledge queue scoping uses the same namespaced `sessionId` as chat history.

**Rejected:** Store mode only in browser localStorage; put interaction mode on knowledge DB (wrong ownership — mode is session/UI policy, not graph truth).

See [knowledge.md](knowledge.md) (continuous capture) and [interface.md](interface.md).

## Long-term memory API (Milestone 3A)

**Status:** active  
**Evidence:** confirmed  
**Source:** `packages/memory/src/longterm/`; commit `3ae023d`  

Durable facts with `remember` / `recall` / `list` / `forget`, optional keys and tags. Keyword recall first. Storage path is local/gitignored or `PERSONAL_CONTEXT_DIR`.

**Default remains shared/personal across workspaces.** Optional `LONGTERM_PROJECT_SCOPED=true` stores LTM under the active workspace (M9). See [workspace.md](workspace.md) and [privacy.md](privacy.md).

**Reason:** Need durable facts without putting personal content in git. API first, personal content policy separate.

## Embeddings / semantic memory (Milestone 4)

**Status:** active  
**Evidence:** confirmed  
**Source:** `packages/embeddings/`; commit `7debfab`  

Pluggable embedder (Ollama + mock), SQLite float vectors, linear scan, default **off**. When on: LTM index on remember/forget; retrieval can merge semantic context hits with keyword (RRF-style). Keyword path remains when disabled.

**Reason:** Keyword ceiling is real; semantic path must not break the system when no embed model is installed.

**Known thin spots (accepted for shell):** context index may skip re-embed when store already non-empty; score fusion is heuristic. Revisit when semantic retrieval is used daily.

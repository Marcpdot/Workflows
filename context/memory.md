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

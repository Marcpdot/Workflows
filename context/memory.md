# Memory

## Minimal SQLite session history without embeddings (Milestone 0)

**Status:** active  
**Evidence:** confirmed  
**Source:** `Orchestrator/src/memory/AGENTS.md`; implementation in `Orchestrator/src/memory/`; commit `8bb73cf`  
**Revisit when:** Milestone 1 retrieval/compression lands, or multi-user / multi-device sync is required

Short-term conversation memory is a SQLite-backed store (`better-sqlite3`) keyed by `sessionId`. API surface: `add`, `getHistory`, `clear`, `close`. Messages are ordered chronologically; default history limit is 50. System prompts are not auto-persisted—only explicit adds (CLI stores user + assistant turns). The DB file is created automatically (default `./data/memory.db`) so history survives process restarts and model switches.

**Reason:** The main M0 memory goal is continuity: continue a session after restart or after routing flips between local and frontier without losing thread. A small relational table is enough for that. Embeddings and semantic retrieval are explicitly out of scope until Milestone 1 (context compression + retrieval).

**Rejected alternatives:**

- **SQLite + embeddings in M0** — mentioned as an example in `ARCHITECTURE.md` Milestone 0, but the memory agent spec narrowed M0 to “short-term + simple persistence only.” Embeddings add dependency weight, indexing design, and evaluation surface before basic chat continuity works.
- **In-memory only** — rejected because history would die on restart, breaking the “switch model mid-conversation without losing context” milestone criterion across process boundaries.
- **Full long-term structured memory (facts, preferences, project status)** — architecture target for later layers; not the M0 deliverable.

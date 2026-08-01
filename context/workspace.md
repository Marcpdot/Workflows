# Session / workspace model

## Multi-project isolation without mixing context (Milestone 9)

**Status:** active  
**Evidence:** confirmed  
**Source:** M9 commit `6dfb2a3`; `Orchestrator/src/workspace/`; CLI `--workspace` / `--list-sessions`  
**Revisit when:** multi-device sync or automatic repo discovery is required

Three layers stay distinct:

| Layer | Isolation |
|-------|-----------|
| **Workspace** | Absolute `rootPath`; tools cannot escape (path safety) |
| **Session** | Short-term history in one SQLite DB, keyed by **namespaced** id `ws:<workspaceId>:<logical>` |
| **Personal LTM** | Shared across workspaces by default; optional `LONGTERM_PROJECT_SCOPED` |

`resolveWorkspace()` also picks **project context** for retrieval: prefer `{workspace}/context` when present, else `RETRIEVAL_CONTEXT_DIR` / repo default.

**Reason:** Same logical session name (`default`, `demo`) must not mix histories or file roots when calling from different projects. M5 already bound tools to `--workspace`; M9 makes session + project context first-class and documents the model.

**Rejected alternatives:**

- **Separate memory.db per workspace only** — heavier ops for a personal stack; namespaced keys in one DB are enough for the shell.
- **Always share un-prefixed session ids** — convenient for a single project, collides as soon as two workspaces use `"default"`. Legacy opt-out: `SESSION_NAMESPACE=false`.
- **Auto-discover every git repo on disk** — out of scope; caller passes workspace explicitly.
- **LTM always per-project** — personal facts should span projects by default; project scope is opt-in.

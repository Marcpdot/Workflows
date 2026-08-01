# Milestone 9 — Session / workspace-modell

## Mål
Flere prosjekter eller workspaces uten å blande kontekst — tydelig separasjon av:

- **session** (samtale / short-term)
- **workspace / project** (filer, project context)
- **personal LTM** (på tvers, privat path)

## Implementert (shell)

| Del | Hvor |
|-----|------|
| `resolveWorkspace` / `WorkspaceContext` | `src/workspace/` |
| Session namespace `ws:<id>:<logical>` | default on; `SESSION_NAMESPACE=false` for legacy |
| Tools → `rootPath` | orchestrator + pathSafety (M5 forsterket) |
| Project context | `{workspace}/context` hvis finnes, ellers `RETRIEVAL_CONTEXT_DIR` / default |
| LTM | fortsatt global/personal; `LONGTERM_PROJECT_SCOPED=true` → under workspace |
| CLI | `--workspace`, `--session`, `--list-sessions`, `/workspace` i REPL |

```bash
npx tsx scripts/smoke-workspace.ts
```

## Utenfor scope
- Full multi-user
- Cloud sync av workspaces
- Automatisk oppdage alle git-repos på disk

## API

```ts
export interface WorkspaceContext {
  id: string;
  rootPath: string;
  contextDir: string;
  sessionPrefix: string;
  logicalSessionId: string;
  sessionId: string; // effective (namespaced)
}

export function resolveWorkspace(input: {
  workspaceRoot?: string;
  sessionId?: string;
  cwd?: string;
  contextDir?: string;
  env?: NodeJS.ProcessEnv;
}): WorkspaceContext;
```

## Ferdig når
- To workspaces kan ha separate short-term histories
- Tools kan ikke lese utenfor aktiv workspace root
- Dokumentert modell i README

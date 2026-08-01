# Milestone 9 — Session / workspace-modell

## Mål
Flere prosjekter eller workspaces uten å blande kontekst — tydelig separasjon av:

- **session** (samtale / short-term)
- **workspace / project** (filer, project context)
- **personal LTM** (på tvers, privat path)

## Scope
1. `WorkspaceContext`: `{ id, rootPath, contextDir?, sessionPrefix? }`
2. Session IDs namespaces per workspace (unngå kollisjon i samme memory.db)
3. Tools binder til workspace.rootPath (forsterker M5 `--workspace`)
4. Retrieval project context per workspace (egen `context/` eller konfigurert dir)
5. LTM forblir delt/personlig med mindre eksplisitt project-scoped store (valgfritt flagg)
6. CLI: `--workspace`, `--session`, evt. `--list-sessions`

## Utenfor scope
- Full multi-user
- Cloud sync av workspaces
- Automatisk oppdage alle git-repos på disk

## API (skisse)

```ts
export interface WorkspaceContext {
  id: string;
  rootPath: string;
  contextDir?: string;
  sessionId: string; // effective session for this invocation
}

export function resolveWorkspace(input: {
  workspaceRoot?: string;
  sessionId?: string;
  cwd?: string;
}): WorkspaceContext;
```

## Ferdig når
- To workspaces kan ha separate short-term histories
- Tools kan ikke lese utenfor aktiv workspace root
- Dokumentert modell i README

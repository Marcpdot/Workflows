# Milestone 13 — Project & workspace binding

## Mål

Gjøre **prosjektstatus** og **workspace-isolasjon** førstklassige i knowledge-laget.

Etter M11 finnes `workspaceId?` på noder og typen `project`, men de er ikke systematisk brukt.  
Etter M12 kan modeller kalle knowledge-tools, men «Hva er status på aktuator-v2?» har ingen stabil kontrakt.

M13 leverer:

1. Prosjekt som eksplisitt node + koblinger (claims/concepts → project)
2. Konsistent `workspaceId` ved propose/accept når workspace er aktivt
3. Status-spørring: oppsummering av det som er knyttet til et prosjekt
4. Tools + CLI for bind/status (defaults i tråd med M9/M12)

**Invariant:** Forslag → godkjenning forblir; M13 auto-accepter ikke.

Forutsetter: M11 store. M12 tools er ønsket wire-path; hvis M12 ikke er merget ennå, kan M13 API + CLI leveres først og tools registreres når M12 finnes.

## Scope

1. **Project ensure/find** — stabil måte å hente eller opprette `type: "project"` node (label = prosjektnavn, f.eks. `aktuator-v2`)
2. **Bind API** — koble node → project via edge (`used_in` | `about` | `part_of`); valgfritt sett `workspaceId` på noder
3. **Workspace default** — når `WorkspaceContext` / env har workspace, nye noder fra accept/propose får `workspaceId` med mindre eksplisitt overstyrt
4. **`getProjectStatus(projectId | label)`** — strukturert oppsummering (noder, claims, open proposals, relasjoner inn/ut)
5. **Filter** — `findNodes` / list proposals / neighborhood respekterer valgfri `workspaceId` (allerede delvis i M11 find)
6. **Tools** (når M12-wire finnes): `knowledge_ensure_project`, `knowledge_link_project`, `knowledge_project_status`
7. **CLI** — `--knowledge project-status`, `--knowledge ensure-project`, `--knowledge link`
8. **Smoke** på temp DB: ensure project → accept concepts → link → status inneholder forventede labels

## Utenfor scope (M13)

- Kontinuerlig ingest av chat (M14)
- Alias / contradiction engine (M15)
- First-principles template (M16)
- UI (M17), stemme (M18)
- Automatisk «alt i denne workspace er dette git-repo-prosjektet» uten eksplisitt project-node
- Multi-DB per workspace (én knowledge.db; filtrering på `workspaceId` — samme mønster som M9 session namespace, ikke separat fil per prosjekt med mindre senere behov)
- Erstatte M9 workspace path safety (tools filesystem) — knowledge binding er metadata, ikke path root

## Begreper

| Begrep | Betydning i M13 |
|--------|------------------|
| **Workspace** | M9: filroot + session-namespace. Knowledge: streng-id lagret på noder (`workspaceId`), typisk hash/slug av rootPath eller eksplisitt id fra `resolveWorkspace()` |
| **Project** | Knowledge-node `type: "project"`, menneskelig label (`aktuator-v2`). Kan leve i ett workspace eller være global (`workspaceId` null) |
| **Binding** | Edge fra claim/concept/artifact → project med relation `used_in` / `about` / `part_of` |

En workspace kan ha mange projects. Et project bør normalt ha `workspaceId` satt når det opprettes under en aktiv workspace.

## API-utvidelser

Legg til på `KnowledgeStore` (eller tynt facade-lag `KnowledgeProjects` som bruker store):

```ts
/** Find accepted project by label, or create pending→caller accepts, or ensure accepted in one step for CLI */
ensureProject(input: {
  label: string;
  description?: string;
  workspaceId?: string | null;
  /** default true for CLI/tools convenience; false returns existing or creates proposal only */
  createAccepted?: boolean;
}): Promise<KnowledgeNode>;

linkToProject(input: {
  nodeId: string;
  projectId: string;
  relation?: "used_in" | "about" | "part_of"; // default "used_in"
  sourceEventId?: string;
}): Promise<KnowledgeEdge>;

unlinkFromProject(input: {
  nodeId: string;
  projectId: string;
}): Promise<boolean>;

getProjectStatus(input: {
  projectId?: string;
  label?: string;
  workspaceId?: string | null;
  hops?: 1 | 2; // default 1
}): Promise<ProjectStatus>;

interface ProjectStatus {
  project: KnowledgeNode;
  workspaceId?: string | null;
  linkedNodes: KnowledgeNode[];      // directly linked (and optionally 2-hop)
  edges: KnowledgeEdge[];
  claims: KnowledgeNode[];           // type === claim among linked
  concepts: KnowledgeNode[];
  artifacts: KnowledgeNode[];
  pendingProposalCount: number;      // proposals whose payload references project label/id if cheap; else 0 in shell
  summaryLines: string[];            // stable text for tools/prompts
}
```

### workspaceId ved materialize

Ved `acceptProposal` for nodes:

- Hvis payload har `workspaceId`, bruk den
- Ellers hvis store/config har `defaultWorkspaceId`, sett den
- Ellers `null` (global)

```ts
interface KnowledgeStoreConfig {
  dbPath: string;
  defaultWorkspaceId?: string | null;
}
```

Orchestrator setter `defaultWorkspaceId` fra aktiv `WorkspaceContext` når knowledge store åpnes i en workspace-session.

### Events (valgfritt men nyttig)

```ts
// KnowledgeEvent may gain optional workspaceId in schema
workspaceId?: string | null;
```

Migration: `ALTER TABLE` add column if missing; M11 rows stay valid with NULL.

## Tools (M12-style names)

| Tool | Purpose |
|------|--------|
| `knowledge_ensure_project` | `{ label, description?, workspaceId? }` → project node |
| `knowledge_link_project` | `{ nodeId, projectId, relation? }` |
| `knowledge_unlink_project` | `{ nodeId, projectId }` |
| `knowledge_project_status` | `{ label? , projectId?, hops? }` → status summary |

Existing M12 tools gain optional `workspaceId` filter args where relevant (`knowledge_find`).

Tool descriptions must tell the model: *Use ensure_project then link_project after accepting relevant claims; use project_status to answer status questions.*

## CLI

```bash
npx tsx src/index.ts --knowledge ensure-project label=aktuator-v2
npx tsx src/index.ts --knowledge link nodeId=... projectId=... relation=used_in
npx tsx src/index.ts --knowledge project-status label=aktuator-v2
npx tsx src/index.ts --knowledge project-status projectId=...
```

Respect `--workspace` / `WORKSPACE_ROOT` for default `workspaceId` slug (document exact derivation — e.g. basename of root or existing workspace id from `resolveWorkspace()`).

## Status summary format

`summaryLines` example (stable, boring):

```
project: aktuator-v2 (accepted)
workspace: <id|none>
claims: 3 | concepts: 5 | artifacts: 1
- claim: copper loss produces heat
- concept: heat -[limits]-> continuous torque
pending proposals: 2
```

Cap size like other tool outputs.

## Orchestrator wire

1. When opening knowledge store in a session with workspace, pass `defaultWorkspaceId`
2. Register M13 tools with M12 tools when `KNOWLEDGE_TOOLS_ENABLED`
3. Optional: if `KNOWLEDGE_INJECT_ENABLED` and user message matches project label, prefer `getProjectStatus` inject over generic neighborhood (simple heuristic: exact label token match)

No change to path safety / M9 session keys.

## Env

```
# existing
KNOWLEDGE_DB_PATH=
KNOWLEDGE_TOOLS_ENABLED=false
KNOWLEDGE_INJECT_ENABLED=false

# M13 optional
KNOWLEDGE_DEFAULT_WORKSPACE_ID=   # override; else from active workspace
```

## Smoke (`smoke-knowledge-projects.ts`)

1. Temp DB, `ensureProject({ label: "aktuator-v2", createAccepted: true, workspaceId: "ws-test" })`
2. Fixture extract + accept concepts/claims
3. `linkToProject` claim → project
4. `getProjectStatus({ label: "aktuator-v2" })` includes claim label and workspaceId
5. Second project in same DB does not appear in first status linked set
6. `findNodes({ type: "project", workspaceId: "ws-test" })` returns project
7. Cleanup temp DB

## Privacy

Uendret: ingen ekte prosjektinnhold i public repo; smoke bruker fake labels.

## Ferdig når

- [x] `ensureProject` / `linkToProject` / `getProjectStatus` implementert
- [x] `workspaceId` settes fornuftig ved accept når default er konfigurert
- [x] CLI project-status fungerer
- [x] Tools registrert når knowledge tools enabled (eller dokumentert defer til umiddelbar M12 follow-up)
- [x] Smoke passerer offline
- [x] M11 vertical uendret for ikke-prosjekt bruk
- [x] Context/milestones oppdatert ved leveranse

## Design notes

- **Project er en node, ikke en separat tabell** — holder grafmodellen én, status er en query.
- **Edges for binding** — samme neighborhood-maskineri; unngår parallelle «membership»-lister.
- **workspaceId på node** — billig filter uten ny DB per workspace; matcher M9 «namespace in one DB».
- **createAccepted på ensureProject** — CLI/tools trenger lav friksjon; proposals-path finnes fortsatt via vanlig propose for strenge flows.

# Milestone 3C — Minimal multi-agent roles

**Avhenger av 3A valgfritt, 3B valgfritt; hardt krav: M2 tools + orchestrator.**

## Mål
Kjøre **to eller flere roller sekvensielt** på samme oppgave når det trengs — ikke et fullt multi-agent swarm-framework.

Eksempel:
```
planner → (plan text) → coder → (uses tools) → final answer
```

## Scope
1. `AgentRole` definition (name, systemPrompt, toolsAllowed?, modelPreference?)
2. `runRolePipeline(roles, task)` sekvensiell
3. Minst to built-in roles: `planner`, `worker`
4. Del kontekst via messages; tools via eksisterende registry/loop
5. Flag `AGENTS_PIPELINE_ENABLED` / explicit CLI — default off

## Utenfor scope
- Parallel agents
- Negotiation / debate protocols
- Persistent agent personas med privat brukerprofil
- Auto-routing «always use pipeline» for alle prompts

## Filer
```
src/agents/
  types.ts
  roles.ts          # planner, worker defaults
  pipeline.ts       # runRolePipeline
  index.ts
  AGENTS.md

scripts/smoke-agents.ts
```

## API

```ts
export interface AgentRole {
  name: string;
  systemPrompt: string;
  /** If set, only these tools are exposed; empty = no tools; undefined = all */
  toolsAllowed?: string[];
  modelPreference?: "local" | "frontier";
}

export interface PipelineResult {
  finalText: string;
  stages: Array<{
    role: string;
    text: string;
    toolSteps?: ToolLoopStep[];
  }>;
}

export async function runRolePipeline(options: {
  task: string;
  roles: AgentRole[];
  /** complete function wired to orchestrator models + optional tools */
  runStage: (input: {
    role: AgentRole;
    task: string;
    priorStages: PipelineResult["stages"];
  }) => Promise<{ text: string; toolSteps?: ToolLoopStep[] }>;
}): Promise<PipelineResult>;
```

Built-ins i `roles.ts`:
- **planner**: bryt ned oppgaven, ingen tools (eller kun read/list)
- **worker**: utfør med tools enabled, følg planen

## Integrasjon

CLI:
```bash
npx tsx src/index.ts --pipeline "Legg til smoke for X"
```

Eller REPL `/pipeline ...`

Når pipeline off: vanlig `handle()` uendret.

## Privacy
Role prompts er generiske systemtekster i repo. Ingen «du er Marcus…» hardkodet. Personlige fakta kommer kun fra LTM/private path hvis brukeren har skrudd det på.

## Testing
Offline mock `runStage`:
1. To stages called in order
2. Worker receives planner output in priorStages
3. Single role pipeline works
4. Empty roles → error

## Ferdig når
- smoke-agents passerer
- Default off
- Kan demonstreres med mock eller local model + tools
- M3 overview checklist oppfylt sammen med 3A/3B

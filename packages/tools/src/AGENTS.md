# Tools Spec (Milestone 2 — phase A)

## Mål
Standardiser et **tool-interface** og implementer de første utskiftbare tools, slik at modeller ikke snakker direkte med filsystem/shell — bare via registry.

Dette er **fase A**: interface + registry + 3 konkrete tools + manuell/programmatisk execute.  
**Ikke** full agent-loop med modell-styrte tool-calls ennå (det er fase B).

## Hvorfor fase A først
Uten stabilt interface blir «modell kaller tools» rotete. Først:
1. Definer kontrakt
2. Registrer tools
3. Kjør dem trygt fra kode/CLI
4. Deretter koble modell ↔ tools

## Krav
1. Felles `Tool`-interface (name, description, parameters, execute)
2. `ToolRegistry` for register / get / list
3. Tre built-in tools:
   - `read_file` — les tekstfil under workspace root
   - `list_dir` — list mappe under workspace root
   - `run_command` — kjør kommando med **whitelist** (fase A: svært begrenset)
4. Path-sikkerhet: ingen path escape utenfor workspace root
5. Strukturert `ToolResult` (ok / error + tekst)
6. Ingen breaking change: eksisterende chat-path uten tools fungerer som før

## Filer
```
packages/tools/src/
  types.ts          # Tool, ToolResult, ToolParameterSchema
  registry.ts       # ToolRegistry
  pathSafety.ts     # resolveSafePath(workspaceRoot, relative)
  builtin/
    readFile.ts
    listDir.ts
    runCommand.ts
  createBuiltinRegistry.ts  # factory med default tools
  index.ts

scripts/
  smoke-tools.ts
```

## API

```ts
export type ToolParamType = "string" | "number" | "boolean";

export interface ToolParameter {
  name: string;
  type: ToolParamType;
  description: string;
  required?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Human/model-readable output */
  output: string;
  /** Optional machine-readable payload */
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  /** Absolute path — all file tools must stay under this root */
  workspaceRoot: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): Tool[];
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult>;
}
```

## Path safety

```ts
/** Resolve relative path under workspaceRoot; throw if escapes root */
function resolveSafePath(workspaceRoot: string, relativePath: string): string;
```

- Bruk `path.resolve` + verifiser at resultatet starter med `workspaceRoot`
- Avvis `..`-escape, absolute paths utenfor root, tom path der det kreves fil

## Built-in tools

### `read_file`
| Param | Type | Required |
|-------|------|----------|
| path | string | ja |

- Les fil som utf-8
- Max størrelse default 256 KiB (env `TOOL_READ_MAX_BYTES`); over → error
- Returner innhold i `output`

### `list_dir`
| Param | Type | Required |
|-------|------|----------|
| path | string | nei (default `"."`) |

- List entries med type fil/dir
- Ikke rekursiv i fase A
- Sortert output

### `run_command`
| Param | Type | Required |
|-------|------|----------|
| command | string | ja |

**Fase A whitelist** (kun disse, exact match på første token):
- `node`
- `npm`
- `npx`
- `tsc`
- `git` (subcommands: `status`, `diff`, `log`, `branch` — ikke `push`/`commit` i fase A med mindre eksplisitt utvidet)

Regler:
- `cwd` = workspaceRoot
- timeout default 15s (`TOOL_COMMAND_TIMEOUT_MS`)
- fang stdout+stderr
- ikke `shell: true` hvis mulig — parse args sikkert; på Windows kan `cmd`/`powershell` unngås ved å bruke `execFile`
- ukjent kommando → `ok: false` med tydelig error

## Registry factory

```ts
export function createBuiltinRegistry(): ToolRegistry;
```

Registrerer de tre built-ins. Tester kan lage tom registry og registere mocks.

## CLI (minimal)

Valgfritt i fase A — minst smoke-script:

```bash
npx tsx scripts/smoke-tools.ts
```

Smoke skal:
1. list_dir på workspace
2. read_file på en kjent fil (f.eks. package.json)
3. run_command `git status` (eller skip hvis ikke git)
4. forsøk path escape → forventet error
5. forsøk non-whitelist command → forventet error

## Integrasjon med Orchestrator (fase A)

**Minimal:** Orchestrator får valgfri `tools?: ToolRegistry` i config, men **bruker den ikke automatisk i handle()** ennå.

Eksponer gjerne:
```ts
orch.getTools(): ToolRegistry | undefined
orch.runTool(name, args): Promise<ToolResult>  // bruker workspaceRoot fra config
```

CLI kan ha:
```text
/tool list
/tool run read_file path=package.json
```
(valgfritt men nyttig)

Fase B (egen spec senere): modell returnerer tool_calls → execute → append result → re-complete.

## Env
```
TOOL_WORKSPACE_ROOT=.          # default cwd
TOOL_READ_MAX_BYTES=262144
TOOL_COMMAND_TIMEOUT_MS=15000
```

## Krav til implementasjon
- TypeScript, ingen nye tunge deps
- Alle file tools går via `resolveSafePath`
- `execute` kaster ikke for «business»-feil — returner `ok: false`
- Kast kun ved programmeringsfeil (ugyldig registry-state)
- Eksporter fra `packages/tools/src/index.ts`

## Ikke gjør dette ennå (fase B+)
- LLM tool-calling loop / function calling JSON
- Web search tool
- Ubegrenset shell
- `git commit` / `git push` via tool
- Parallel tool execution
- Permission prompts per tool call

## Ferdig når
- `createBuiltinRegistry()` + smoke-tools passerer
- Path escape feiler trygt
- Non-whitelist command feiler trygt
- Chat uten tools er uendret
- Klar for fase B-spec (modell-drevet tool use)

# Tools Spec (Milestone 2 — phase B)

**Avhenger av fase A.** Ikke implementer denne før `src/tools/` fase A er merget og smoke-tools passerer.

## Mål
Koble modeller til tool-registry via en **styrt tool-loop**:

```
user prompt → model (with tool schemas)
  → optional tool_calls
  → registry.execute
  → append tool results to messages
  → model again
  → final reply
```

Fase A ga `Tool` + `execute`. Fase B gir orchestratoren evne til å *bruke* dem automatisk når oppgaven krever det.

## Scope
1. Felles format for tool definitions til modell (name, description, parameters)
2. Parse modell-output for tool calls (robust, ikke bare ett provider-format)
3. `runToolLoop(...)` med max steps, timeout, og feilhåndtering
4. Integrasjon i `Orchestrator.handle` bak flagg (`toolsEnabled` / env)
5. Logging: hvilke tools som ble kalt, ok/fail, latency

## Utenfor scope
- Parallel tool calls (sekvensiell er nok)
- Human approval per call (kan komme senere)
- Nye tools utover fase A built-ins (kan legges til uten å endre loop)
- Streaming tool calls
- Multi-agent tool ownership

## Filer (fase B)
```
src/tools/
  loop.ts           # runToolLoop
  schema.ts         # tools → model-facing schema
  parseToolCalls.ts # extract calls from model output
  types.ts          # utvid med ToolCall, ToolLoopResult (eller egen types-b)

src/orchestrator.ts # valgfri tool-loop når enabled
src/models/*        # evt. støtte for tools i request hvis API støtter det
```

Hold fase A-filer stabile; utvid, ikke rewrite.

## Typer

```ts
export interface ToolCall {
  id: string;             // model-provided or generated uuid
  name: string;
  args: Record<string, unknown>;
}

export interface ToolLoopStep {
  call: ToolCall;
  result: ToolResult;
  durationMs: number;
}

export interface ToolLoopResult {
  /** Final assistant text after loop ends */
  finalText: string;
  steps: ToolLoopStep[];
  /** true if stopped because maxSteps hit */
  hitMaxSteps: boolean;
}

export interface ToolLoopOptions {
  maxSteps?: number;          // default 5
  workspaceRoot: string;
  registry: ToolRegistry;
  /** Called each model turn; must return assistant text + optional tool calls */
  complete: (messages: ChatMessage[], tools: Tool[]) => Promise<{
    text: string;
    toolCalls?: ToolCall[];
  }>;
}
```

## Model-facing schema

```ts
export function toModelToolSchemas(tools: Tool[]): Array<{
  name: string;
  description: string;
  parameters: ToolParameter[];
}>;
```

Provider-spesifikk wrapping (OpenAI `functions` / `tools`, XML, etc.) skjer i model-client eller en tynn adapter — ikke hardkod ett format i loop-kjernen.

## Parsing strategy (praktisk for M2)

Støtt **to** veier:

1. **Structured (foretrukket):** hvis `ModelClient.complete` / frontier API returnerer structured tool_calls, bruk dem direkte.
2. **Fallback tekst:** modell skriver JSON-blokk, f.eks.
   ```json
   {"tool_calls":[{"name":"read_file","args":{"path":"package.json"}}]}
   ```
   eller en enkel linje-protokoll avtalt i system prompt.

`parseToolCalls(text): ToolCall[]` skal:
- returnere `[]` hvis ingen calls
- tåle ekstra prose rundt JSON
- aldri kaste på rotete output — tom liste + la loop avslutte med teksten

## Loop-algoritme

```
messages = [system, ..., user]
for step in 1..maxSteps:
  response = complete(messages, registry.list())
  calls = response.toolCalls ?? parseToolCalls(response.text)
  if calls.length == 0:
    return { finalText: response.text, steps, hitMaxSteps: false }
  append assistant message (text + call metadata as needed)
  for call in calls:   # sequential
    result = registry.execute(call.name, call.args, ctx)
    append tool result message
    record step
return { finalText: last text or "(max steps)", steps, hitMaxSteps: true }
```

Regler:
- Ukjent tool name → `ToolResult{ ok:false, error:"unknown tool" }` (ikke crash)
- `maxSteps` default 5
- Samme path-safety som fase A (registry/tools eier det)

## Orchestrator-integrasjon

```ts
// config / env
TOOLS_ENABLED=false          // default off til fase B er stabil
TOOLS_MAX_STEPS=5
TOOL_WORKSPACE_ROOT=.
```

Når `TOOLS_ENABLED=true`:
- `handle()` bygger messages som i dag (retrieval, compression)
- deretter `runToolLoop` i stedet for enkelt `client.complete` når tools er konfigurert
- `OrchestratorResult` utvides med valgfri `toolSteps?: ToolLoopStep[]`

Når `false`: identisk med dagens path.

### Routing vs tools
Fase B: tools tilgjengelig for **begge** local og frontier.  
Senere kan router si «tool-heavy → local» for kostnad — ikke krav i B.

## System prompt-tillegg (når tools on)

Kort, stabil tekst:
```
You can call tools when you need file or command information.
Only use listed tools. Prefer read_file/list_dir before run_command.
When done, answer the user without tool calls.
```

## Testing

```bash
npx tsx scripts/smoke-tool-loop.ts
```

Offline der mulig:
1. Mock `complete` som først ber om `read_file`, deretter returnerer ren tekst med filinnhold
2. Verifiser at `registry.execute` ble kalt én gang
3. maxSteps=1 med always-tool response → `hitMaxSteps: true`
4. unknown tool → ok:false i steps, loop kan fortsette

Live (valgfritt): `TOOLS_ENABLED=true` + local modell + «Hva står i package.json name-feltet?»

## Krav til implementasjon
- Fase A public API skal ikke brytes
- Loop skal ikke importere path-logikk direkte — kun registry
- Ingen infinite loop: hard `maxSteps`
- Eval: legg gjerne til 1–2 cases senere (`tool-read-package-name`) — ikke blokkerende for B merge

## Ferdig når
- `runToolLoop` + mock smoke passerer
- `TOOLS_ENABLED=false` → ingen regresjon
- `TOOLS_ENABLED=true` + mock/local kan lese en fil via tool og svare
- OrchestratorResult kan vise tool steps i CLI (`[tool] read_file ok`)

## Forhold til fase A
| Fase A | Fase B |
|--------|--------|
| Definerer tools | Bruker tools |
| `/tool run` manuell | Automatisk fra modell |
| Ingen modell-krav | Krever parse + loop |

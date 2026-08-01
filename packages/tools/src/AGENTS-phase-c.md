# Tools Spec (Milestone 2 — phase C)

**Avhenger av fase A + B.**  
- A: interface, registry, builtins, path safety  
- B: model-driven `runToolLoop`, `TOOLS_ENABLED`  

Ikke implementer C før B smoke (tool-loop) er grønn.

## Mål
Utvide tool-laget med **flere nyttige tools** og gjøre det enkelt å legge til egne, uten å endre loop eller orchestrator-kjerne.

Fase C er «bredde + modularitet», ikke ny arkitektur.

## Scope

### 1. Nye built-in tools
| Tool | Formål |
|------|--------|
| `write_file` | Skriv/overskriv tekstfil under workspace (med size cap) |
| `search_files` | Enkel ripgrep-lignende søk (filnavn + innhold, begrenset) |
| `web_search` | Valgfri HTTP-søk via konfigurert provider (kan være stub/off by default) |
| `run_script` | Kjør whitelistet script under `scripts/` eller eksplisitt allow-list path |

### 2. Registry-utvidelser
- `register` allerede i A — dokumenter plugin-mønster: eksterne moduler eksporterer `Tool[]`
- Valgfri `createRegistryFromConfig()` som loader built-ins + optional extra tools

### 3. Sikkerhet (skjerpet)
- `write_file`: samme path safety; default **deny** utenfor workspace; max bytes
- `run_script`: kun filer under allow-list dirs; ingen arbitrary path execute
- `web_search`: timeout, max results, ingen credentials i tool output
- Fortsatt **ingen** generisk unrestricted shell

### 4. Eval
- 1–2 cases: f.eks. «hva er name i package.json» via tool-loop (krever B)
- Ikke hele suite avhengig av nett (`web_search` skip hvis disabled)

## Utenfor scope
- Browser automation
- Arbitrary network (kun definert search API)
- `git commit` / `git push` (fortsatt blokkert med mindre egen senere fase)
- GUI / approval prompts (kan være M3)
- MCP server bridge (interessant senere, ikke C-krav)

## Filer
```
packages/tools/src/
  builtin/
    writeFile.ts
    searchFiles.ts
    webSearch.ts      # may no-op if WEB_SEARCH_ENABLED=false
    runScript.ts
  loadExtras.ts       # optional dynamic import of extra tool modules
  # phase A/B files unchanged in contract

scripts/
  smoke-tools-phase-c.ts
```

## Tool contracts (kort)

### `write_file`
| Param | Type | Required |
|-------|------|----------|
| path | string | ja |
| content | string | ja |
| overwrite | boolean | nei (default true) |

- `resolveSafePath`
- Max `TOOL_WRITE_MAX_BYTES` (default 256 KiB)
- Hvis fil finnes og `overwrite=false` → ok:false

### `search_files`
| Param | Type | Required |
|-------|------|----------|
| query | string | ja |
| path | string | nei (".") |
| maxResults | number | nei (20) |

- Søk i tekstfiler under path (hopp `node_modules`, `.git`, `data/`)
- Returner `file:line: snippet` begrenset til maxResults
- Ingen ekstern binary-krav i C: ren TS scan er OK (langsomt men avhengighetsfritt). Valgfritt bruk `rg` hvis finnes på PATH.

### `web_search`
| Param | Type | Required |
|-------|------|----------|
| query | string | ja |
| maxResults | number | nei (5) |

- Kun aktiv hvis `WEB_SEARCH_ENABLED=true` + API-key/endpoint i env
- Ellers: `ok:false` med tydelig «disabled»
- Output: tittel, url, kort snippet — ingen HTML-dump

### `run_script`
| Param | Type | Required |
|-------|------|----------|
| script | string | ja (relative path) |
| args | string | nei |

- Script path må ligge under `TOOL_SCRIPT_ROOTS` (default `scripts`)
- Kjør med `node` for `.js`/`.ts` via `npx tsx` eller `node` — whitelist interpreter
- Timeout som `run_command`

## Plugin-mønster (modularitet)

```ts
// examples/extra-tools/myTool.ts
import type { Tool } from "@workflows/tools";
export const tools: Tool[] = [ /* ... */ ];
```

```ts
const registry = createBuiltinRegistry(); // A + C built-ins
await loadExtraTools(registry, process.env.TOOL_EXTRA_MODULES?.split(",") ?? []);
```

Ingen magi: eksplisitt register. Målet er at *dine* quant-scripts / hardware-helpers senere er bare nye `Tool`-objekter.

## Env
```
TOOL_WRITE_MAX_BYTES=262144
TOOL_SCRIPT_ROOTS=scripts
WEB_SEARCH_ENABLED=false
WEB_SEARCH_ENDPOINT=
WEB_SEARCH_API_KEY=
TOOL_EXTRA_MODULES=
```

## Integrasjon
- Fase B-loop trenger **ingen** endring for nye tools (registry.list() driver schema)
- CLI: `/tool run write_file path=…` fungerer automatisk når tool er registrert
- Oppdater README med nye tool-navn

## Testing
`smoke-tools-phase-c.ts`:
1. write_file + read_file roundtrip i temp under workspace
2. search_files finner kjent streng i package.json / README
3. run_script på en liten scripts/smoke-*.ts eller skip
4. web_search disabled → ok:false
5. write utenfor root → fail

## Ferdig når
- Nye tools i registry + smoke C passerer
- Fase B loop kan bruke dem uten kodeendring i loop.ts
- `WEB_SEARCH_ENABLED=false` default — ingen nett-krav
- Dokumentert hvordan legge til eget tool i 10 linjer

## Milestone 2 samlet
| Fase | Innhold | Status-mål |
|------|---------|------------|
| A | Interface + read/list/run_command | done |
| B | Model tool loop | etter A |
| C | Flere tools + plugin-mønster | etter B |

Etter C er M2 «tools + modularitet» i arkitekturen i praksis oppfylt for første versjon.

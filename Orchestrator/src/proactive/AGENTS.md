# Milestone 3B — Proactivity

**Avhenger av 3A** (valgfritt bruke LTM; ikke hardt krav for første proaktive suggestions).

## Mål
Etter et svar kan systemet foreslå **0–3 neste steg** basert på:
- siste user/assistant turns
- project `context/` retrieval (Keep the Why)
- valgfritt LTM recall

Ikke spam. Ikke personlig profil påkrevd.

## Scope
1. `suggestNextSteps(input) → Suggestion[]`
2. Heuristikk først (regler), valgfri lokal-modell-polish
3. CLI viser suggestions når `PROACTIVE_ENABLED=true`
4. Aldri skriv persondata til public paths

## Utenfor scope
- Autonom kjøring av suggestions uten bruker
- Push-notifikasjoner / bakgrunnsdaemon
- «Always on» agent som handler alene (M3 er *forslag*)

## Filer
```
src/proactive/
  types.ts
  suggest.ts
  index.ts
  AGENTS.md

scripts/smoke-proactive.ts
```

## API

```ts
export interface Suggestion {
  id: string;
  text: string;          // short, actionable, user language
  kind: "followup" | "tool" | "milestone" | "memory";
  confidence: number;    // 0–1 heuristic
}

export interface SuggestInput {
  userPrompt: string;
  assistantReply: string;
  retrievedContext?: string;
  longTermSnippets?: string[];
}

export function suggestNextSteps(
  input: SuggestInput,
  options?: { max?: number; locale?: "nb" | "en" }
): Suggestion[];
```

Første implementasjon kan være **synkron og regelfri for modell** (deterministisk smoke):
- Hvis prompt handler om error/bug → foreslå «kjør relevant smoke / les fil»
- Hvis reply nevner filpath → foreslå read_file / search_files
- Hvis project context traff architecture → foreslå «oppdater context/ hvis beslutning endret»
- Ellers tom liste eller generisk «vil du gå dypere?» kun hvis confidence høy

Valgfri fase: lokal modell omskriver 1–2 forslag kortere — bak flagg `PROACTIVE_USE_MODEL=false` default.

## Integrasjon

I CLI `printResult` / etter `handle`:
```
if (PROACTIVE_ENABLED) {
  const tips = suggestNextSteps(...);
  for (const t of tips) console.log(`[next] ${t.text}`);
}
```

Ikke endre `OrchestratorResult.reply` — suggestions er metadata:
```ts
suggestions?: Suggestion[];
```

## Env
```
PROACTIVE_ENABLED=false
PROACTIVE_MAX=3
PROACTIVE_USE_MODEL=false
```

## Testing
Offline:
1. Bug-like prompt → minst ett followup/tool suggestion
2. Tom/generisk smalltalk → 0 suggestions (eller max 1 lav conf filtrert bort)
3. max respekteres

## Ferdig når
- Smoke passerer
- Default off — ingen støy i vanlig chat
- Ingen privat profil nødvendig

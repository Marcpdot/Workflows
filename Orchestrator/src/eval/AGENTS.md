# Eval Suite Spec (Milestone 1)

## Mål
Ha et minimalt, gjentakbart evalueringsoppsett som måler om orchestratoren (routing, memory, compression) faktisk fungerer — og som kan kjøres på nytt etter endringer.

Ikke et stort test-framework. Bare:
1. Faste cases
2. En runner som kaller orchestratoren
3. Logg med route, model, latency, tokens (hvis tilgjengelig), pass/fail

## Scope
- 8–12 faste `EvalCase` i JSON
- CLI/script: `npx tsx scripts/run-eval.ts`
- Resultater skrevet til `data/eval-results/<timestamp>.json`
- Enkle automatiske assertions (`expectRoute`, `expectContains`)
- Ingen LLM-as-judge ennå

## Utenfor scope
- CI-integrasjon
- LLM-judge / rubric scoring
- Statistisk signifikans / mange runs
- UI for resultater
- Kostnadsberegning i NOK (USD-estimat + tokens er nok; ikke faktura-grade)

## Filer
```
src/eval/
  types.ts          # EvalCase, EvalResult, EvalReport
  runner.ts         # kjør suite mot Orchestrator
  assertions.ts     # expectRoute, expectContains
  index.ts

scripts/
  run-eval.ts       # CLI entry

eval/
  cases.json        # de faste oppgavene
```

## Typer

```ts
export interface EvalCase {
  id: string;
  description?: string;
  prompt: string;
  /** Optional prior turns loaded into memory/history before the prompt */
  sessionSetup?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  expectRoute?: "local" | "frontier";
  /** All strings must appear in the reply (case-insensitive) */
  expectContains?: string[];
  /** If true, force a long sessionSetup so compression is likely */
  forceCompression?: boolean;
}

export interface EvalResult {
  id: string;
  pass: boolean;
  route: string;
  model: string;
  provider: string;
  latencyMs: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  compressed?: boolean;
  replyPreview: string; // first ~200 chars
  failures: string[];   // human-readable reasons
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  results: EvalResult[];
  summary: { total: number; passed: number; failed: number };
}
```

## Runner-oppførsel

For hver case:
1. Opprett midlertidig sessionId (`eval-<id>-<run>`)
2. Hvis `sessionSetup`: legg meldingene i memory (eller send som history)
3. Kall `orchestrator.handle(prompt, { history })` (samme path som CLI)
4. Mål latency
5. Kjør assertions
6. Ikke la en case-feil stoppe hele suiten — fortsett, marker fail

Compression: hvis orchestratoren allerede logger/returnerer compression-info, ta det med i `EvalResult.compressed`. Ellers utelat feltet.

## Assertions (enkle)

- `expectRoute`: sammenlign med `result.routing.model` (eller tilsvarende)
- `expectContains`: hvert element må finnes i `result.reply` (case-insensitive)
- Mangler felt / tom reply → fail med tydelig melding

## cases.json (startsett — kan utvides)

Inkluder minst disse 8:

| id | Hensikt |
|----|--------|
| `route-summarize-local` | Kort «oppsummer X» → expectRoute local |
| `route-research-frontier` | «Undersøk trade-offs mellom …» → expectRoute frontier |
| `memory-name-recall` | sessionSetup med navn, prompt «Hva heter jeg?» → expectContains navnet |
| `memory-fact-recall` | sessionSetup med en fakta, spør om den |
| `norwegian-brief` | Norsk prompt, svar skal inneholde noe fornuftig (expectContains valgfritt) |
| `code-small-local` | Liten code-oppgave → prefer local (expectRoute local hvis router sier det) |
| `reasoning-frontier` | Eksplisitt resonneringsoppgave → expectRoute frontier |
| `compression-smoke` | forceCompression / lang sessionSetup, prompt som krever tidlig fakta → expectContains |

Hold promptene **stabile** (ikke tilfeldige). Endring av cases er en bevisst commit.

## CLI

```bash
npx tsx scripts/run-eval.ts
npx tsx scripts/run-eval.ts --case memory-name-recall
npx tsx scripts/run-eval.ts --json   # skriv report til stdout også
```

Exit code: `0` hvis alle pass, `1` hvis noen fail (nyttig senere i CI).

## Krav til implementasjon
- Bruk eksisterende `Orchestrator`, `loadConfigFromEnv`, memory hvis CLI allerede bruker det
- Ikke hardkod API-nøkler; les `.env` som resten av prosjektet
- Ved manglende `XAI_API_KEY` og case som treffer frontier: marker fail med «missing API key» (ikke crash hele runneren)
- Skriv report til `data/eval-results/` (opprett mappe om nødvendig); legg `data/eval-results/` i `.gitignore` hvis ikke allerede dekket av `data/`
- Eksporter typer fra `src/eval/index.ts`

## Ferdig når
- `npx tsx scripts/run-eval.ts` kjører alle cases og printer summary
- Minst `memory-name-recall` og én route-case passer på en frisk maskin med Ollama
- Report-fil lander på disk
- Feil i én case stopper ikke de andre

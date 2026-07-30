# Orchestrator Agent Spec

## Mål
Bygg en minimal, modulær orchestrator i TypeScript som kan:
1. Motta en brukerforespørsel
2. Analysere oppgaven (type + kompleksitet)
3. Velge mellom lokal modell (Ollama) og frontier-modell
4. Kalle valgt modell
5. Returnere svaret

## Teknologi
- TypeScript
- Node.js
- Ollama CLI (lokal) — `ollama run <model> <prompt>`
- Frontier: xAI Grok (OpenAI-kompatibel Chat Completions API)

## Filer som skal lages
- `src/router.ts`          → routing-logikk
- `src/models/local.ts`    → Ollama-klient
- `src/models/frontier.ts` → Frontier-klient
- `src/orchestrator.ts`    → hovedlogikk
- `src/types.ts`           → delte typer
- `src/index.ts`           → entry point (CLI eller enkel server)

## Routing-regler (Milestone 0)
- low complexity / summarize / tool → lokal modell
- medium code → lokal modell
- high complexity / research / reasoning → frontier

## Krav
- Ren separasjon mellom routing og modell-kall
- Lett å bytte ut både lokal og frontier modell senere
- Minimal avhengighet
- God TypeScript-typing
- Konfigurerbar via miljøvariabler eller enkel config

## Eksempel på typer
```ts
type ModelChoice = "local" | "frontier";

interface RoutingDecision {
  model: ModelChoice;
  reason: string;
  localModel?: string;
  frontierModel?: string;
}
```

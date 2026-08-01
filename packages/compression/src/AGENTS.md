# Context Compression Spec (Milestone 1 — realtime)

## Mål
Minimer tokens som sendes til modellen når samtalehistorikken vokser, uten å miste nok kontekst til å fortsette samtalen fornuftig.

Dette er **realtime-komprimering inne i en aktiv session**. Langtidsminne, embeddings og semantic retrieval er **utenfor scope**.

## Problem
Uten komprimering:
```
Tur 1:  prompt + reply
Tur 2:  history(1) + prompt + reply
Tur N:  history(1..N-1) + prompt   ← vokser lineært, blir dyrt
```

Med komprimering:
```
Tur N:  [summary av gammelt] + [siste K meldinger] + prompt
```

## Krav
1. Når historikken overstiger en terskel: oppsummer eldre meldinger
2. Behold de siste `keepRecent` meldingene uendret (full tekst)
3. Produser én kort summary som representerer det som ble droppet
4. Orchestrator/CLI skal bruke komprimert kontekst før modell-kall
5. Summary genereres med **lokal modell** (billig) — ikke frontier
6. Enkel, testbar API; minimal ny avhengighet

## Teknologi
- TypeScript
- Eksisterende `ChatMessage` og `ModelClient` (bruk lokal client til summarize)
- Ingen ny database for M1 realtime (kan holdes i minne + evt. lagre summary i memory senere)

## Filer som skal lages
```
src/compression/
  types.ts         # CompressionConfig, CompressionResult
  compress.ts      # compressHistory()
  summarize.ts     # kall lokal modell med fixed summarize-prompt
  index.ts         # re-exports
```

## API

```ts
export interface CompressionConfig {
  /** Komprimer når history.length > threshold. Default: 20 */
  threshold: number;
  /** Antall nyeste meldinger som alltid beholdes raw. Default: 8 */
  keepRecent: number;
  /** Maks tegn i summary (soft limit for prompt). Default: 1500 */
  maxSummaryChars?: number;
}

export interface CompressionResult {
  /** null hvis ingen komprimering ble gjort */
  summary: string | null;
  /** Siste keepRecent meldinger, kronologisk (eldste først) */
  recentMessages: ChatMessage[];
  /** true hvis summary ble generert */
  compressed: boolean;
}

/**
 * Komprimer historikk for ett modell-kall.
 * - Hvis messages.length <= threshold: returner summary=null, recentMessages=messages
 * - Ellers: summary over messages.slice(0, -keepRecent), recent = siste keepRecent
 */
export function compressHistory(
  messages: ChatMessage[],
  config: CompressionConfig,
  summarizer: Summarizer
): Promise<CompressionResult>;

/** Pluggable summarizer — i praksis lokal ModelClient */
export interface Summarizer {
  summarize(messages: ChatMessage[]): Promise<string>;
}
```

## Summarize-prompt (fast)

Summarizer skal bruke omtrent denne system/user-strukturen (kan justeres, men hold den kort):

```
System: You compress conversation history. Output a concise summary of facts,
decisions, names, and open threads. No preamble. Max ~12 sentences.

User: Summarize the following conversation turns:

<role>: <content>
...
```

Regler for summary:
- Behold egennavn, tall, beslutninger, filstier, feilmeldinger
- Dropp høflighetsfraser og gjentakelser
- Skriv på samme språk som majoriteten av meldingene (norsk/engelsk)
- Aldri finn opp fakta som ikke står i historikken

## Integrasjon med Orchestrator / CLI

Før `client.complete(...)`:

```ts
const history = await memory.getHistory(sessionId);
const { summary, recentMessages } = await compressHistory(
  history,
  { threshold: 20, keepRecent: 8 },
  localSummarizer
);

const messages: ChatMessage[] = [
  { role: "system", content: config.systemPrompt },
  ...(summary
    ? [{ role: "system" as const, content: `Earlier in this session:\n${summary}` }]
    : []),
  ...recentMessages,
  { role: "user", content: prompt },
];
```

CLI-en skal fortsatt lagre **full** user + assistant-melding i memory (ikke den komprimerte varianten). Komprimering skjer kun ved *lesing* inn mot modell-kallet.

## Konfig via env (valgfritt)

```
COMPRESSION_THRESHOLD=20
COMPRESSION_KEEP_RECENT=8
```

Default i kode hvis env mangler.

## Krav til implementasjon
- `compressHistory` er pure mht. splitting; side effect er kun summarizer-kallet
- Hvis `messages.length <= threshold`: ingen modell-kall, `compressed: false`
- Hvis `keepRecent >= messages.length`: ingen komprimering
- Tom history → tom result, ikke crash
- Summarizer-feil: kast tydelig feil (ikke stille fallback til full history uten logging)
- Eksporter fra `src/compression/index.ts`
- Smoke-test eller enkel script som:
  1. Bygger fake history med > threshold meldinger
  2. Kjører compressHistory
  3. Verifiserer at recentMessages.length === keepRecent og summary er non-empty

## Ikke gjør dette ennå
- Embeddings / vektorstore
- Persistente summary-rader i SQLite (kan komme senere)
- Komprimering av gamle sessions på disk (langtid)
- LLM-as-router endringer
- Streaming
- Token-teller utover enkel char-estimat (valgfritt felt er ok)

## Ferdig når
- Session med 30+ meldinger sender summary + siste 8 i stedet for hele historikken
- «Hva heter jeg?»-testen fungerer fortsatt etter komprimering (navn må overleve i summary eller i recent)
- Lokal modell brukes til summarize, frontier ikke
- Ingen regresjon på memory lagring (full historikk fortsatt i SQLite)

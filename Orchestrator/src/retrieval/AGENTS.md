# Retrieval Spec (Milestone 1 — minimal)

## Mål
Gi orchestratoren evne til å **hente relevant kontekst** utover «siste N meldinger + compression summary», uten å bygge full vektorstore ennå.

M1-retrieval er **deterministisk + lettvekts**, ikke semantic search med embeddings. Embeddings / vector DB er eksplisitt Milestone 2+ (eller senere memory-lag).

## Problem
Compression beholder summary + recent. Det er ikke nok når:
- Brukeren spør om noe som ble sagt for lenge siden og falt ut av summary
- Brukeren spør om *prosjekt-beslutninger* som ligger i `context/` (Keep the Why), ikke i chat-historikk
- Eval/caser krever at «hvorfor ingen embeddings i M0?» kan besvares fra repo-kunnskap

## To retrieval-kilder (M1)

| Kilde | Hva | Hvordan |
|-------|-----|--------|
| **A. Session memory** | Eldre chat-meldinger i SQLite | Keyword / enkel rank over `getHistory` (eller utvidet query) |
| **B. Project context** | `context/*.md` (Keep the Why) | Les index + match topic-filer på keywords fra prompt |

Begge returnerer korte tekstsnutter som kan legges inn som ekstra `system`-meldinger før modell-kallet.

## Krav
1. `retrieve(query, options) → RetrievedChunk[]`
2. Orchestrator/CLI kan kalle retrieval **før** compression + model call
3. Maks antall chunks og maks total chars (unngå å sprenge prompten)
4. Ingen embeddings, ingen nye tunge dependencies
5. Testbar uten nettverk (fake fs / in-memory messages)

## Filer
```
src/retrieval/
  types.ts           # RetrievedChunk, RetrieveOptions
  session.ts         # keyword retrieval over ChatMessage[]
  projectContext.ts  # read context/index.md + topic files
  retrieve.ts        # combine sources, rank, truncate
  index.ts
```

## API

```ts
export interface RetrievedChunk {
  source: "session" | "project_context";
  id: string;           // e.g. message id or relative path
  text: string;         // already truncated snippet
  score: number;        // higher = more relevant (simple)
}

export interface RetrieveOptions {
  /** Max chunks to return. Default 4 */
  limit?: number;
  /** Max total characters across all chunks. Default 2000 */
  maxChars?: number;
  /** Enable session keyword search. Default true */
  session?: boolean;
  /** Enable context/ file search. Default true */
  projectContext?: boolean;
  /** Absolute or cwd-relative path to context dir. Default "../context" or repo context/ */
  contextDir?: string;
  /** Full session history to search (caller provides from memory) */
  sessionMessages?: ChatMessage[];
}

export function retrieve(
  query: string,
  options?: RetrieveOptions
): Promise<RetrievedChunk[]>;
```

## Ranking (enkelt, deterministisk)

1. Tokenize query: lowercase, split på non-alphanumeric, drop stopwords (liten hardkodet liste for no/en)
2. For hver kandidat-tekst: score = antall unike query-tokens som finnes i teksten (evt. +bonus hvis alle tokens matcher)
3. Sorter score desc, ta top `limit`, trim til `maxChars`

Session-kandidater: hver melding (eller window av 2–3) som egen chunk.  
Project-kandidater: hver `context/*.md` (hopp over README hvis ønskelig); bruk filens tekst.

Tom query eller ingen treff → `[]` (ikke feil).

## Integrasjon med Orchestrator / CLI

Før compress + complete:

```ts
const history = await memory.getHistory(sessionId);
const chunks = await retrieve(prompt, {
  sessionMessages: history,
  contextDir: resolveRepoContextDir(), // f.eks. path to Workflows/context
  limit: 4,
  maxChars: 2000,
});

const retrievalBlock =
  chunks.length === 0
    ? null
    : chunks.map((c) => `[${c.source}] ${c.text}`).join("\n\n");

const { summary, recentMessages } = await compressHistory(history, cfg, summarizer);

const messages = [
  { role: "system", content: systemPrompt },
  ...(retrievalBlock
    ? [{ role: "system" as const, content: `Retrieved context:\n${retrievalBlock}` }]
    : []),
  ...(summary
    ? [{ role: "system" as const, content: `Earlier in this session:\n${summary}` }]
    : []),
  ...recentMessages,
  { role: "user", content: prompt },
];
```

Rekkefølge: **retrieval → compression → model**. Retrieval ser full history; compression reduserer det som sendes som «chat».

## Env (valgfritt)
```
RETRIEVAL_LIMIT=4
RETRIEVAL_MAX_CHARS=2000
RETRIEVAL_CONTEXT_DIR=../../context
RETRIEVAL_DISABLED=false
```

## Krav til implementasjon
- Pure-ish funksjoner; fs-lesing isolert i `projectContext.ts`
- Graceful hvis `context/` mangler (tom liste, ikke crash)
- Ingen network
- Smoke script: `scripts/smoke-retrieval.ts`
  - session keyword treffer forventet melding
  - project context treffer en kjent frase fra `context/memory.md` eller tilsvarende når fil finnes
  - limit/maxChars respekteres
- Eksporter fra `src/retrieval/index.ts`

## Ikke gjør dette ennå
- Embeddings / vector DB / cosine similarity
- Hybrid BM25-bibliotek (hold det dependency-fritt)
- Skrive tilbake til memory fra retrieval
- Web search retrieval
- LLM-basert re-ranking

## Ferdig når
- `retrieve("embeddings Milestone 0")` kan surface innhold fra `context/memory.md` når repo-context er tilgjengelig
- `retrieve` med sessionMessages finner navn/fakta i eldre meldinger via keywords
- Orchestrator/CLI kan skru det på uten å øke tokens ukontrollert (maxChars)
- Smoke-retrieval passerer offline

# Memory Agent Spec (Milestone 0)

## Current contract — Continuous Cognition WP1

The package now owns a durable raw-experience spine in addition to the original
session-history API. Preserve these invariants:

- An experience records source activity, not accepted semantic truth.
- Stable experience IDs and exact inline content or an external `payloadRef`
  must survive restart.
- Session, workspace, and source metadata improve context but are optional;
  project/task selection is never required.
- New persisted chat turns atomically create both an experience and the existing
  `messages` compatibility row. Keep `add()` and `getHistory()` working.
- Tool calls/results that affect reasoning must be recorded before a later model
  step consumes them.
- Semantic extraction and knowledge proposals reference source experience IDs;
  they never replace or mutate the raw source.
- Keep the SQLite/Memory lifecycle unless a demonstrated scaling or modality
  requirement makes a separate store necessary.

The Milestone 0 material below remains the compatibility baseline; where its
minimal scope conflicts with the current contract above, the current contract
wins.

## Mål
Implementer et minimalt minnesystem som lar orchestratoren beholde samtalekontekst på tvers av modellbytter og restarts.

Dette startet som **korttidsminne + enkel persistering**. Embeddings og varig
experience-lagring er senere, separate utvidelser av den kompatible kontrakten.

## Krav
1. Kunne lagre og hente samtalehistorikk per session
2. Orchestratoren skal kunne sende historikk inn i `handle()`
3. Historikken skal overleve restart (SQLite)
4. Enkel, testbar API
5. Minimal avhengighet (bruk `better-sqlite3` eller `sql.js`)

## Teknologi
- TypeScript
- SQLite (via `better-sqlite3` anbefalt, eller `sql.js` hvis pure JS ønskes)
- Skal integreres med eksisterende `Orchestrator` og `ChatMessage`-type

## Filer (etter package refactor Step C)
```
packages/memory/src/
  types.ts      # Memory-spesifikke typer
  store.ts      # SQLite-lagring (lavnivå)
  memory.ts     # Hoved-API som orchestratoren bruker
  index.ts      # Re-exports
  longterm/     # LTM API (3A+)
```

## API som skal eksponeres

```ts
interface Memory {
  /** Legg til en melding i en session */
  add(sessionId: string, message: ChatMessage): Promise<void>;

  /** Hent historikk for en session (eldste først). limit = maks antall meldinger. */
  getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]>;

  /** Slett all historikk for en session */
  clear(sessionId: string): Promise<void>;

  /** Lukk database-tilkobling (for ryddig shutdown) */
  close(): void;
}
```

## Database-skjema (minimalt)

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'system' | 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL  -- unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
```

## Integrasjon med Orchestrator

Orchestratoren skal kunne brukes slik:

```ts
const memory = createMemory({ dbPath: "./data/memory.db" });
const sessionId = "default"; // eller generer UUID

const history = await memory.getHistory(sessionId, 20);
const result = await orch.handle(prompt, { history });

await memory.add(sessionId, { role: "user", content: prompt });
await memory.add(sessionId, { role: "assistant", content: result.reply });
```

## Krav til implementasjon
- `createMemory(config)` factory-funksjon
- Database-fil opprettes automatisk hvis den ikke finnes
- `getHistory` returnerer meldinger i kronologisk rekkefølge (eldste først)
- `limit` default = 50 (eller konfigurerbart)
- Ingen system-meldinger skal lagres automatisk med mindre de eksplisitt legges til
- Feilhåndtering: kast tydelige feil ved DB-problemer
- Eksporter typer og factory fra `src/memory/index.ts`

## Ikke gjør dette ennå
- Embeddings / semantic search
- Oppsummering av gammel kontekst
- Multi-user auth
- Kryptering
- Generelt migreringsrammeverk utover den avgrensede compatibility-migreringen
  som gir eksisterende meldinger stabile experience-ID-er

## Ferdig når
- Man kan starte en samtale, restarte prosessen, og fortsette med samme sessionId uten å miste historikk
- Orchestratoren kan ta imot `history` fra memory og sende det til lokal/frontier modell

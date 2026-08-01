# Milestone 3A — Long-term memory API

## Mål
Gi et **utskiftbart langtidsminne** for fakta/preferanser/prosjektstatus som overlever sessions — uten å putte personlig innhold i public repo.

Korttidsminne (SQLite session history fra M0) forblir uendret.

## Privacy

| OK i public repo | Ikke i public repo |
|------------------|--------------------|
| Interface, SQLite schema, tests med *fake* data | Ekte profil, helse, økonomi, relasjoner |
| `data/longterm.example.db` tom/demo | `PERSONAL_CONTEXT_DIR` innhold |
| Docs som sier «pek på privat path» | Committed `profile.md` med persondata |

Default storage path:
```
LONGTERM_DB_PATH=./data/longterm.db   # under Orchestrator/data — gitignore data/
# eller
PERSONAL_CONTEXT_DIR=/path/outside/repo
```

Sørg for at `data/*.db` og `PERSONAL_CONTEXT_DIR` ikke trackes av git.

## Scope
1. `LongTermMemory` interface: `remember`, `recall`, `list`, `forget`, `close`
2. SQLite backend (reuse better-sqlite3 pattern from short-term)
3. Enkel keyword/`key` recall — **ikke** embeddings i 3A
4. Factory `createLongTermMemory(config)`
5. Valgfri CLI: `/remember`, `/recall` eller `--ltm`
6. Smoke med midlertidig DB-fil (slettes etter test)

## Utenfor scope
- Embeddings / vector search (senere)
- Automatisk ekstrahering av fakta fra hver chat-tur (kan være 3B+)
- Sync på tvers av maskiner
- Kryptering at rest (dokumenter som fremtidig mulighet)

## Filer
```
src/memory/longterm/
  types.ts
  store.ts      # SQLite
  memory.ts     # API
  index.ts
  AGENTS.md

scripts/smoke-longterm.ts
```

## API

```ts
export interface MemoryFact {
  id: string;
  key?: string;          // optional stable key e.g. "user.preferred_name"
  content: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  source?: string;       // "user" | "system" | "import"
}

export interface LongTermMemory {
  remember(input: {
    content: string;
    key?: string;
    tags?: string[];
    source?: string;
  }): Promise<MemoryFact>;

  /** If key set, upsert by key; otherwise always insert */
  recall(query: {
    key?: string;
    text?: string;       // keyword match on content
    tags?: string[];
    limit?: number;
  }): Promise<MemoryFact[]>;

  list(limit?: number): Promise<MemoryFact[]>;

  forget(idOrKey: string): Promise<boolean>;

  close(): void;
}

export function createLongTermMemory(config: {
  dbPath: string;
}): LongTermMemory;
```

## Schema (minimalt)

```sql
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  content TEXT NOT NULL,
  tags TEXT,              -- JSON array
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(key);
```

Keyword `text` search: SQL `LIKE %token%` for simple tokens (good enough for 3A).

## Integrasjon (lett)

- `Orchestrator` trenger **ikke** auto-injisere LTM i hver prompt i 3A
- Eksponer `orch.longTerm` eller CLI helpers
- Senere (3B): proaktivitet / handle() kan `recall` basert på prompt keywords

Optional system-injection behind flag:
```
LONGTERM_AUTO_INJECT=false
```
Når true: top-N recall for prompt tokens legges som system block (max chars cap).

## Env
```
LONGTERM_DB_PATH=./data/longterm.db
LONGTERM_AUTO_INJECT=false
LONGTERM_INJECT_MAX_CHARS=1500
```

## Testing
`smoke-longterm.ts`:
1. remember + recall by key
2. remember without key + recall by text
3. forget
4. upsert same key updates content
5. DB file in temp path, delete after

## Ferdig når
- Smoke passerer
- Ingen persondata i repo
- Short-term memory uendret
- Klar for 3B som *konsument* av `recall`

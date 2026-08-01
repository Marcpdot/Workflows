# Milestone 4 — Embeddings / semantisk minne

## Mål
Gjøre retrieval og langtidsminne **semantisk** der keyword ikke strekker til — uten å fjerne dagens keyword-path.

```
tekst → embedding-vektor → lagre / søk (cosine eller tilsvarende)
```

## Prinsipper
1. **Pluggable embedder** — local (Ollama) først; HTTP/API embedder mulig senere
2. **Keyword-fallback** forblir — embeddings er tillegg, ikke hard dependency for hele systemet
3. **Privacy** — vektorer for personlig LTM følger samme path-regler som 3A (`LONGTERM_DB_PATH` / utenfor git)
4. **Minimalt** — ingen tung vektordatabase-avhengighet i første cut (SQLite + float-blob eller JSON er OK)

## Scope
1. `Embedder`-interface + minst én implementasjon (Ollama embeddings API eller tilsvarende local)
2. Vektorlagring for:
   - langtidsminne-fakta (koble til eksisterende LTM)
   - valgfritt: chunks fra `context/*.md` og/eller session-meldinger for retrieval
3. `semanticSearch(query, limit) → treff med score`
4. Integrasjon i retrieval: hybrid eller «semantic first, keyword fallback»
5. Env-flagg; default kan være av til embedder er konfigurert
6. Offline/unit-testbar der mulig (mock embedder med faste vektorer)

## Utenfor scope
- Cloud-only embedding som eneste path
- Full RAG-pipeline med rerankers
- GPU-spesifikk tuning
- Erstatte short-term chat history med kun vektorer
- UI for embedding-debug (kan komme under M8)

## Filer (foreslått)
```
src/embeddings/
  types.ts          # Embedder, VectorHit, EmbeddingConfig
  cosine.ts         # similarity helper
  ollamaEmbedder.ts # local embedder
  mockEmbedder.ts   # deterministic for smoke
  store.ts          # SQLite vectors (or side table)
  search.ts         # semanticSearch
  index.ts
  AGENTS.md

scripts/smoke-embeddings.ts
```

Eventuelt utvid `packages/memory` (longterm) og `src/retrieval/` i stedet for all ny kode under embeddings/ — viktigst er rene interfaces.

## API

```ts
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorRecord {
  id: string;
  source: "ltm" | "context" | "session" | string;
  refId: string;       // fact id, file path, message id, …
  text: string;        // original snippet (for display)
  vector: number[];
  createdAt: number;
}

export interface VectorHit {
  record: VectorRecord;
  score: number;       // higher = more similar (cosine)
}

export interface VectorStore {
  upsert(record: Omit<VectorRecord, "createdAt"> & { createdAt?: number }): Promise<void>;
  deleteByRef(source: string, refId: string): Promise<void>;
  search(
    queryVector: number[],
    options?: { limit?: number; source?: string; minScore?: number }
  ): Promise<VectorHit[]>;
  close(): void;
}

export async function semanticSearch(
  query: string,
  deps: { embedder: Embedder; store: VectorStore },
  options?: { limit?: number; source?: string; minScore?: number }
): Promise<VectorHit[]>;
```

## Embedder (local)

- Ollama: typisk `POST /api/embeddings` med modell som `nomic-embed-text` eller det som er dokumentert for installert Ollama
- Batch `embed(texts[])` der API støtter det; ellers sekvensielt
- Timeout og tydelig feil hvis Ollama/modell mangler
- Env: `EMBEDDING_MODEL`, `OLLAMA_BASE_URL` (gjenbruk eksisterende om mulig)

## Storage

Minimum: SQLite-tabell

```sql
CREATE TABLE IF NOT EXISTS vectors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  text TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,  -- Float32 array
  created_at INTEGER NOT NULL,
  UNIQUE(source, ref_id)
);
```

- Ingen krav om sqlite-vss i M4 (linear scan er OK for små N)
- Dokumenter at ANN-index kan komme senere når N vokser

## Integrasjon

### Long-term memory
- Ved `remember`: hvis embeddings enabled → embed `content` og `upsert` vector med `source=ltm`, `refId=fact.id`
- Ved `forget`: slett tilhørende vector
- Ved `recall` med tekst: valgfritt semantic path i tillegg til LIKE

### Retrieval
- Utvid eksisterende retrieval med semantic treff fra `context/` og/eller session
- Merg score-lister (enkel RRF eller weighted) **eller** semantic-first med keyword fallback hvis 0 treff
- Behold `RETRIEVAL_*` env; legg til:

```
EMBEDDINGS_ENABLED=false
EMBEDDING_MODEL=nomic-embed-text
VECTOR_DB_PATH=./data/vectors.db
EMBEDDINGS_MIN_SCORE=0.3
```

Default **off** til modell er tilgjengelig — systemet skal ikke krasje uten embedder.

## Testing

`smoke-embeddings.ts`:
1. Mock embedder: like tekster → høy cosine; ulike → lavere
2. Upsert + search returnerer forventet ref
3. deleteByRef fjerner treff
4. Med `EMBEDDINGS_ENABLED=false` / manglende embedder: retrieval/LTM oppfører seg som i dag (keyword)

Valgfri live-smoke bak flagg hvis Ollama + embed-modell finnes.

## Krav til implementasjon
- Ikke bryt M1 retrieval eller M3A LTM når embeddings er av
- Ingen persondata i public git
- TypeScript, unngå tunge nye deps om mulig
- Linear scan dokumentert som bevisst M4-valg

## Ferdig når
- Embedder + store + semanticSearch finnes
- Smoke med mock passerer
- LTM og/eller retrieval kan bruke semantic path når enabled
- Keyword-path fungerer uendret når disabled

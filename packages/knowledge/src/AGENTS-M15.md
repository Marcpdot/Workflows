# Milestone 15 — Identity, merge & contradiction

## Mål

Hindre at grafen **råtner** når volumet vokser: samme konsept under mange labels, og motsigelser uten synlighet.

## Scope

1. **Aliases** — tabell eller edges `alias_of` / `same_as`; resolve label → canonical node
2. **Merge** — `mergeNodes(fromId, intoId)`: flytt edges, marker from as merged/rejected, bevar proveniens
3. **Duplicate detect** — ved propose/accept: foreslå merge eller skip når fuzzy/normalised label match (start simple: lower-case trim; optional diacritics)
4. **Contradiction** — edge eller claim-pair med `contradicts`; `findContradictions(nodeId?)` lister åpne par
5. **Revision** — claim kan få `superseded_by` / ny claim uten å slette historie
6. **Tools** — `knowledge_merge`, `knowledge_add_alias`, `knowledge_find_contradictions`
7. **Smoke** — to labels → alias/merge → neighborhood stabil; contradicts listes

## Utenfor scope

- Full NLP entity resolution / embeddings-only identity (optional later enhancement)
- Automatic truth arbitration (system flags; human or policy decides)
- Ingest (M14) endringer utover å kalle identity-check hooks
- UI graph of contradictions (M17 can display)

## Schema additions (minimal)

```sql
CREATE TABLE IF NOT EXISTS knowledge_aliases (
  id TEXT PRIMARY KEY,
  alias_label TEXT NOT NULL,
  canonical_node_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(alias_label)
);
-- superseded_by optional column on nodes or as edge relation "supersedes"
```

## Policy

Merge og contradiction-markering er **eksplisitte** handlinger (tool/CLI). Auto-flag ved accept kan foreslå proposal «possible duplicate» uten å merge.

## Ferdig når

- [x] alias + merge fungerer med edge-rewire
- [x] findContradictions returnerer stabile resultater
- [x] propose/accept path kan unngå trivial duplicates
- [x] smoke passerer
- [x] ingen silent delete av historie

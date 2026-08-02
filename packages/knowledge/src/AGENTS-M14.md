# Milestone 14 — Continuous / batch ingest

## Mål

La grafen **vokse fra daglig arbeid** uten at hver chat-tur skriver blindt til permanent store.

M11–M13: manuell/CLI/tool propose → accept.  
M14: batch eller segment fra samtale/fil → **proposals** automatisk, med tydelig gate før accept.

## Scope

1. **Ingest API** — `ingestText({ text, sourceType, sourceRef, workspaceId?, projectLabel? })` → event + proposals
2. **Batch fil** — markdown/tekstfil → samme path
3. **Chat-segment hook (opt-in)** — etter N turer eller eksplisitt `/knowledge ingest` / tool: hent siste segment fra short-term memory → ingest som proposals
4. **Dedup light** — ikke foreslå node som allerede finnes accepted med same type+label (skip or propose edge only)
5. **CLI** — `--knowledge ingest --text "..."` / `--file path`
6. **Tool** — `knowledge_ingest` (text or path under workspace)
7. **Smoke** — fil/fixture → pending proposals uten auto-accept; andre gang samme label → færre duplikat-node proposals

## Utenfor scope

- Auto-accept / policy engine som committer uten menneske (senere)
- Full continuous every-turn silent extract (for støyende; segment eller explicit)
- Alias-merge og contradiction (M15)
- FP-template (M16)
- UI / voice

## Policy

```
KNOWLEDGE_INGEST_ENABLED=false
KNOWLEDGE_INGEST_AUTO_ON_CHAT=false   # if true: still proposals only, never accept
KNOWLEDGE_INGEST_MIN_CHARS=80
```

Default: ingest kun via CLI/tool. Chat auto er eksplisitt opt-in og **kun proposals**.

## Extraction

Prefer `runExtraction` + structured output when model available; fallback heuristic only for offline smoke. Reuse M11 `applyExtractionResult`.

Optional: if `projectLabel` set, after proposals created, do not auto-link; include project label in event sourceRef or payload hint for M13 link later.

## Ferdig når

- [x] ingestText + file path works → pending only
- [x] tool + CLI documented
- [x] smoke offline passes
- [x] no silent accept
- [x] auto-on-chat default false

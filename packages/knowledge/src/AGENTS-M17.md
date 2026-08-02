# Milestone 17 — Read surface

## Mål

Gjøre grafen **navigerbar** uten 3D-UI: stabil read-API / CLI / enkel visning for undergrafer og prosjektstatus.

## Scope

1. **Read API** (library + optional HTTP under existing integration):
   - `GET`-style helpers: node, neighborhood, project status, contradictions (om M15), search
2. **CLI polish** — table/text and `--json` for all read paths; pipe-friendly
3. **Compact renderers** — markdown or ASCII subgraph; project status report
4. **Optional minimal static HTML** — single-page list/search/neighborhood (no framework required); or defer HTML if CLI+JSON enough for “done”
5. **Smoke** — status/neighborhood JSON schema stable across calls

## Utenfor scope

- Full SPA / React graph editor
- 3D “Stark” visualization
- Collaborative multi-user hosting
- Write UI (accept can stay CLI/tool)

## Design

Read surface **konsumerer** M11–M16 API; ingen ny truth model.  
HTTP, hvis aktivert, bak samme token-gate som eksisterende integration.

```
KNOWLEDGE_HTTP_READ=false
```

## Ferdig når

- [ ] library read helpers documented
- [ ] CLI read paths consistent (`--json`)
- [ ] one subgraph render path (text or minimal HTML)
- [ ] smoke on read stability
- [ ] no requirement for heavy frontend toolchain

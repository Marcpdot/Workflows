# Milestone 6 — Grensesnitt

## Mål
Bedre interaksjon enn rå CLI — **UI er et skall**, ikke en ny hjerne.

```text
[ TUI / web ]
      ↓
  samme Orchestrator.handle / integration-kontrakt
```

## Prinsipper
1. All logikk forblir i Orchestrator (og M5-flate når den finnes)
2. UI viser mer enn bare `reply`: route, tools, suggestions, latency — uten å overvelde
3. Start **minimalt** — én flate godt, ikke to halvferdige
4. Uavhengig av M4; kan bruke M5 HTTP hvis den finnes, ellers in-process kall

## Anbefalt scope (velg én primær i implementasjon)

### Alternativ A — Enkel web (anbefalt hvis M5 HTTP finnes eller bygges sammen)
- Lokal side: chat-historikk, input, metadata-panel (route/model/tools)
- Snakker med `POST /v1/chat` eller direkte `Orchestrator` i samme prosess
- Ingen innlogging i M6; bind localhost

### Alternativ B — TUI (terminal UI)
- F.eks. enkel blessed/ink/rå alternate-screen
- Session, scrollbar for historikk, tydelig statuslinje
- Passer godt hvis du lever i terminalen

**Spec-krav:** Implementer **minst ett** av A eller B. Dokumenter valget i README.

## Felles funksjonelle krav
1. Send melding → se svar
2. Se aktiv `sessionId` (og bytt hvis enkelt)
3. Vis metadata når tilgjengelig: provider/model, latency, compression on/off, tool steps
4. Vis `[next]` suggestions hvis proaktivitet er på
5. Feil vises lesbart (manglende Ollama, missing API key, …)
6. Ikke lagre persondata i public paths via UI

## Utenfor scope
- Stemme / wake-word
- Mobilapp
- Multi-user accounts
- Rich markdown editor / notebook
- Erstatte CLI (CLI forblir)

## Filer (skisse)
```
src/ui/
  AGENTS.md
  # web:
  web/server.ts      # static + optional proxy til orchestrator
  web/public/…       # minimal HTML/JS eller lett build
  # eller tui:
  tui/app.ts

scripts/smoke-ui.ts  # smoke: server starter / health, eller tui smoke begrenset
```

Hold avhengigheter lette. Unngå tung frontend-stack i M6 med mindre det er sterk grunn.

## Integrasjon

| M5 status | UI skal … |
|-----------|-----------|
| M5 merget med HTTP | Bruk `/v1/chat` + `/health` |
| M5 kun CLI | Spawn CLI med `--json` **eller** kall Orchestrator in-process |
| M5 ikke ferdig | In-process Orchestrator er OK; ikke blokker M6 på M5 |

## Env
```
UI_ENABLED=true
UI_PORT=8787
UI_HOST=127.0.0.1
WORKSPACE_ROOT=
SESSION_ID=
```

## Testing
- Web: server starter, health/chat happy path med mock eller local orchestrator
- TUI: begrenset automatisert smoke (import/boot); manuell sjekk OK å dokumentere
- Regresjon: `npx tsx src/index.ts` CLI uendret

## Ferdig når
- Én brukbar flate (web eller TUI) over samme orchestrator
- Metadata synlig for minst model/route
- README beskriver hvordan starte UI
- CLI fortsatt default for scripts/CI

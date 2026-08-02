# Arkitektur

## Orchestration
Ansvar:
- Motta brukerforespørsel
- Analysere oppgavetype og kompleksitet
- Velge modell (lokal via Ollama eller frontier via API)
- Kalle riktig modell
- Håndtere kontekst / memory
- Returnere svar

Skal starte som enkel regelbasert router og senere kunne bli mer intelligent.

## Memory
Korttid: samtale + midlertidig kontekst  
Langtid: vektorstore + strukturert minne (fakta, preferanser, tidligere beslutninger, prosjektstatus)  
Arbeidsminne for pågående oppgaver  
Dette er det viktigste laget for å ikke miste progresjon når du bytter modell.

Personlig innhold (profil, private preferanser) lagres utenfor public repo (f.eks. `PERSONAL_CONTEXT_DIR` / gitignored DB).

## Knowledge (planlagt)
Semantisk verdensmodell over plain facts: konsepter, påstander (claims), relasjoner, hendelser, proveniens og usikkerhet.  
Rå samtaler/analyser → structured extraction → forslag → godkjenning → graf/store.  
Støtter first-principles-resonnering og prosjektstatus uten å erstatte short-term/LTM.  
Se `context/knowledge.md` og Milestone 11.

## Tool
Alle eksterne evner (kodekjøring, filsystem, web, kalkulator, dine egne quant-modeller, hardware-grensesnitt senere) går gjennom et felles tool-interface. Modellene snakker bare med tools, ikke direkte med verden.

## Evaluation
Faste test-suites + løpende scoring. Når du bytter modell eller endrer prompt/agent, kjører du evaluering automatisk.

## Interface
CLI + eventuelt enkel web/UI. Jarvis-følelsen kommer via tekst/stemme + proaktivitet over tid.

---

## Milestone 0 - Fundament
- Velge lokal runtime
- Sett opp en enkel orchestrator som kan snakke med både lokale modeller og minst én frontier-API
- Implementer et minimalt memory-system (f.eks. SQLite + embeddings)
- Få til å bytte modell midt i en samtale uten å miste kontekst

## Milestone 1 - Token-effektivitet + evaluering
- Bygg kontekst-komprimering og retrieval
- Lag 8–12 faste evalueringsoppgaver (kode, research, resonnering, dine egne domener)
- Mål tokens, kvalitet og kostnad per oppgave

## Milestone 2 - Tools + modularitet
- Standardiser tool-interface
- Legg til de viktigste tools (kode, filer, søk, dine egne scripts)
- Sørg for at alt er utskiftbart

## Milestone 3 - Jarvis-retning
- Proaktivitet (systemet foreslår neste steg)
- Multi-agent når det trengs
- Bedre langtidsminne-API (personlig modell utenfor public repo)

## Milestone 4 - Embeddings / semantisk minne
- Vektor-embeddings for langtidsminne og retrieval
- Erstatt eller utvid ren keyword-matching der det gir bedre treff
- Behold mulighet for enkelt keyword-fallback

## Milestone 5 - Integrasjonsflate ut
- Stabil måte for andre prosjekter/mapper å bruke Workflows (CLI-kontrakt og/eller tynn API)
- Tydelig workspace-/kontekst-grense slik at flere repos kan henge på samme lag

## Milestone 6 - Grensesnitt
- Bedre interaksjon enn rå CLI (enkel TUI og/eller web)
- Samme orchestrator under; UI er et skall, ikke en ny hjerne

## Milestone 7 - Compute-policy
- Regler for local vs mid-tier API vs frontier
- Budsjett/tak og enkel kostnadsstyring (når det lønner seg å betale for tokens)

## Milestone 8 - Observability
- Enkel logg/telemetri: route, modell, tokens, latency, tool-kall
- Nok innsikt til å se hvordan systemet faktisk oppfører seg over tid

## Milestone 9 - Session / workspace-modell
- Flere prosjekter eller workspaces uten å blande kontekst
- Tydelig separasjon av session, project context og personlig langtidsminne

## Milestone 10 - Structured output
- Påliteligere strukturerte svar (JSON/planer) fra modeller
- Støtte for tools, pipeline og evaluering som er avhengig av parsebar output

## Milestone 11 - Semantic knowledge model
- Eksplisitte konsepter, påstander, relasjoner, hendelser og proveniens (SQLite-shell)
- Extraction via structured output → forslag → godkjenning → lagring
- Hent lokal undergraf (neighborhood); ingen krav om Neo4j/UI/stemme i første shell
- Detaljer: `context/knowledge.md`

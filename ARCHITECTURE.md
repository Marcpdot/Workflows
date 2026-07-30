# Arkitektur
# Orchestration
Bestemmer hvilken modell (lokal eller frontier) som skal brukes til hvilken oppgave. Kan starte enkelt (regelbasert) og senere bli mer intelligent.

# Memory
Korttid: samtale + midlertidig kontekst
Langtid: vektorstore + strukturert minne (fakta, preferanser, tidligere beslutninger, prosjektstatus)
Arbeidsminne for pågående oppgaver
Dette er det viktigste laget for å ikke miste progresjon når du bytter modell.

# Tool
Alle eksterne evner (kodekjøring, filsystem, web, kalkulator, dine egne quant-modeller, hardware-grensesnitt senere) går gjennom et felles tool-interface. Modellene snakker bare med tools, ikke direkte med verden.

# Evaluation
Faste test-suites + løpende scoring. Når du bytter modell eller endrer prompt/agent, kjører du evaluering automatisk.

# Interface
CLI + eventuelt enkel web/UI i starten. Jarvis-følelsen kommer senere via stemme/tekst + proaktivitet.


# Milestone 0 - Fundament
- Velge lokal runtime
- Sett opp en enkel orchestrator som kan snakke med både lokale modeller og minst én frontier-API
- Implementer et minimalt memory-system (f.eks. SQLite + embeddings)
- Få til å bytte modell midt i en samtale uten å miste kontekst


# Milestone 1 - Token-effektivitet + evaluering
- Bygg kontekst-komprimering og retrieval
- Lag 8–12 faste evalueringsoppgaver (kode, research, resonnering, dine egne domener)
- Mål tokens, kvalitet og kostnad per oppgave


# Milestone 2 - Tools + modularitet
- Standardiser tool-interface
- Legg til de viktigste tools (kode, filer, søk, dine egne scripts)
- Sørg for at alt er utskiftbart


# Milestone 3 - Jarvis-retning
- Proaktivitet (systemet foreslår neste steg)
- Multi-agent når det trengs
- Bedre langtidsminne og personlig modell av deg

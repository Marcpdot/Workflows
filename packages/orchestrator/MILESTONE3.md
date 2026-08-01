# Milestone 3 — Jarvis-retning

## Prinsipper

1. **Public repo = kode og system-kunnskap.** Ikke personlig biografi, helse, økonomi eller private preferanser.
2. **Personlig kontekst** peker til path *utenfor* git (`PERSONAL_CONTEXT_DIR`, gitignored DB, privat repo).
3. Implementer **én fase om gangen** (3A → 3B → 3C). Ikke bland faser i samme implementasjons-PR.

## Faser

| Fase | Innhold | Spec |
|------|---------|------|
| **3A** | Langtidsminne-API + privat storage-path | [packages/memory/src/longterm/AGENTS.md](../packages/memory/src/longterm/AGENTS.md) |
| **3B** | Proaktivitet (foreslåtte neste steg) | [src/proactive/AGENTS.md](src/proactive/AGENTS.md) |
| **3C** | Minimalt multi-agent (roller) | [src/agents/AGENTS.md](src/agents/AGENTS.md) |

## Rekkefølge for Grok Build

```text
1. Implementer KUN 3A fra packages/memory/src/longterm/AGENTS.md
2. Smoke grønn → deretter KUN 3B
3. Smoke grønn → deretter KUN 3C
```

## Ferdig Milestone 3 når

- Langtidsminne kan lagre/hente fakta uten at innholdet ligger i public git
- Systemet kan foreslå neste steg basert på session + project context (ikke privat profil påkrevd)
- Minst to roller kan kjøres sekvensielt via samme tools/orchestrator
- Eksisterende M0–M2 paths uendret når nye flagg er av

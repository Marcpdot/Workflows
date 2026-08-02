# Milestone 18 — Voice / multimodal I/O (optional)

## Mål

**Interface-lag:** tale (og evt. enkel multimodal input) til de *samme* knowledge-tools og orchestrator-paths som tekst.

Ingen egen “voice brain”. M18 er I/O-adapter.

## Scope

1. **STT → text** — pluggbar provider (local Whisper-class or cloud); output = vanlig user message
2. **Text → orchestrator** — existing `handle()` / tool loop / knowledge tools
3. **TTS ← reply** — pluggbar; default off
4. **Session mode** — `workflows voice` eller flag: lytt → svar → valgfri speak
5. **Smoke** — mock STT/TTS adapters; assert text path identical to non-voice

## Utenfor scope

- New knowledge representation
- Always-on ambient agent without wake policy
- Visual scene understanding as core requirement (optional later)
- Replacing CLI/tools

## Policy

```
VOICE_ENABLED=false
VOICE_STT_PROVIDER=mock|local|cloud
VOICE_TTS_PROVIDER=off|local|cloud
VOICE_LANGUAGE=nb-NO  # or en
```

Privacy: prefer local STT when possible; document when audio leaves machine.

## Architecture

```
audio in → STT adapter → string
                 ↓
         Orchestrator.handle / tools
                 ↓
         string reply → TTS adapter → audio out
```

Knowledge propose/accept policy **uendret**.

## Ferdig når

- [x] mock adapters + one real provider path documented
- [x] voice session uses same tools as text
- [x] default off; no surprise mic use
- [x] smoke with mocks passes
- [x] marked optional in milestones if deferred

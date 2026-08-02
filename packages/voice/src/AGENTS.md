# @workflows/voice (Milestone 18)

Optional **I/O adapters** only: speech-to-text → string → `Orchestrator.handle` → optional TTS.

No separate knowledge/voice brain. Propose/accept policy unchanged.

## Env

```
VOICE_ENABLED=false
VOICE_STT_PROVIDER=mock|local|cloud
VOICE_TTS_PROVIDER=off|mock|local|cloud
VOICE_LANGUAGE=en
VOICE_MOCK_TRANSCRIPT=
VOICE_STT_COMMAND=          # e.g. whisper-cli -f {input} -nt
VOICE_TTS_COMMAND=          # e.g. espeak "{text}"
VOICE_ALLOW_REMOTE_AUDIO=false   # must be true for cloud STT/TTS
```

## Privacy

- Prefer **local** STT when audio should not leave the machine.
- Cloud adapters refuse unless `VOICE_ALLOW_REMOTE_AUDIO=true`.
- Mock adapters never touch the mic or network.

## Real provider path

1. Install a local Whisper-class CLI; set `VOICE_STT_PROVIDER=local` and `VOICE_STT_COMMAND`.
2. Optional: local TTS via `VOICE_TTS_COMMAND`.
3. Cloud: implement SDK in `CloudSttAdapter` / `CloudTtsAdapter` or keep remote blocked.

See `AGENTS-M18.md` in knowledge package for milestone goals.

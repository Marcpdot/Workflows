# @workflows/voice

Optional **streaming speech I/O** only: microphone/audio → speech events →
`Orchestrator.handle` after commitment → optional streaming TTS/playback.

The existing turn-based path is a compatibility surface. The core direction is
streaming, full-duplex verbal interaction without moving cognition into voice.

No separate knowledge/voice brain. Propose/accept policy unchanged.

## Architecture invariants

- Own audio/verbal mechanics and representations only. Final authorized speech
  enters the same durable experience, cognition, tools, memory, and knowledge
  path as text.
- Do not introduce a `VoiceAgent`, `VoiceBrain`, conversation orchestrator,
  voice-only memory/world model, general scheduler, or second interaction path.
- Keep buffered/file adapters and `runVoiceTurn()` working as compatibility APIs.
- Speech endpointing and cognitive commitment are separate decisions.
- Speech detection and addressing are separate signals. Push-to-talk, active
  conversation, and explicit address must not depend on one hard-coded wake word.
- Partial transcripts are provisional representations. Voice code must not
  persist them as durable semantic truth or trigger irreversible actions.
- Authorized final speech enters the existing `handle()` experience path with
  utterance, source, provider, and remote lineage. `ExperienceRecord` remains
  the only durable source record; retained audio uses its optional `payloadRef`
  and continuous/raw audio is never persisted implicitly.
- Speculative cognition is an optional caller-owned, `AbortSignal`-cancellable
  hook. It may not use tools, write permanent knowledge, or perform irreversible
  actions. Only externally authorized stable/final input enters the normal path.
- Full-duplex behavior is overlapping independent perception and expression.
  Barge-in cancels only the active speech output; recently correlated self-audio
  is not treated as new user speech or as a cognitive commitment.
- Preserve lineage across audio source, utterance, transcript, durable
  experience, response/action, and speech output when those stages are retained.
- Continuous room audio is not permanently retained by default. Audio retention
  and semantic durability are separate policies.
- Runtime behavior should use declared provider capabilities. Existing
  `mock | local | cloud` names remain compatibility/configuration metadata.
- Emit voice lifecycle diagnostics through the shared observer using IDs,
  timings, counts, and bounded reason codes only. Never include full transcript,
  audio, or hidden cognition; observer failure must not affect voice correctness.
- Voice failures degrade locally and must not make cognition unavailable.
- Automated voice tests must remain deterministic and hardware-free. Real
  microphone capture is an explicit manual command with operator-supplied local
  capture/STT configuration and must never run in CI.

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
VOICE_MIC_CAPTURE_COMMAND=  # manual smoke only; finite command with {output}
VOICE_MIC_DEVICE_ID=        # optional diagnostic ID for that manual smoke
VOICE_MIC_STREAM_COMMAND=   # live runtime: raw PCM stdout, no complete file
VOICE_SAMPLE_RATE=16000
VOICE_CHANNELS=1
VOICE_PCM_ENCODING=pcm_s16le
VOICE_VAD_THRESHOLD=0.025
VOICE_VAD_END_SILENCE_MS=650
VOICE_ENGAGEMENT_MODE=active_conversation|push_to_talk
# push_to_talk: voice:live starts idle. Enter opens one window, Enter releases it.
VOICE_TTS_STREAM_COMMAND=   # optional: UTF-8 text stdin -> raw PCM stdout
VOICE_SPEAKER_STREAM_COMMAND= # optional: raw PCM stdin -> speaker
```

## Privacy

- Prefer **local** STT when audio should not leave the machine.
- Cloud adapters refuse unless `VOICE_ALLOW_REMOTE_AUDIO=true`.
- Mock adapters never touch the mic or network.

## Real provider path

1. Install a local Whisper-class CLI; set `VOICE_STT_COMMAND`.
2. For live audio, configure `VOICE_MIC_STREAM_COMMAND` and run
   `npm run voice:live` from `packages/orchestrator`.
   `VOICE_ENGAGEMENT_MODE=active_conversation` (default) listens continuously.
   `VOICE_ENGAGEMENT_MODE=push_to_talk` starts not transmitting: press Enter to
   open one utterance window, Enter again to release. The live script only
   supplies that engagement input; commitment still uses existing helpers.
   After one committed PTT input the session stops.
3. The current command STT fallback consumes live PCM but emits final text only
   after bounded RMS-VAD segments. It declares `partialTranscripts: false`.
4. Optional live speech uses `VOICE_TTS_STREAM_COMMAND` plus
   `VOICE_SPEAKER_STREAM_COMMAND`; the older `VOICE_TTS_COMMAND` remains the
   buffered compatibility path.
5. Cloud: implement SDK in `CloudSttAdapter` / `CloudTtsAdapter` or keep remote blocked.

See `AGENTS-M18.md` in knowledge package for milestone goals.

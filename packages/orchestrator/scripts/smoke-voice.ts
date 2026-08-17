/**
 * Offline smoke for Milestone 18 voice I/O (mock STT/TTS — no mic, no model).
 * Asserts the text path through handle is identical with/without voice wrapper.
 */

import {
  BufferedStreamingSttAdapter,
  BufferedStreamingTtsAdapter,
  createSttAdapter,
  createTtsAdapter,
  createVoiceSession,
  loadVoiceConfig,
  MockSttAdapter,
  MockTtsAdapter,
  runVoiceTurn,
  type AudioFrame,
  type AudioSource,
  type EngagementState,
  type ProviderCapabilities,
  type SpeechEvent,
  type SpeechUtterance,
  type StreamingSttAdapter,
  type StreamingTtsAdapter,
  type TtsAdapter,
  type TranscriptUpdate,
} from "@workflows/voice";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function* one<T>(value: T): AsyncIterable<T> {
  yield value;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

async function main(): Promise<void> {
  // 1. Streaming-native primitives compose without requiring runtime hardware.
  const source: AudioSource = {
    surfaceId: "command-center",
    deviceId: "mock-microphone",
    channel: "mono",
  };
  const frame: AudioFrame = {
    data: new Uint8Array([0, 1]),
    format: { sampleRate: 16_000, channels: 1, encoding: "pcm_s16le" },
    timestampMs: 10,
    source,
  };
  const partial: TranscriptUpdate = {
    text: "status of",
    stability: "partial",
    confidence: 0.7,
    utteranceId: "utterance-1",
    source,
    provider: "mock-streaming",
    remote: false,
    timestampMs: 12,
  };
  const event: SpeechEvent = {
    kind: "partial_transcript",
    utteranceId: partial.utteranceId,
    transcript: partial,
    timestampMs: partial.timestampMs,
    source,
  };
  const utterance: SpeechUtterance = {
    id: partial.utteranceId,
    source,
    startedAtMs: 10,
    events: [event],
  };
  const engagement: EngagementState = {
    mode: "active_conversation",
    addressed: true,
    listening: true,
  };
  const capabilities: ProviderCapabilities = {
    streamingInput: true,
    streamingOutput: false,
    partialTranscripts: true,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
    localOnly: true,
  };
  assert(frame.source === source, "audio frame retains source identity");
  assert(
    utterance.events[0]?.transcript === partial,
    "utterance retains progressive event"
  );
  assert(engagement.listening, "engagement state is explicit");
  assert(
    capabilities.partialTranscripts,
    "provider capabilities are composable"
  );
  console.log("OK: streaming voice primitives are exported and composable");

  // 2. Buffered adapters bridge into capability-described streaming contracts.
  const bufferedCapabilities: ProviderCapabilities = {
    ...capabilities,
    streamingInput: false,
    streamingOutput: false,
    partialTranscripts: false,
    cancellation: false,
  };
  const streamingStt: StreamingSttAdapter =
    new BufferedStreamingSttAdapter(
      new MockSttAdapter("buffered transcript"),
      {
        capabilities: bufferedCapabilities,
        createUtteranceId: () => "buffered-utterance",
      }
    );
  const recognized = await collect(streamingStt.recognize(one(frame), {}));
  assert(
    recognized.length === 1 && recognized[0]?.kind === "final_transcript",
    "buffered STT exposes one final update"
  );
  assert(
    recognized[0]?.transcript?.text === "buffered transcript" &&
      recognized[0].source === source,
    "buffered STT preserves transcript and source"
  );
  assert(
    streamingStt.capabilities.streamingInput === false,
    "compatibility behavior is described by capabilities"
  );

  let synthesizedText = "";
  const legacyTts: TtsAdapter = {
    name: "mock",
    async speak(input) {
      synthesizedText = input.text;
      return {
        spoken: true,
        provider: "mock",
        remote: false,
        audio: new Uint8Array([2, 3]),
      };
    },
  };
  const streamingTts: StreamingTtsAdapter =
    new BufferedStreamingTtsAdapter(legacyTts, {
      capabilities: bufferedCapabilities,
      outputFormat: frame.format,
      outputSource: source,
    });
  async function* textChunks(): AsyncIterable<string> {
    yield "buffered ";
    yield "speech";
  }
  const synthesized = await collect(streamingTts.synthesize(textChunks(), {}));
  assert(synthesizedText === "buffered speech", "buffered TTS joins text chunks");
  assert(
    synthesized.length === 1 && synthesized[0]?.data[1] === 3,
    "in-memory legacy TTS audio becomes one frame"
  );

  const abort = new AbortController();
  abort.abort(new Error("fixture cancellation"));
  let cancelled = false;
  try {
    await collect(streamingStt.recognize(one(frame), { signal: abort.signal }));
  } catch (error) {
    cancelled = error instanceof Error && error.message === "fixture cancellation";
  }
  assert(cancelled, "streaming compatibility boundary accepts AbortSignal");
  console.log("OK: buffered STT/TTS compatibility bridges");

  // 3. Config defaults off / safe
  const cfg = loadVoiceConfig({
    VOICE_ENABLED: "false",
    VOICE_STT_PROVIDER: "mock",
    VOICE_TTS_PROVIDER: "off",
  });
  assert(cfg.enabled === false, "VOICE_ENABLED default false");
  assert(cfg.sttProvider === "mock", "stt mock");
  assert(cfg.ttsProvider === "off", "tts off");
  console.log("OK: voice config defaults off");

  // 4. Mock STT + same handle as text
  const heard: string[] = [];
  const handle = async (text: string) => {
    heard.push(text);
    return { reply: `echo:${text}` };
  };

  const direct = await handle("status of heat");
  assert(direct.reply === "echo:status of heat", "direct handle");

  const stt = new MockSttAdapter("status of heat");
  const tts = new MockTtsAdapter();
  const voice = await runVoiceTurn(
    { stt, tts, handle },
    { transcript: "status of heat" }
  );
  assert(voice.viaVoice === true, "viaVoice");
  assert(voice.transcript === "status of heat", "transcript");
  assert(voice.reply === "echo:status of heat", "reply matches text path");
  assert(voice.reply === direct.reply, "identical to non-voice handle");
  assert(heard.length === 2, "handle called twice");
  assert(tts.utterances.length === 1, "tts mock spoke once");
  assert(tts.utterances[0] === "echo:status of heat", "tts utterance");
  console.log("OK: mock STT→handle→TTS same reply as text");

  // 5. silent turn skips TTS speak content
  const tts2 = new MockTtsAdapter();
  const silent = await runVoiceTurn(
    { stt, tts: tts2, handle },
    { transcript: "quiet", silent: true }
  );
  assert(silent.reply === "echo:quiet", "silent reply");
  assert(tts2.utterances.length === 0, "silent no tts");
  console.log("OK: silent skips TTS");

  // 6. factory adapters from config
  const sttF = createSttAdapter({
    enabled: false,
    sttProvider: "mock",
    ttsProvider: "mock",
    language: "en",
    mockTranscript: "factory transcript",
    allowRemoteAudio: false,
  });
  const ttsF = createTtsAdapter({
    enabled: false,
    sttProvider: "mock",
    ttsProvider: "mock",
    language: "en",
    allowRemoteAudio: false,
  });
  const session = createVoiceSession({
    stt: sttF,
    tts: ttsF,
    handle: async (t) => ({ reply: `ok:${t}` }),
  });
  const turn = await session.turn({});
  assert(turn.transcript === "factory transcript", "factory mock transcript");
  assert(turn.reply === "ok:factory transcript", "session turn");
  console.log("OK: createVoiceSession + factories");

  // 7. cloud STT blocked without remote flag
  const cloud = createSttAdapter({
    enabled: true,
    sttProvider: "cloud",
    ttsProvider: "off",
    language: "en",
    allowRemoteAudio: false,
  });
  let blocked = false;
  try {
    await cloud.transcribe({ audioPath: "x.wav" });
  } catch {
    blocked = true;
  }
  assert(blocked, "cloud STT blocked without VOICE_ALLOW_REMOTE_AUDIO");
  const streamingCloud = new BufferedStreamingSttAdapter(cloud, {
    capabilities: { ...bufferedCapabilities, localOnly: false },
  });
  let streamingBlocked = false;
  try {
    await collect(streamingCloud.recognize(one(frame), {}));
  } catch {
    streamingBlocked = true;
  }
  assert(
    streamingBlocked,
    "streaming compatibility bridge preserves the cloud privacy gate"
  );
  console.log("OK: privacy gate on cloud STT");

  // 6. knowledge tools are not special-cased — voice only delivers text
  // (documented invariant; smoke proves handle receives plain string)
  assert(typeof voice.transcript === "string", "plain string transcript");
  console.log("OK: voice is I/O adapter only");

  console.log("All voice (M18) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/** Hardware-free acceptance checks for the live voice wiring. */

import {
  EnergyVoiceActivityDetector,
  MockStreamingSttAdapter,
  MockStreamingTtsAdapter,
  SegmentedStreamingSttAdapter,
  SpeechActivityTracker,
  runLiveVoiceSession,
  type AudioFormat,
  type AudioFrame,
  type AudioPlaybackSink,
  type MicrophoneFrameSource,
  type SpeechEvent,
  type SpeechRecognitionCapabilities,
  type SpeechSynthesisCapabilities,
  type SttAdapter,
  type StreamingSttAdapter,
  type StreamingTtsAdapter,
  type VoiceCognitionHooks,
} from "@workflows/voice";
import { InMemoryObserver } from "@workflows/observability";

const format: AudioFormat = {
  sampleRate: 16_000,
  channels: 1,
  encoding: "pcm_s16le",
};
const microphoneSource = {
  surfaceId: "fixture-live-microphone",
  deviceId: "fixture-device",
  channel: "mono",
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pcmFrame(
  amplitude: number,
  timestampMs: number,
  dataOverride?: Uint8Array
): AudioFrame {
  const data = dataOverride ?? new Uint8Array(640);
  if (!dataOverride) {
    const view = new DataView(data.buffer);
    for (let offset = 0; offset < data.length; offset += 2) {
      view.setInt16(offset, amplitude, true);
    }
  }
  return { data, format, timestampMs, source: microphoneSource };
}

class FixtureMicrophone implements MicrophoneFrameSource {
  readonly source = microphoneSource;
  readonly format = format;
  sawSignal?: AbortSignal;

  constructor(private readonly frames: readonly AudioFrame[]) {}

  async *capture(input: { signal: AbortSignal }): AsyncIterable<AudioFrame> {
    this.sawSignal = input.signal;
    for (const frame of this.frames) {
      if (input.signal.aborted) throw abortError(input.signal);
      yield frame;
    }
  }
}

class FixtureSink implements AudioPlaybackSink {
  readonly source = { surfaceId: "fixture-speaker" };
  readonly format = format;
  readonly frames: AudioFrame[] = [];
  cancellations = 0;
  onFirstFrame?: () => void;

  async write(
    frame: AudioFrame,
    input: { signal: AbortSignal }
  ): Promise<void> {
    if (input.signal.aborted) throw abortError(input.signal);
    this.frames.push(frame);
    if (this.frames.length === 1) this.onFirstFrame?.();
  }

  cancel(): void {
    this.cancellations += 1;
  }
}

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of input) values.push(value);
  return values;
}

async function main(): Promise<void> {
  await typedCapabilitiesAndVad();
  await segmentedRecognitionFallback();
  await progressiveCommitAndPlayback();
  await duplexSelfAudioAndBargeIn();
  await cancellationAndProviderDegradation();
  console.log("All live voice runtime checks passed.");
}

async function typedCapabilitiesAndVad(): Promise<void> {
  const recognition: SpeechRecognitionCapabilities = {
    streamingInput: true,
    partialTranscripts: true,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
  };
  const synthesis: SpeechSynthesisCapabilities = {
    streamingOutput: true,
    streamingTextInput: true,
    cancellation: true,
  };
  assert(
    !("streamingOutput" in recognition) &&
      !("partialTranscripts" in synthesis),
    "recognition and synthesis capabilities cannot express irrelevant flags"
  );

  const tracker = new SpeechActivityTracker(
    new EnergyVoiceActivityDetector({ speechThreshold: 0.1 }),
    { endSilenceMs: 40 }
  );
  const events = [
    tracker.push(pcmFrame(10_000, 0)),
    tracker.push(pcmFrame(9_000, 20)),
    tracker.push(pcmFrame(0, 40)),
    tracker.push(pcmFrame(0, 60)),
  ].filter((event) => event !== undefined);
  assert(
    events.map((event) => event.kind).join(",") ===
      "speech_started,speech_continuing,speech_continuing,speech_ended",
    "energy VAD emits start, continuing, and bounded speech end"
  );
  assert(events.at(-1)?.silenceMs === 40, "VAD reports ending silence");
  console.log("OK: typed speech capabilities and real PCM energy VAD");
}

async function segmentedRecognitionFallback(): Promise<void> {
  let transcriptions = 0;
  const legacy: SttAdapter = {
    name: "local",
    async transcribe(input) {
      transcriptions += 1;
      assert(!!input.audioPath, "bounded segment is materialized for local STT");
      assert(!!input.audio?.length, "bounded PCM segment remains available");
      return { text: "bounded final", provider: "local", remote: false };
    },
  };
  const adapter = new SegmentedStreamingSttAdapter(legacy, {
    detector: new EnergyVoiceActivityDetector({ speechThreshold: 0.1 }),
    provider: { localOnly: true },
    cancellation: true,
    endSilenceMs: 40,
    createUtteranceId: () => "segmented-utterance",
  });
  const microphone = new FixtureMicrophone([
    pcmFrame(10_000, 0),
    pcmFrame(0, 20),
    pcmFrame(0, 40),
  ]);
  const events = await collect(
    adapter.recognize(microphone.capture({ signal: new AbortController().signal }), {})
  );
  assert(adapter.capabilities.streamingInput, "segmented STT consumes live frames");
  assert(
    !adapter.capabilities.partialTranscripts,
    "segmented STT does not pretend to provide partial recognition"
  );
  assert(adapter.provider.localOnly, "provider locality is separate metadata");
  assert(
    transcriptions === 1 &&
      events.filter((event) => event.kind === "final_transcript").length === 1,
    "one VAD segment produces one final transcript"
  );
  console.log("OK: bounded VAD-segmented fallback is explicit and finite");
}

async function progressiveCommitAndPlayback(): Promise<void> {
  const observer = new InMemoryObserver();
  const microphone = new FixtureMicrophone([pcmFrame(8_000, 10)]);
  const recognition = new MockStreamingSttAdapter({
    utteranceId: "progressive-live",
    updates: [
      { text: "motor", stability: "partial" },
      { text: "motor status", stability: "partial" },
      { text: "motor status please", stability: "final" },
    ],
  });
  const speculativeSignals: AbortSignal[] = [];
  let durableWrites = 0;
  const hooks: VoiceCognitionHooks = {
    onSpeculativeInput(_text, meta) {
      speculativeSignals.push(meta.signal);
    },
    async onCommittedInput(text) {
      durableWrites += 1;
      return {
        reply: `answer:${text}`,
        experiences: { input: "experience-input", output: "experience-output" },
      };
    },
  };
  const synthesis = new MockStreamingTtsAdapter({
    source: { surfaceId: "fixture-speaker" },
    format,
    audioChunks: [new Uint8Array([1, 2, 3, 4])],
  });
  const sink = new FixtureSink();
  const result = await runLiveVoiceSession({
    microphone,
    recognition,
    cognition: hooks,
    engagement: { mode: "active_conversation", listening: true },
    synthesis,
    speaker: sink,
    signal: new AbortController().signal,
    observation: { observer, sessionId: "fixture-live" },
    maxCommittedInputs: 1,
  });
  assert(
    speculativeSignals.length === 2 &&
      speculativeSignals.every((signal) => signal.aborted),
    "each revised partial cancels obsolete speculative work"
  );
  assert(
    durableWrites === 1 && result.committedInputs === 1,
    "only one final endpoint enters the durable cognition hook"
  );
  assert(
    result.inputExperienceIds[0] === "experience-input" &&
      result.outputExperienceIds[0] === "experience-output",
    "live result exposes durable input/output experience identities"
  );
  assert(
    sink.frames.length === 1 && result.framesPlayed === 1,
    "speaker receives streaming audio before playback is marked"
  );
  assert(
    !observer.events.some((event) =>
      JSON.stringify(event).includes("motor status please")
    ),
    "voice observability excludes full private transcript content"
  );
  const observedStages = new Set(
    observer.events.flatMap((event) =>
      event.voice?.stage ? [event.voice.stage] : []
    )
  );
  const requiredStages = [
    "microphone_capture_start",
    "speech_started",
    "first_partial",
    "final",
    "endpoint",
    "commitment",
    "tts_first_audio",
    "playback",
  ] as const;
  for (const stage of requiredStages) {
    assert(observedStages.has(stage), `live observability includes ${stage}`);
  }
  console.log("OK: partial supersession, single durable commit, and playback");
}

async function duplexSelfAudioAndBargeIn(): Promise<void> {
  const outputBytes = new Uint8Array([7, 8, 9, 10]);
  const outputFrame: AudioFrame = {
    data: outputBytes,
    format,
    timestampMs: 1_000,
    source: { surfaceId: "fixture-speaker" },
  };
  let releaseFirstPlayback!: () => void;
  const firstPlayback = new Promise<void>((resolve) => {
    releaseFirstPlayback = resolve;
  });
  const microphone = new FixtureMicrophone([
    pcmFrame(8_000, 10),
    pcmFrame(0, 1_010, outputBytes),
    pcmFrame(9_000, 1_020),
  ]);
  const recognition = new ScriptedDuplexRecognition(firstPlayback);
  const synthesis = new HoldingTts(outputFrame);
  const sink = new FixtureSink();
  sink.onFirstFrame = releaseFirstPlayback;
  const result = await runLiveVoiceSession({
    microphone,
    recognition,
    cognition: {
      async onCommittedInput() {
        return {
          reply: "long answer",
          experiences: { input: "duplex-input", output: "duplex-output" },
        };
      },
    },
    engagement: { mode: "active_conversation", listening: true },
    synthesis,
    speaker: sink,
    signal: new AbortController().signal,
    selfAudioMaxLagMs: 500,
  });
  assert(
    result.selfAudioSuppressions === 1,
    "correlated system audio is identified as self audio"
  );
  assert(result.bargeIns === 1, "later external speech interrupts output once");
  assert(sink.cancellations === 1, "barge-in propagates to the playback sink");
  console.log("OK: self-audio suppression and external barge-in");
}

async function cancellationAndProviderDegradation(): Promise<void> {
  const nonStreaming: StreamingSttAdapter = {
    name: "buffered-only",
    provider: { localOnly: true },
    capabilities: {
      streamingInput: false,
      partialTranscripts: false,
      wordTimestamps: false,
      cancellation: false,
      diarization: false,
    },
    async *recognize() {},
  };
  const observer = new InMemoryObserver();
  let rejected = false;
  try {
    await runLiveVoiceSession({
      microphone: new FixtureMicrophone([]),
      recognition: nonStreaming,
      cognition: { async onCommittedInput() { return { reply: "" }; } },
      engagement: { mode: "active_conversation", listening: true },
      signal: new AbortController().signal,
      observation: { observer },
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "unsafe unbounded buffered recognition is rejected");
  assert(
    observer.events.some(
      (event) =>
        event.voice?.stage === "degradation" &&
        event.voice.reasonCode === "recognizer_does_not_accept_streaming_input"
    ),
    "provider degradation is explicit and privacy-safe"
  );

  const abort = new AbortController();
  const microphone = new FixtureMicrophone([pcmFrame(8_000, 0)]);
  const pending = runLiveVoiceSession({
    microphone,
    recognition: new AbortWaitingRecognition(),
    cognition: { async onCommittedInput() { return { reply: "" }; } },
    engagement: { mode: "active_conversation", listening: true },
    signal: abort.signal,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  abort.abort(new Error("fixture live cancellation"));
  let cancelled = false;
  try {
    await pending;
  } catch (error) {
    cancelled =
      error instanceof Error && error.message === "fixture live cancellation";
  }
  assert(
    cancelled &&
      microphone.sawSignal?.aborted === true &&
      microphone.sawSignal.reason === abort.signal.reason,
    "AbortSignal cancellation and reason reach capture"
  );
  console.log("OK: bounded provider degradation and cancellation propagation");
}

class AbortWaitingRecognition implements StreamingSttAdapter {
  readonly name = "abort-waiting-stt";
  readonly provider = { localOnly: true };
  readonly capabilities: SpeechRecognitionCapabilities = {
    streamingInput: true,
    partialTranscripts: false,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
  };

  async *recognize(
    frames: AsyncIterable<AudioFrame>,
    input: { signal?: AbortSignal }
  ): AsyncIterable<SpeechEvent> {
    await frames[Symbol.asyncIterator]().next();
    await new Promise<void>((_resolve, reject) => {
      if (input.signal?.aborted) {
        reject(abortError(input.signal));
        return;
      }
      input.signal?.addEventListener(
        "abort",
        () => reject(abortError(input.signal!)),
        { once: true }
      );
    });
  }
}

class ScriptedDuplexRecognition implements StreamingSttAdapter {
  readonly name = "scripted-duplex-stt";
  readonly provider = { localOnly: true };
  readonly capabilities: SpeechRecognitionCapabilities = {
    streamingInput: true,
    partialTranscripts: false,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
  };

  constructor(private readonly firstPlayback: Promise<void>) {}

  async *recognize(
    frames: AsyncIterable<AudioFrame>
  ): AsyncIterable<SpeechEvent> {
    const iterator = frames[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) return;
    yield speechStarted("user-1", first.value);
    yield finalTranscript("user-1", first.value, "hello");
    yield endpoint("user-1", first.value);

    await this.firstPlayback;
    const echo = await iterator.next();
    if (echo.done) return;
    yield speechStarted("self-echo", echo.value);

    const external = await iterator.next();
    if (external.done) return;
    yield speechStarted("external-barge-in", external.value);
  }
}

class HoldingTts implements StreamingTtsAdapter {
  readonly name = "holding-streaming-tts";
  readonly provider = { localOnly: true };
  readonly capabilities: SpeechSynthesisCapabilities = {
    streamingOutput: true,
    streamingTextInput: false,
    cancellation: true,
  };

  constructor(private readonly frame: AudioFrame) {}

  async *synthesize(
    _text: AsyncIterable<string> | string,
    input: { signal?: AbortSignal }
  ): AsyncIterable<AudioFrame> {
    yield this.frame;
    await new Promise<void>((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(abortError(input.signal));
        return;
      }
      input.signal?.addEventListener(
        "abort",
        () => reject(abortError(input.signal!)),
        { once: true }
      );
    });
  }
}

function speechStarted(utteranceId: string, frame: AudioFrame): SpeechEvent {
  return {
    kind: "speech_started",
    utteranceId,
    timestampMs: frame.timestampMs,
    source: frame.source,
  };
}

function finalTranscript(
  utteranceId: string,
  frame: AudioFrame,
  text: string
): SpeechEvent {
  return {
    kind: "final_transcript",
    utteranceId,
    timestampMs: frame.timestampMs + 1,
    source: frame.source,
    transcript: {
      text,
      stability: "final",
      utteranceId,
      source: frame.source,
      provider: "scripted-duplex-stt",
      remote: false,
      timestampMs: frame.timestampMs + 1,
    },
  };
}

function endpoint(utteranceId: string, frame: AudioFrame): SpeechEvent {
  return {
    kind: "endpoint",
    utteranceId,
    timestampMs: frame.timestampMs + 2,
    source: frame.source,
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("fixture aborted");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

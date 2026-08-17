/**
 * Offline smoke for Milestone 18 voice I/O (mock STT/TTS — no mic, no model).
 * Asserts the text path through handle is identical with/without voice wrapper.
 */

import {
  MockStreamingTtsAdapter,
  BufferedStreamingSttAdapter,
  BufferedStreamingTtsAdapter,
  MockStreamingSttAdapter,
  applyBargeIn,
  assembleSpeechUtterance,
  commitVoiceInput,
  correlateSelfAudio,
  createFinalOnlyVoiceCognitionHooks,
  createSelfAudioReference,
  createSttAdapter,
  createTtsAdapter,
  createVoiceSession,
  decideEndpoint,
  loadVoiceConfig,
  MockSttAdapter,
  MockTtsAdapter,
  runVoiceTurn,
  resolveEngagement,
  signalSpeculativeInput,
  startSpeechOutput,
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
  type VoiceCognitionHooks,
  type VoiceHandleContext,
  type VoiceHandleFn,
} from "@workflows/voice";
import { createMemory } from "@workflows/memory";
import { Orchestrator } from "../src/orchestrator.js";
import type { ModelClient, OrchestratorConfig } from "../src/types.js";

function assert(cond: boolean, msg: string): asserts cond {
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

  // 3. Native mock STT exposes progressive speech without committing it.
  const progressiveStt = new MockStreamingSttAdapter({
    utteranceId: "progressive-utterance",
    updates: [
      {
        text: "status of",
        stability: "partial",
        confidence: 0.72,
        completeness: 0.45,
      },
      {
        text: "status of heat",
        stability: "final",
        confidence: 0.96,
        completeness: 1,
      },
    ],
  });
  const progressiveEvents = await collect(
    progressiveStt.recognize(one(frame), {})
  );
  assert(
    progressiveEvents.map((item) => item.kind).join(",") ===
      "speech_started,partial_transcript,final_transcript,speech_ended,endpoint",
    "progressive STT emits the complete ordered speech lifecycle"
  );
  const progressivePartial = progressiveEvents.find(
    (item) => item.kind === "partial_transcript"
  )?.transcript;
  assert(
    progressivePartial?.stability === "partial" &&
      progressivePartial.confidence === 0.72 &&
      progressivePartial.completeness === 0.45,
    "partial stability, confidence, and completeness survive"
  );
  const progressiveFinal = progressiveEvents.find(
    (item) => item.kind === "final_transcript"
  )?.transcript;
  assert(
    progressiveFinal?.stability === "final" &&
      progressiveFinal.completeness === 1 &&
      progressiveFinal.isEndpoint === false,
    "final transcript remains distinct from endpoint"
  );
  assert(
    progressiveEvents.at(-1)?.kind === "endpoint" &&
      progressiveEvents.at(-1)?.transcript === undefined,
    "endpoint is a separate non-commit event"
  );
  const progressiveUtterance = assembleSpeechUtterance(progressiveEvents);
  assert(
    progressiveUtterance.finalText === "status of heat" &&
      progressiveUtterance.finalText !== progressivePartial?.text,
    "utterance final text never promotes a partial transcript"
  );
  assert(
    progressiveStt.capabilities.streamingInput &&
      progressiveStt.capabilities.partialTranscripts,
    "native streaming support is capability-described"
  );
  const progressiveAbort = new AbortController();
  progressiveAbort.abort(new Error("cancel progressive fixture"));
  let progressiveCancelled = false;
  try {
    await collect(
      progressiveStt.recognize(one(frame), {
        signal: progressiveAbort.signal,
      })
    );
  } catch (error) {
    progressiveCancelled =
      error instanceof Error && error.message === "cancel progressive fixture";
  }
  assert(progressiveCancelled, "native progressive recognition is cancellable");
  console.log("OK: progressive speech lifecycle remains provisional");

  // 4. Engagement and endpointing use explicit, independent signals.
  const pushToTalk = resolveEngagement({
    mode: "push_to_talk",
    listening: true,
    pushToTalkActive: true,
  });
  assert(
    pushToTalk.participates && pushToTalk.reason === "push_to_talk_active",
    "push-to-talk explicitly engages speech processing"
  );
  const activeConversation = resolveEngagement({
    mode: "active_conversation",
    listening: true,
  });
  assert(
    activeConversation.participates && !activeConversation.state.addressed,
    "active conversation does not require an address detector"
  );
  const addressed = resolveEngagement({
    mode: "addressed",
    listening: true,
    addressSignals: [
      {
        detectorId: "fixture-addressee-detector",
        addressed: true,
        confidence: 0.91,
        timestampMs: 20,
      },
    ],
  });
  assert(
    addressed.participates &&
      addressed.reason === "explicitly_addressed" &&
      addressed.addressSignal?.detectorId === "fixture-addressee-detector",
    "explicit address is detector-agnostic"
  );
  const notAddressed = resolveEngagement({
    mode: "addressed",
    listening: true,
    addressSignals: [
      {
        detectorId: "fixture-addressee-detector",
        addressed: false,
        timestampMs: 21,
      },
    ],
  });
  assert(!notAddressed.participates, "speech detection alone is not addressing");

  const silenceOnly = decideEndpoint(activeConversation.state, {
    nowMs: 2_000,
    utteranceStartedAtMs: 1_000,
    silenceMs: 900,
  });
  assert(!silenceOnly.isEndpoint, "silence timeout alone is insufficient");
  const completedSpeech = decideEndpoint(activeConversation.state, {
    nowMs: 2_000,
    utteranceStartedAtMs: 1_000,
    speechEnded: true,
    finalTranscript: true,
  });
  assert(
    completedSpeech.reasons.includes("speech_ended_with_final"),
    "speech end plus final transcript establishes endpoint evidence"
  );
  const endedWithSilence = decideEndpoint(activeConversation.state, {
    nowMs: 2_000,
    utteranceStartedAtMs: 1_000,
    speechEnded: true,
    silenceMs: 900,
  });
  assert(
    endedWithSilence.reasons.includes("speech_ended_with_silence"),
    "speech end and silence combine as endpoint evidence"
  );
  const heldPushToTalk = decideEndpoint(pushToTalk.state, {
    nowMs: 2_000,
    utteranceStartedAtMs: 1_000,
    speechEnded: true,
    finalTranscript: true,
  });
  assert(
    !heldPushToTalk.isEndpoint,
    "push-to-talk does not end before release from transcript timing alone"
  );
  const releasedPushToTalk = decideEndpoint(pushToTalk.state, {
    nowMs: 2_100,
    utteranceStartedAtMs: 1_000,
    pushToTalkReleased: true,
  });
  assert(
    releasedPushToTalk.reasons.includes("push_to_talk_released"),
    "push-to-talk release is explicit endpoint evidence"
  );
  const providerEndpoint = decideEndpoint(activeConversation.state, {
    nowMs: 2_200,
    utteranceStartedAtMs: 1_000,
    providerEndpoint: true,
  });
  assert(
    providerEndpoint.reasons.includes("provider_endpoint") &&
      !("commit" in providerEndpoint),
    "provider endpoint remains separate from cognitive commitment"
  );
  const boundedEndpoint = decideEndpoint(activeConversation.state, {
    nowMs: 31_000,
    utteranceStartedAtMs: 0,
  });
  assert(
    boundedEndpoint.reasons.includes("max_utterance_reached"),
    "maximum utterance duration provides a bounded fallback"
  );
  console.log("OK: engagement and multi-signal endpoint decisions");

  // 5. Reversible cognition hooks never make the commitment decision.
  const speculativeSignals: AbortSignal[] = [];
  const speculativeTexts: string[] = [];
  const committedTexts: string[] = [];
  const hooks: VoiceCognitionHooks = {
    onSpeculativeInput(text, meta) {
      speculativeTexts.push(text);
      speculativeSignals.push(meta.signal);
    },
    async onCommittedInput(text) {
      committedTexts.push(text);
      return { reply: `committed:${text}` };
    },
  };
  const speculativeController = new AbortController();
  assert(
    signalSpeculativeInput(
      hooks,
      progressivePartial!,
      speculativeController.signal
    ),
    "partial input can start optional cheap preparation"
  );
  assert(
    speculativeTexts[0] === "status of" && committedTexts.length === 0,
    "speculation cannot enter the committed path"
  );
  speculativeController.abort("transcript revised");
  assert(
    speculativeSignals[0]?.aborted === true,
    "caller can cancel obsolete speculative work"
  );
  let partialCommitRejected = false;
  try {
    await commitVoiceInput(hooks, progressivePartial!);
  } catch {
    partialCommitRejected = true;
  }
  assert(
    partialCommitRejected && committedTexts.length === 0,
    "partial transcripts are rejected from the durable cognition hook"
  );

  const externallyAuthorized =
    addressed.participates && providerEndpoint.isEndpoint;
  assert(externallyAuthorized, "engagement and endpoint decisions stay external");
  const committed = await commitVoiceInput(hooks, progressiveFinal!);
  assert(
    committed.reply === "committed:status of heat" &&
      committedTexts.join(",") === "status of heat",
    "only the explicitly submitted final transcript reaches cognition"
  );

  const finalOnlyHooks = createFinalOnlyVoiceCognitionHooks(async (text) => ({
    reply: `final-only:${text}`,
  }));
  assert(
    !signalSpeculativeInput(
      finalOnlyHooks,
      progressivePartial!,
      new AbortController().signal
    ),
    "missing speculative hook degrades without extra work"
  );
  const finalOnly = await commitVoiceInput(finalOnlyHooks, progressiveFinal!);
  assert(
    finalOnly.reply === "final-only:status of heat",
    "final-only hooks preserve the existing handle contract"
  );
  console.log("OK: reversible cognition hooks and final-only fallback");

  // 6. Perception can continue while cancellable speech output is active.
  const outputSource: AudioSource = {
    surfaceId: "command-center",
    deviceId: "mock-speaker",
    channel: "mono",
  };
  const nativeTts = new MockStreamingTtsAdapter({
    source: outputSource,
    format: frame.format,
    audioChunks: [
      new Uint8Array([10, 11]),
      new Uint8Array([12, 13]),
      new Uint8Array([14, 15]),
    ],
    startTimestampMs: 100,
  });
  async function* progressiveReply(): AsyncIterable<string> {
    yield "status ";
    yield "received";
    yield ".";
  }
  const speechOutput = startSpeechOutput(nativeTts, progressiveReply(), {
    outputId: "speech-output-1",
  });
  const outputFrames = speechOutput.frames[Symbol.asyncIterator]();
  const firstOutput = await outputFrames.next();
  assert(
    !firstOutput.done && speechOutput.active,
    "streaming output is active after its first frame"
  );
  assert(
    nativeTts.capabilities.streamingOutput &&
      nativeTts.capabilities.cancellation,
    "native TTS declares streaming and cancellation support"
  );

  const selfAudioReference = createSelfAudioReference(
    speechOutput.id,
    firstOutput.value
  );
  const perceivedEcho: AudioFrame = {
    ...firstOutput.value,
    timestampMs: firstOutput.value.timestampMs + 10,
    source,
  };
  const selfAudio = correlateSelfAudio(perceivedEcho, [selfAudioReference]);
  assert(
    selfAudio?.outputId === speechOutput.id && selfAudio.lagMs === 10,
    "recent perceived output is correlated without retaining transcript content"
  );
  const echoSpeechStarted: SpeechEvent = {
    kind: "speech_started",
    utteranceId: "echo-utterance",
    timestampMs: perceivedEcho.timestampMs,
    source,
  };
  const ignoredEcho = applyBargeIn(
    speechOutput,
    echoSpeechStarted,
    selfAudio
  );
  assert(
    !ignoredEcho.decision.interrupt &&
      ignoredEcho.decision.reason === "self_audio" &&
      speechOutput.active,
    "self-audio is not treated as user barge-in"
  );

  const secondOutput = await outputFrames.next();
  assert(
    !secondOutput.done && speechOutput.active,
    "speech output and input perception can overlap"
  );
  const externalSpeechStarted: SpeechEvent = {
    kind: "speech_started",
    utteranceId: "external-utterance",
    timestampMs: 130,
    source,
  };
  const interrupted = applyBargeIn(speechOutput, externalSpeechStarted);
  assert(
    interrupted.decision.interrupt &&
      interrupted.decision.reason === "external_speech_started" &&
      interrupted.event?.kind === "barge_in" &&
      speechOutput.signal.aborted,
    "external speech cancels only the active speech output"
  );
  let outputCancelled = false;
  try {
    await outputFrames.next();
  } catch (error) {
    outputCancelled =
      error instanceof Error && error.message.includes("interrupted");
  }
  assert(
    outputCancelled && nativeTts.receivedText === "status received",
    "barge-in stops future synthesis without waiting for the full reply"
  );
  assert(
    committedTexts.join(",") === "status of heat",
    "output interruption does not create a cognitive commitment"
  );
  console.log("OK: full-duplex output, self-audio correlation, and barge-in");

  // 7. Authorized final speech enters the same durable path as text.
  const voiceMemory = createMemory({ dbPath: ":memory:" });
  const durableModel: ModelClient = {
    provider: "local",
    async complete() {
      return {
        content: "The spoken observation entered shared cognition.",
        model: "fixture-voice-model",
        provider: "local",
      };
    },
  };
  const durableConfig: OrchestratorConfig = {
    ollamaBin: "ollama",
    ollamaModel: "fixture-voice-model",
    xaiApiKey: "",
    xaiBaseUrl: "https://example.invalid",
    grokModel: "fixture-frontier",
    systemPrompt: "Test assistant.",
    compression: {
      threshold: 20,
      keepRecent: 8,
      maxSummaryChars: 1_500,
      disabled: true,
    },
    retrieval: {
      limit: 4,
      maxChars: 2_000,
      maxChunkChars: 600,
      contextDir: process.cwd(),
      disabled: true,
    },
    workspaceRoot: process.cwd(),
    experienceStore: voiceMemory,
    toolsEnabled: false,
    toolsMaxSteps: 1,
  };
  const durableOrchestrator = new Orchestrator(durableConfig, {
    local: durableModel,
    frontier: durableModel,
  });
  const durableHooks = createFinalOnlyVoiceCognitionHooks(
    (text, context) =>
      durableOrchestrator.handle(text, {
        ...context,
        sessionId: "voice-experience-session",
        interactionMode: "neutral",
      })
  );
  const retainedTranscript: TranscriptUpdate = {
    ...progressiveFinal!,
    utteranceId: "durable-voice-utterance",
    audioRef: "audio://retained/durable-voice-utterance",
  };
  const durableResult = await commitVoiceInput(
    durableHooks,
    retainedTranscript
  );
  assert(
    durableResult.experiences?.input && durableResult.experiences.output,
    "shared handle returns durable voice input and output identities"
  );
  const durableInput = await voiceMemory.getExperience(
    durableResult.experiences.input
  );
  const durableOutput = await voiceMemory.getExperience(
    durableResult.experiences.output
  );
  const voiceLineage = durableInput?.metadata.voice as
    | {
        utteranceId?: string;
        audioSource?: AudioSource;
        remote?: boolean;
        provider?: string;
        audioRef?: string;
      }
    | undefined;
  assert(
    durableInput?.kind === "user_message" &&
      durableInput.content === retainedTranscript.text &&
      durableInput.source?.type === "voice" &&
      durableInput.source.ref === retainedTranscript.utteranceId,
    "final speech uses the authoritative user-message experience path"
  );
  assert(
    durableInput.payloadRef === retainedTranscript.audioRef &&
      voiceLineage?.utteranceId === retainedTranscript.utteranceId &&
      voiceLineage.audioSource?.surfaceId === source.surfaceId &&
      voiceLineage.provider === retainedTranscript.provider &&
      voiceLineage.remote === retainedTranscript.remote &&
      voiceLineage.audioRef === undefined,
    "voice lineage uses existing source metadata and one optional payload reference"
  );
  assert(
    durableOutput?.kind === "assistant_output" &&
      durableOutput.parentExperienceIds.includes(durableInput.id),
    "assistant output retains the same input experience lineage as text"
  );
  const durableHistory = await voiceMemory.getHistory(
    "voice-experience-session"
  );
  assert(
    durableHistory.length === 2 &&
      durableHistory[0]?.content === retainedTranscript.text &&
      durableHistory[1]?.content === durableResult.reply,
    "voice and text share the existing session history contract"
  );
  const beforeRejectedPartial = (
    await voiceMemory.listExperiences({ sessionId: "voice-experience-session" })
  ).length;
  let durablePartialRejected = false;
  try {
    await commitVoiceInput(durableHooks, progressivePartial!);
  } catch {
    durablePartialRejected = true;
  }
  const afterRejectedPartial = (
    await voiceMemory.listExperiences({ sessionId: "voice-experience-session" })
  ).length;
  assert(
    durablePartialRejected && beforeRejectedPartial === afterRejectedPartial,
    "partial speech never reaches durable experience storage"
  );
  durableOrchestrator.close();
  voiceMemory.close();
  console.log("OK: final voice input uses shared durable experience lineage");

  // 8. Config defaults off / safe
  const cfg = loadVoiceConfig({
    VOICE_ENABLED: "false",
    VOICE_STT_PROVIDER: "mock",
    VOICE_TTS_PROVIDER: "off",
  });
  assert(cfg.enabled === false, "VOICE_ENABLED default false");
  assert(cfg.sttProvider === "mock", "stt mock");
  assert(cfg.ttsProvider === "off", "tts off");
  console.log("OK: voice config defaults off");

  // 9. Mock STT + same handle as text
  const heard: string[] = [];
  const handleContexts: Array<VoiceHandleContext | undefined> = [];
  const handle: VoiceHandleFn = async (text, context) => {
    heard.push(text);
    handleContexts.push(context);
    return {
      reply: `echo:${text}`,
      ...(context
        ? { experiences: { input: "fixture-input", output: "fixture-output" } }
        : {}),
    };
  };

  const direct = await handle("status of heat");
  assert(direct.reply === "echo:status of heat", "direct handle");

  const stt = new MockSttAdapter("status of heat");
  const tts = new MockTtsAdapter();
  const voice = await runVoiceTurn(
    { stt, tts, handle },
    {
      transcript: "status of heat",
      utteranceId: "buffered-voice-utterance",
      source,
      audioRef: "audio://retained/buffered-voice-utterance",
    }
  );
  assert(voice.viaVoice === true, "viaVoice");
  assert(voice.transcript === "status of heat", "transcript");
  assert(voice.reply === "echo:status of heat", "reply matches text path");
  assert(voice.reply === direct.reply, "identical to non-voice handle");
  assert(heard.length === 2, "handle called twice");
  assert(
    handleContexts[0] === undefined &&
      handleContexts[1]?.experienceSource.ref ===
        "buffered-voice-utterance" &&
      handleContexts[1].experiencePayloadRef ===
        "audio://retained/buffered-voice-utterance" &&
      handleContexts[1].experienceMetadata.voice.audioSource.surfaceId ===
        source.surfaceId &&
      voice.utteranceId === "buffered-voice-utterance" &&
      voice.source === source &&
      voice.inputExperienceId === "fixture-input" &&
      voice.outputExperienceId === "fixture-output",
    "buffered compatibility forwards explicit voice lineage only for voice input"
  );
  assert(tts.utterances.length === 1, "tts mock spoke once");
  assert(tts.utterances[0] === "echo:status of heat", "tts utterance");
  console.log("OK: mock STT→handle→TTS same reply as text");

  // 10. silent turn skips TTS speak content
  const tts2 = new MockTtsAdapter();
  const silent = await runVoiceTurn(
    { stt, tts: tts2, handle },
    { transcript: "quiet", silent: true }
  );
  assert(silent.reply === "echo:quiet", "silent reply");
  assert(tts2.utterances.length === 0, "silent no tts");
  assert(
    handleContexts[2]?.experiencePayloadRef === undefined,
    "buffered voice never invents a durable audio reference"
  );
  console.log("OK: silent skips TTS");

  // 11. factory adapters from config
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

  // 12. cloud STT blocked without remote flag
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

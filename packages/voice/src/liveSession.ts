/** Operation-local wiring for one live, full-duplex voice session. */

import {
  applyBargeIn,
  correlateSelfAudio,
  createSelfAudioReference,
  startSpeechOutput,
  type CancellableSpeechOutput,
  type SelfAudioReference,
} from "./duplex.js";
import {
  decideEndpoint,
  resolveEngagement,
  type EndpointPolicy,
  type EngagementInput,
} from "./engagement.js";
import {
  commitVoiceInput,
  signalSpeculativeInput,
  type VoiceCognitionHooks,
} from "./cognitionHooks.js";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";
import type {
  AudioFrame,
  SpeechEvent,
  StreamingSttAdapter,
  StreamingTtsAdapter,
  TranscriptUpdate,
} from "./types.js";
import type {
  AudioPlaybackSink,
  MicrophoneFrameSource,
} from "./audioTransport.js";

export interface LiveVoiceSessionOptions {
  microphone: MicrophoneFrameSource;
  recognition: StreamingSttAdapter;
  cognition: VoiceCognitionHooks;
  engagement: EngagementInput | (() => EngagementInput);
  synthesis?: StreamingTtsAdapter;
  speaker?: AudioPlaybackSink;
  language?: string;
  signal: AbortSignal;
  endpointPolicy?: EndpointPolicy;
  observation?: VoiceObservationContext;
  maxCommittedInputs?: number;
  maxSelfAudioReferences?: number;
  selfAudioMaxLagMs?: number;
}

export interface LiveVoiceSessionResult {
  utterancesStarted: number;
  partialsObserved: number;
  speculativeStarts: number;
  committedInputs: number;
  outputsStarted: number;
  framesPlayed: number;
  bargeIns: number;
  selfAudioSuppressions: number;
  degradations: string[];
  inputExperienceIds: string[];
  outputExperienceIds: string[];
}

interface UtteranceState {
  startedAtMs: number;
  engaged: boolean;
  selfAudio: boolean;
  speechEnded: boolean;
  final?: TranscriptUpdate;
  committed: boolean;
  firstPartialObserved: boolean;
}

/**
 * Connects audio I/O and the existing pure voice primitives. It owns no
 * interpretation, memory, tool, authority, or knowledge policy.
 */
export async function runLiveVoiceSession(
  options: LiveVoiceSessionOptions
): Promise<LiveVoiceSessionResult> {
  if (!options.recognition.capabilities.streamingInput) {
    observeVoiceDegradation(options.observation, {
      capability: "streaming_stt",
      reasonCode: "recognizer_does_not_accept_streaming_input",
      provider: options.recognition.name,
    });
    throw new Error(
      "live voice requires streaming input; wrap buffered STT in the VAD-segmented adapter"
    );
  }
  if (!!options.synthesis !== !!options.speaker) {
    throw new Error("live synthesis and speaker must be configured together");
  }

  const result: LiveVoiceSessionResult = {
    utterancesStarted: 0,
    partialsObserved: 0,
    speculativeStarts: 0,
    committedInputs: 0,
    outputsStarted: 0,
    framesPlayed: 0,
    bargeIns: 0,
    selfAudioSuppressions: 0,
    degradations: [],
    inputExperienceIds: [],
    outputExperienceIds: [],
  };
  const utterances = new Map<string, UtteranceState>();
  const speculation = new Map<string, AbortController>();
  const selfAudioReferences: SelfAudioReference[] = [];
  const commitTasks = new Set<Promise<void>>();
  const playbackTasks = new Set<Promise<void>>();
  const sessionController = linkedAbortController(options.signal);
  const runtimeSignal = sessionController.signal;
  let commitFailure: unknown;
  let playbackFailure: unknown;
  let latestInputFrame: AudioFrame | undefined;
  let activeOutput: CancellableSpeechOutput | undefined;

  if (!options.recognition.capabilities.partialTranscripts) {
    recordDegradation(
      result,
      options,
      "partial_transcripts_unavailable",
      "partial_transcripts",
      options.recognition.name
    );
  }
  if (options.synthesis && !options.synthesis.capabilities.streamingOutput) {
    recordDegradation(
      result,
      options,
      "buffered_tts_output",
      "streaming_tts",
      options.synthesis.name
    );
  }
  if (options.synthesis && !options.synthesis.capabilities.cancellation) {
    recordDegradation(
      result,
      options,
      "tts_provider_not_cancellable",
      "tts_cancellation",
      options.synthesis.name
    );
  }

  observeVoiceTransition(options.observation, {
    stage: "microphone_capture_start",
    source: options.microphone.source,
    provider: options.recognition.name,
    eventTimestampMs: Date.now(),
    reasonCode: "live_session",
  });

  async function* observedInput(): AsyncIterable<AudioFrame> {
    for await (const frame of options.microphone.capture({
      signal: runtimeSignal,
    })) {
      latestInputFrame = frame;
      pruneReferences(selfAudioReferences, frame.timestampMs, options);
      yield frame;
    }
  }

  try {
    for await (const event of options.recognition.recognize(observedInput(), {
      language: options.language,
      signal: runtimeSignal,
    })) {
      throwIfAborted(runtimeSignal);
      if (event.kind === "speech_started") {
        const engagement = resolveEngagement(currentEngagement(options));
        const selfAudio = latestInputFrame
          ? correlateSelfAudio(latestInputFrame, selfAudioReferences, {
              maxLagMs: options.selfAudioMaxLagMs,
            })
          : undefined;
        const state: UtteranceState = {
          startedAtMs: event.timestampMs,
          engaged: engagement.participates,
          selfAudio: !!selfAudio,
          speechEnded: false,
          committed: false,
          firstPartialObserved: false,
        };
        utterances.set(event.utteranceId, state);
        result.utterancesStarted += 1;
        observeVoiceTransition(options.observation, {
          stage: "speech_started",
          utteranceId: event.utteranceId,
          source: event.source,
          provider: options.recognition.name,
          eventTimestampMs: event.timestampMs,
          reasonCode: selfAudio ? "self_audio" : engagement.reason,
        });
        if (selfAudio) result.selfAudioSuppressions += 1;
        if (activeOutput) {
          const bargeIn = applyBargeIn(activeOutput, event, selfAudio);
          if (bargeIn.decision.interrupt) {
            result.bargeIns += 1;
            options.speaker?.cancel?.(bargeIn.decision.reason);
          }
        }
        continue;
      }

      const state = utterances.get(event.utteranceId);
      if (!state) continue;
      if (event.kind === "partial_transcript" && event.transcript) {
        result.partialsObserved += 1;
        if (!state.firstPartialObserved) {
          state.firstPartialObserved = true;
          observeVoiceTransition(options.observation, {
            stage: "first_partial",
            utteranceId: event.utteranceId,
            source: event.source,
            provider: event.transcript.provider,
            remote: event.transcript.remote,
            eventTimestampMs: event.timestampMs,
            stability: event.transcript.stability,
            confidence: event.transcript.confidence,
            completeness: event.transcript.completeness,
            textCharacters: event.transcript.text.length,
          });
        }
        if (!state.engaged || state.selfAudio) continue;
        speculation.get(event.utteranceId)?.abort("partial superseded");
        const controller = linkedAbortController(runtimeSignal);
        speculation.set(event.utteranceId, controller);
        if (
          signalSpeculativeInput(
            options.cognition,
            event.transcript,
            controller.signal,
            options.observation
          )
        ) {
          result.speculativeStarts += 1;
        }
        continue;
      }
      if (event.kind === "final_transcript" && event.transcript) {
        speculation.get(event.utteranceId)?.abort("final transcript received");
        speculation.delete(event.utteranceId);
        state.final = event.transcript;
        observeVoiceTransition(options.observation, {
          stage: "final",
          utteranceId: event.utteranceId,
          source: event.source,
          provider: event.transcript.provider,
          remote: event.transcript.remote,
          eventTimestampMs: event.timestampMs,
          stability: event.transcript.stability,
          confidence: event.transcript.confidence,
          completeness: event.transcript.completeness,
          textCharacters: event.transcript.text.length,
        });
        continue;
      }
      if (event.kind === "speech_ended") {
        state.speechEnded = true;
        continue;
      }
      if (event.kind !== "endpoint" || state.committed) continue;

      speculation.get(event.utteranceId)?.abort("utterance endpoint reached");
      speculation.delete(event.utteranceId);

      const engagement = resolveEngagement(currentEngagement(options));
      const endpoint = decideEndpoint(
        engagement.state,
        {
          nowMs: event.timestampMs,
          utteranceStartedAtMs: state.startedAtMs,
          providerEndpoint: true,
          pushToTalkReleased:
            engagement.state.mode === "push_to_talk" &&
            currentEngagement(options).pushToTalkActive === false,
          speechEnded: state.speechEnded,
          finalTranscript: !!state.final,
        },
        options.endpointPolicy
      );
      observeVoiceTransition(options.observation, {
        stage: "endpoint",
        utteranceId: event.utteranceId,
        source: event.source,
        provider: state.final?.provider ?? options.recognition.name,
        remote: state.final?.remote,
        eventTimestampMs: event.timestampMs,
        reasonCode:
          endpoint.reasons.join(",") || event.reason || "endpoint_rejected",
      });
      if (
        !state.engaged ||
        state.selfAudio ||
        !endpoint.isEndpoint ||
        !state.final
      ) {
        utterances.delete(event.utteranceId);
        continue;
      }
      state.committed = true;
      utterances.delete(event.utteranceId);
      result.committedInputs += 1;
      trackTask(
        commitTasks,
        handleCommittedInput(state.final, event),
        (error) => {
          commitFailure ??= error;
        }
      );
      if (
        options.maxCommittedInputs !== undefined &&
        result.committedInputs >= options.maxCommittedInputs
      ) {
        break;
      }
    }
    await Promise.all([...commitTasks]);
    await Promise.all([...playbackTasks]);
    if (commitFailure) throw commitFailure;
    if (playbackFailure) throw playbackFailure;
    return result;
  } catch (error) {
    if (runtimeSignal.aborted) {
      observeVoiceTransition(options.observation, {
        stage: "cancel",
        source: options.microphone.source,
        provider: options.recognition.name,
        reasonCode: "live_session_aborted",
      });
    }
    throw error;
  } finally {
    if (!sessionController.signal.aborted) {
      sessionController.abort(new Error("live voice session ended"));
    }
    for (const controller of speculation.values()) {
      controller.abort("live session ended");
    }
    activeOutput?.cancel("live session ended");
    await Promise.all([...commitTasks, ...playbackTasks]);
    await options.speaker?.close?.().catch(() => undefined);
  }

  async function handleCommittedInput(
    transcript: TranscriptUpdate,
    endpointEvent: SpeechEvent
  ): Promise<void> {
    const handled = await commitVoiceInput(
      options.cognition,
      transcript,
      runtimeSignal,
      options.observation
    );
    if (handled.experiences?.input) {
      result.inputExperienceIds.push(handled.experiences.input);
    }
    if (handled.experiences?.output) {
      result.outputExperienceIds.push(handled.experiences.output);
    }
    throwIfAborted(runtimeSignal);
    if (!handled.reply || !options.synthesis || !options.speaker) return;
    activeOutput?.cancel("new committed response");
    const output = startSpeechOutput(options.synthesis, handled.reply, {
      language: options.language,
      signal: runtimeSignal,
      utteranceId: endpointEvent.utteranceId,
      observation: options.observation,
    });
    activeOutput = output;
    result.outputsStarted += 1;
    trackTask(playbackTasks, play(output), (error) => {
      playbackFailure ??= error;
    });
  }

  async function play(output: CancellableSpeechOutput): Promise<void> {
    try {
      for await (const frame of output.frames) {
        await options.speaker!.write(frame, { signal: output.signal });
        output.markPlayback(frame);
        result.framesPlayed += 1;
        selfAudioReferences.push(createSelfAudioReference(output.id, frame));
        const max = options.maxSelfAudioReferences ?? 64;
        if (selfAudioReferences.length > max) {
          selfAudioReferences.splice(0, selfAudioReferences.length - max);
        }
      }
    } catch (error) {
      if (!output.signal.aborted) {
        recordDegradation(
          result,
          options,
          "speaker_playback_failed",
          "speaker_playback",
          options.synthesis?.name
        );
        throw error;
      }
    } finally {
      if (activeOutput?.id === output.id) activeOutput = undefined;
    }
  }
}

function currentEngagement(options: LiveVoiceSessionOptions): EngagementInput {
  return typeof options.engagement === "function"
    ? options.engagement()
    : options.engagement;
}

function linkedAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else {
    const propagate = (): void => controller.abort(signal.reason);
    signal.addEventListener("abort", propagate, { once: true });
    controller.signal.addEventListener(
      "abort",
      () => signal.removeEventListener("abort", propagate),
      { once: true }
    );
  }
  return controller;
}

function trackTask(
  tasks: Set<Promise<void>>,
  task: Promise<void>,
  onFailure: (error: unknown) => void
): void {
  let tracked: Promise<void>;
  tracked = task
    .catch((error) => {
      onFailure(error);
    })
    .finally(() => tasks.delete(tracked));
  tasks.add(tracked);
}

function pruneReferences(
  references: SelfAudioReference[],
  timestampMs: number,
  options: LiveVoiceSessionOptions
): void {
  const maxLagMs = options.selfAudioMaxLagMs ?? 500;
  while (
    references[0] &&
    timestampMs - references[0].timestampMs > maxLagMs
  ) {
    references.shift();
  }
}

function recordDegradation(
  result: LiveVoiceSessionResult,
  options: LiveVoiceSessionOptions,
  reasonCode: string,
  capability: string,
  provider?: string
): void {
  if (!result.degradations.includes(reasonCode)) {
    result.degradations.push(reasonCode);
  }
  observeVoiceDegradation(options.observation, {
    capability,
    reasonCode,
    provider,
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("live voice session aborted");
}

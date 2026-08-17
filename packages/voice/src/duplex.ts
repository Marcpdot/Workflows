/** Operation-local full-duplex speech output and interruption primitives. */

import { createHash, randomUUID } from "node:crypto";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";
import type {
  AudioFormat,
  AudioFrame,
  AudioSource,
  ProviderCapabilities,
  SpeechEvent,
  StreamingTtsAdapter,
} from "./types.js";

export interface MockStreamingTtsOptions {
  name?: string;
  source: AudioSource;
  format: AudioFormat;
  audioChunks: readonly Uint8Array[];
  startTimestampMs?: number;
}

/** Hardware-free native streaming fixture used to exercise duplex mechanics. */
export class MockStreamingTtsAdapter implements StreamingTtsAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    streamingInput: true,
    streamingOutput: true,
    partialTranscripts: false,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
    localOnly: true,
  };
  receivedText = "";

  constructor(private readonly options: MockStreamingTtsOptions) {
    this.name = options.name ?? "mock-streaming-tts";
  }

  async *synthesize(
    text: AsyncIterable<string> | string,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<AudioFrame> {
    let audioIndex = 0;
    const emitNext = (): AudioFrame | undefined => {
      const data = this.options.audioChunks[audioIndex];
      if (!data) return undefined;
      const frame = {
        data,
        format: this.options.format,
        timestampMs: (this.options.startTimestampMs ?? 0) + audioIndex,
        source: this.options.source,
      };
      audioIndex += 1;
      return frame;
    };

    if (typeof text === "string") {
      this.receivedText += text;
    } else {
      for await (const chunk of text) {
        throwIfAborted(opts.signal);
        this.receivedText += chunk;
        if (!chunk) continue;
        const frame = emitNext();
        if (frame) yield frame;
      }
    }

    while (audioIndex < this.options.audioChunks.length) {
      throwIfAborted(opts.signal);
      const frame = emitNext();
      if (frame) yield frame;
    }
  }
}

export interface CancellableSpeechOutput {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly frames: AsyncIterable<AudioFrame>;
  readonly active: boolean;
  readonly utteranceId?: string;
  readonly observation?: VoiceObservationContext;
  cancel(reason?: unknown): void;
  /** Call only after an audio sink has accepted a frame for playback. */
  markPlayback(frame: AudioFrame): void;
}

export interface StartSpeechOutputOptions {
  language?: string;
  signal?: AbortSignal;
  outputId?: string;
  utteranceId?: string;
  observation?: VoiceObservationContext;
}

/** Starts one independently cancellable speech output without owning perception. */
export function startSpeechOutput(
  adapter: StreamingTtsAdapter,
  text: AsyncIterable<string> | string,
  options: StartSpeechOutputOptions = {}
): CancellableSpeechOutput {
  const controller = new AbortController();
  const outputId = options.outputId ?? randomUUID();
  let finished = false;
  let firstAudioObserved = false;
  const abortOutput = (reasonCode: string, reason?: unknown): void => {
    if (finished || controller.signal.aborted) return;
    observeVoiceTransition(options.observation, {
      stage: "cancel",
      utteranceId: options.utteranceId,
      outputId,
      reasonCode,
    });
    controller.abort(reason);
  };
  const abortFromCaller = (): void =>
    abortOutput("upstream_aborted", options.signal?.reason);

  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  const frames = relayFrames(
    adapter.synthesize(text, {
      language: options.language,
      signal: controller.signal,
    })
  );

  async function* relayFrames(
    source: AsyncIterable<AudioFrame>
  ): AsyncIterable<AudioFrame> {
    try {
      for await (const frame of source) {
        throwIfAborted(controller.signal);
        if (!firstAudioObserved) {
          firstAudioObserved = true;
          observeVoiceTransition(options.observation, {
            stage: "tts_first_audio",
            utteranceId: options.utteranceId,
            outputId,
            source: frame.source,
            provider: adapter.name,
            eventTimestampMs: frame.timestampMs,
            audioBytes: frame.data.length,
          });
        }
        yield frame;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        observeVoiceDegradation(options.observation, {
          capability: "tts",
          reasonCode: "streaming_synthesis_failed",
          utteranceId: options.utteranceId,
          outputId,
          provider: adapter.name,
        });
      }
      throw error;
    } finally {
      finished = true;
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  return {
    id: outputId,
    signal: controller.signal,
    frames,
    utteranceId: options.utteranceId,
    observation: options.observation,
    get active() {
      return !finished && !controller.signal.aborted;
    },
    cancel(reason?: unknown) {
      abortOutput("output_cancelled", reason);
    },
    markPlayback(frame: AudioFrame) {
      observeVoiceTransition(options.observation, {
        stage: "playback",
        utteranceId: options.utteranceId,
        outputId,
        source: frame.source,
        provider: adapter.name,
        eventTimestampMs: frame.timestampMs,
        audioBytes: frame.data.length,
      });
    },
  };
}

export interface SelfAudioReference {
  outputId: string;
  signature: string;
  timestampMs: number;
}

export interface SelfAudioMatch {
  outputId: string;
  referenceTimestampMs: number;
  lagMs: number;
}

/** Creates a content signature for a recently emitted frame, not durable audio. */
export function createSelfAudioReference(
  outputId: string,
  frame: AudioFrame
): SelfAudioReference {
  return {
    outputId,
    signature: audioSignature(frame),
    timestampMs: frame.timestampMs,
  };
}

/**
 * Correlates exact recent output audio with perceived input in a bounded window.
 * Providers may replace this conservative fixture-grade signal with echo
 * cancellation/correlation suited to their audio transport.
 */
export function correlateSelfAudio(
  input: AudioFrame,
  references: readonly SelfAudioReference[],
  options: { maxLagMs?: number } = {}
): SelfAudioMatch | undefined {
  const maxLagMs = options.maxLagMs ?? 500;
  const signature = audioSignature(input);

  for (let index = references.length - 1; index >= 0; index -= 1) {
    const reference = references[index];
    if (!reference || reference.signature !== signature) continue;
    const lagMs = input.timestampMs - reference.timestampMs;
    if (lagMs < 0 || lagMs > maxLagMs) continue;
    return {
      outputId: reference.outputId,
      referenceTimestampMs: reference.timestampMs,
      lagMs,
    };
  }
  return undefined;
}

export type BargeInReason =
  | "external_speech_started"
  | "self_audio"
  | "not_speech_started"
  | "output_inactive";

export interface BargeInDecision {
  interrupt: boolean;
  reason: BargeInReason;
}

export interface SpeechOutputState {
  id: string;
  active: boolean;
}

export interface BargeInResult {
  decision: BargeInDecision;
  event?: SpeechEvent;
}

/** Pure decision: only newly detected external speech interrupts output. */
export function decideBargeIn(
  event: SpeechEvent,
  output: SpeechOutputState,
  selfAudio?: SelfAudioMatch
): BargeInDecision {
  if (!output.active) return { interrupt: false, reason: "output_inactive" };
  if (event.kind !== "speech_started") {
    return { interrupt: false, reason: "not_speech_started" };
  }
  if (selfAudio?.outputId === output.id) {
    return { interrupt: false, reason: "self_audio" };
  }
  return { interrupt: true, reason: "external_speech_started" };
}

/** Applies barge-in to one output; it does not decide cognitive commitment. */
export function applyBargeIn(
  output: CancellableSpeechOutput,
  event: SpeechEvent,
  selfAudio?: SelfAudioMatch
): BargeInResult {
  const decision = decideBargeIn(event, output, selfAudio);
  if (!decision.interrupt) return { decision };

  observeVoiceTransition(output.observation, {
    stage: "barge_in",
    utteranceId: event.utteranceId,
    outputId: output.id,
    source: event.source,
    eventTimestampMs: event.timestampMs,
    reasonCode: decision.reason,
  });
  output.cancel(new Error(`speech output ${output.id} interrupted`));
  return {
    decision,
    event: {
      kind: "barge_in",
      utteranceId: event.utteranceId,
      reason: `interrupted_output:${output.id}`,
      timestampMs: event.timestampMs,
      source: event.source,
    },
  };
}

function audioSignature(frame: AudioFrame): string {
  return createHash("sha256")
    .update(
      `${frame.format.sampleRate}:${frame.format.channels}:${frame.format.encoding}:`
    )
    .update(frame.data)
    .digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("voice output aborted");
}

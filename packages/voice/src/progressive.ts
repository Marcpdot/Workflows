/** Deterministic progressive speech fixtures and representation helpers. */

import { randomUUID } from "node:crypto";
import type {
  AudioFrame,
  ProviderCapabilities,
  SpeechEvent,
  SpeechUtterance,
  StreamingSttAdapter,
  TranscriptStability,
} from "./types.js";

export interface MockTranscriptStep {
  text: string;
  stability: TranscriptStability;
  confidence?: number;
  completeness?: number;
}

export interface MockStreamingSttOptions {
  name?: string;
  utteranceId?: string;
  /** Explicit retained-audio reference; omitted for normal ephemeral fixtures. */
  audioRef?: string;
  updates?: readonly MockTranscriptStep[];
}

const DEFAULT_UPDATES: readonly MockTranscriptStep[] = [
  {
    text: "hello from mock",
    stability: "partial",
    confidence: 0.65,
    completeness: 0.5,
  },
  {
    text: "hello from mock streaming stt",
    stability: "final",
    confidence: 0.95,
    completeness: 1,
  },
];

/**
 * Hardware-free native streaming STT fixture. It emits representation events
 * only: no handle call, durable write, semantic promotion, or commitment.
 */
export class MockStreamingSttAdapter implements StreamingSttAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    streamingInput: true,
    streamingOutput: true,
    partialTranscripts: true,
    wordTimestamps: false,
    cancellation: true,
    diarization: false,
    localOnly: true,
  };
  private readonly updates: readonly MockTranscriptStep[];

  constructor(private readonly options: MockStreamingSttOptions = {}) {
    this.name = options.name ?? "mock-streaming-stt";
    this.updates = options.updates ?? DEFAULT_UPDATES;
    validateUpdates(this.updates);
  }

  async *recognize(
    frames: AsyncIterable<AudioFrame>,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<SpeechEvent> {
    throwIfAborted(opts.signal);
    const iterator = frames[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      throw new Error("MockStreamingSttAdapter: at least one frame is required");
    }
    const source = first.value.source;
    const utteranceId = this.options.utteranceId ?? randomUUID();
    let timestampMs = first.value.timestampMs;

    try {
      yield {
        kind: "speech_started",
        utteranceId,
        timestampMs,
        source,
      };

      for (const update of this.updates) {
        throwIfAborted(opts.signal);
        timestampMs++;
        const transcript = {
          ...update,
          isEndpoint: false,
          utteranceId,
          source,
          provider: this.name,
          remote: false,
          ...(this.options.audioRef
            ? { audioRef: this.options.audioRef }
            : {}),
          timestampMs,
        };
        yield {
          kind:
            update.stability === "final"
              ? "final_transcript"
              : "partial_transcript",
          utteranceId,
          transcript,
          timestampMs,
          source,
        };
      }

      throwIfAborted(opts.signal);
      yield {
        kind: "speech_ended",
        utteranceId,
        timestampMs: ++timestampMs,
        source,
      };
      yield {
        kind: "endpoint",
        utteranceId,
        reason: "mock_stream_endpoint",
        timestampMs: ++timestampMs,
        source,
      };
    } finally {
      await iterator.return?.();
    }
  }
}

/** Build one in-memory utterance without assigning commitment or truth status. */
export function assembleSpeechUtterance(
  events: readonly SpeechEvent[]
): SpeechUtterance {
  const first = events[0];
  if (!first) throw new Error("assembleSpeechUtterance: events are required");
  if (events.some((event) => event.utteranceId !== first.utteranceId)) {
    throw new Error("assembleSpeechUtterance: mixed utterance IDs");
  }
  const started =
    events.find((event) => event.kind === "speech_started") ?? first;
  const ended = [...events]
    .reverse()
    .find((event) => event.kind === "speech_ended");
  const final = [...events]
    .reverse()
    .find((event) => event.kind === "final_transcript");
  return {
    id: first.utteranceId,
    source: first.source,
    startedAtMs: started.timestampMs,
    endedAtMs: ended?.timestampMs,
    finalText: final?.transcript?.text,
    events: [...events],
  };
}

function validateUpdates(updates: readonly MockTranscriptStep[]): void {
  if (!updates.length) {
    throw new Error("MockStreamingSttAdapter: at least one update is required");
  }
  const finalIndexes = updates.flatMap((update, index) =>
    update.stability === "final" ? [index] : []
  );
  if (
    finalIndexes.length !== 1 ||
    finalIndexes[0] !== updates.length - 1
  ) {
    throw new Error(
      "MockStreamingSttAdapter: exactly one final update must be last"
    );
  }
  if (updates.some((update) => !update.text.trim())) {
    throw new Error("MockStreamingSttAdapter: transcript text cannot be empty");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("voice operation aborted");
}

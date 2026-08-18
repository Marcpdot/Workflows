/** Incremental microphone recognition with VAD-bounded legacy STT segments. */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";
import { SpeechActivityTracker, type VoiceActivityDetector } from "./vad.js";
import type {
  AudioFormat,
  AudioFrame,
  SpeechEvent,
  SpeechProviderMetadata,
  SpeechRecognitionCapabilities,
  SttAdapter,
  StreamingSttAdapter,
} from "./types.js";

export interface SegmentedStreamingSttOptions {
  detector: VoiceActivityDetector;
  provider: SpeechProviderMetadata;
  cancellation?: boolean;
  endSilenceMs?: number;
  maxSegmentMs?: number;
  maxSegmentBytes?: number;
  createUtteranceId?: () => string;
  observation?: VoiceObservationContext;
}

/**
 * Honest fallback for local STT commands without partial recognition: frames
 * remain live, VAD closes bounded segments, and each segment yields one final.
 */
export class SegmentedStreamingSttAdapter implements StreamingSttAdapter {
  readonly name: string;
  readonly provider: SpeechProviderMetadata;
  readonly capabilities: SpeechRecognitionCapabilities;
  private readonly maxSegmentMs: number;
  private readonly maxSegmentBytes: number;

  constructor(
    private readonly adapter: SttAdapter,
    private readonly options: SegmentedStreamingSttOptions
  ) {
    this.name = `${adapter.name}-vad-segmented`;
    this.provider = { ...options.provider };
    this.capabilities = {
      streamingInput: true,
      partialTranscripts: false,
      wordTimestamps: false,
      cancellation: options.cancellation ?? false,
      diarization: false,
    };
    this.maxSegmentMs = options.maxSegmentMs ?? 30_000;
    this.maxSegmentBytes = options.maxSegmentBytes ?? 16_000 * 2 * 35;
  }

  async *recognize(
    frames: AsyncIterable<AudioFrame>,
    input: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<SpeechEvent> {
    const tracker = new SpeechActivityTracker(this.options.detector, {
      endSilenceMs: this.options.endSilenceMs,
    });
    let segment: AudioFrame[] = [];
    let utteranceId: string | undefined;
    let segmentStartedAtMs = 0;
    observeVoiceDegradation(this.options.observation, {
      capability: "partial_transcripts",
      reasonCode: "vad_segmented_stt_no_partials",
      provider: this.name,
    });

    for await (const frame of frames) {
      throwIfAborted(input.signal);
      const activity = tracker.push(frame);
      if (!activity) continue;

      if (activity.kind === "speech_started") {
        segment = [frame];
        utteranceId = this.options.createUtteranceId?.() ?? randomUUID();
        segmentStartedAtMs = frame.timestampMs;
        observeVoiceTransition(this.options.observation, {
          stage: "speech_started",
          utteranceId,
          source: frame.source,
          provider: this.name,
          eventTimestampMs: frame.timestampMs,
        });
        yield {
          kind: "speech_started",
          utteranceId,
          timestampMs: frame.timestampMs,
          source: frame.source,
        };
        continue;
      }

      if (!utteranceId) continue;
      segment.push(frame);
      const bytes = segment.reduce((sum, item) => sum + item.data.length, 0);
      const bounded =
        bytes >= this.maxSegmentBytes ||
        frame.timestampMs - segmentStartedAtMs >= this.maxSegmentMs;
      if (activity.kind !== "speech_ended" && !bounded) continue;

      const reason = bounded ? "bounded_segment_limit" : "vad_speech_ended";
      const events = await this.transcribeSegment(
        segment,
        utteranceId,
        activity.silenceMs,
        reason,
        input
      );
      for (const event of events) yield event;
      segment = [];
      utteranceId = undefined;
      tracker.reset();
    }

    if (utteranceId && segment.length) {
      const events = await this.transcribeSegment(
        segment,
        utteranceId,
        0,
        "capture_stream_ended",
        input
      );
      for (const event of events) yield event;
    }
  }

  private async transcribeSegment(
    frames: AudioFrame[],
    utteranceId: string,
    silenceMs: number,
    reason: string,
    input: { language?: string; signal?: AbortSignal }
  ): Promise<SpeechEvent[]> {
    throwIfAborted(input.signal);
    const first = frames[0];
    if (!first) return [];
    assertUniformFormat(frames);
    const directory = await mkdtemp(join(tmpdir(), "workflows-voice-segment-"));
    const audioPath = join(directory, "segment.wav");
    try {
      const pcm = concatenate(frames);
      await writeFile(audioPath, createWave(pcm, first.format));
      const result = await this.adapter.transcribe({
        audioPath,
        audio: pcm,
        language: input.language,
        signal: input.signal,
      });
      throwIfAborted(input.signal);
      const text = result.text.trim();
      if (!text) return [];
      const timestampMs = Date.now();
      const transcript = {
        text,
        stability: "final" as const,
        completeness: 1,
        isEndpoint: false,
        utteranceId,
        source: first.source,
        provider: this.name,
        remote: result.remote,
        timestampMs,
      };
      observeVoiceTransition(this.options.observation, {
        stage: "final",
        utteranceId,
        source: first.source,
        provider: this.name,
        remote: result.remote,
        eventTimestampMs: timestampMs,
        stability: "final",
        textCharacters: text.length,
      });
      observeVoiceTransition(this.options.observation, {
        stage: "endpoint",
        utteranceId,
        source: first.source,
        provider: this.name,
        remote: result.remote,
        eventTimestampMs: timestampMs,
        reasonCode: reason,
        silenceMs,
      });
      return [
        {
          kind: "final_transcript",
          utteranceId,
          transcript,
          timestampMs,
          source: first.source,
        },
        {
          kind: "speech_ended",
          utteranceId,
          reason,
          timestampMs,
          source: first.source,
        },
        {
          kind: "endpoint",
          utteranceId,
          reason,
          timestampMs,
          source: first.source,
        },
      ];
    } catch (error) {
      observeVoiceDegradation(this.options.observation, {
        capability: "stt",
        reasonCode: input.signal?.aborted
          ? "segmented_transcription_cancelled"
          : "segmented_transcription_failed",
        utteranceId,
        provider: this.name,
      });
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function concatenate(frames: readonly AudioFrame[]): Uint8Array {
  const size = frames.reduce((sum, frame) => sum + frame.data.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame.data, offset);
    offset += frame.data.length;
  }
  return output;
}

function createWave(pcm: Uint8Array, format: AudioFormat): Uint8Array {
  if (format.encoding !== "pcm_s16le" && format.encoding !== "pcm_f32le") {
    throw new Error("segmented STT requires raw PCM input");
  }
  const bitsPerSample = format.encoding === "pcm_f32le" ? 32 : 16;
  const bytesPerSample = bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(format.encoding === "pcm_f32le" ? 3 : 1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * format.channels * bytesPerSample, 28);
  header.writeUInt16LE(format.channels * bytesPerSample, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

function assertUniformFormat(frames: readonly AudioFrame[]): void {
  const first = frames[0]?.format;
  if (!first) return;
  for (const frame of frames) {
    if (
      frame.format.sampleRate !== first.sampleRate ||
      frame.format.channels !== first.channels ||
      frame.format.encoding !== first.encoding
    ) {
      throw new Error("audio format changed within one speech segment");
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("segmented recognition aborted");
}

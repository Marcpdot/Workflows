/** Buffered compatibility bridges for the streaming voice contracts. */

import { randomUUID } from "node:crypto";
import type {
  AudioFormat,
  AudioFrame,
  AudioSource,
  ProviderCapabilities,
  SpeechEvent,
  SttAdapter,
  SttInput,
  StreamingSttAdapter,
  StreamingTtsAdapter,
  TtsAdapter,
  TtsInput,
} from "./types.js";

export interface BufferedStreamingSttOptions {
  /** Must describe the wrapped adapter's real behavior. */
  capabilities: ProviderCapabilities;
  /** Optional legacy file/transcript input retained when frames are buffered. */
  input?: Omit<SttInput, "audio" | "language">;
  createUtteranceId?: () => string;
}

/**
 * Exposes an existing one-shot STT adapter through the streaming contract.
 * It deliberately emits only one final transcript; progressive events belong
 * to native streaming adapters.
 */
export class BufferedStreamingSttAdapter implements StreamingSttAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly adapter: SttAdapter,
    private readonly options: BufferedStreamingSttOptions
  ) {
    this.name = adapter.name;
    this.capabilities = { ...options.capabilities };
  }

  async *recognize(
    frames: AsyncIterable<AudioFrame>,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<SpeechEvent> {
    const buffered = await collectFrames(frames, opts.signal);
    const first = buffered[0];
    if (!first) {
      throw new Error("BufferedStreamingSttAdapter: at least one frame is required");
    }
    throwIfAborted(opts.signal);
    const result = await this.adapter.transcribe({
      ...this.options.input,
      audio: concatenateAudio(buffered),
      language: opts.language,
    });
    throwIfAborted(opts.signal);
    const text = result.text.trim();
    if (!text) {
      throw new Error("BufferedStreamingSttAdapter: empty transcript");
    }
    const utteranceId = this.options.createUtteranceId?.() ?? randomUUID();
    const timestampMs = Date.now();
    const transcript = {
      text,
      stability: "final" as const,
      utteranceId,
      source: first.source,
      provider: this.name,
      remote: result.remote,
      timestampMs,
    };
    yield {
      kind: "final_transcript",
      utteranceId,
      transcript,
      timestampMs,
      source: first.source,
    };
  }
}

export interface BufferedStreamingTtsOptions {
  /** Must describe the wrapped adapter's real behavior. */
  capabilities: ProviderCapabilities;
  outputFormat: AudioFormat;
  outputSource: AudioSource;
  /** Optional legacy output-file input used by file-based TTS adapters. */
  input?: Omit<TtsInput, "text" | "language">;
}

/**
 * Buffers text for an existing one-shot TTS adapter. If that adapter returns
 * in-memory audio, it is exposed as one frame; file/playback side effects remain
 * available through the legacy result without pretending they are streaming.
 */
export class BufferedStreamingTtsAdapter implements StreamingTtsAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly adapter: TtsAdapter,
    private readonly options: BufferedStreamingTtsOptions
  ) {
    this.name = adapter.name;
    this.capabilities = { ...options.capabilities };
  }

  async *synthesize(
    text: AsyncIterable<string> | string,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<AudioFrame> {
    const bufferedText = await collectText(text, opts.signal);
    throwIfAborted(opts.signal);
    const result = await this.adapter.speak({
      ...this.options.input,
      text: bufferedText,
      language: opts.language,
    });
    throwIfAborted(opts.signal);
    if (!result.audio?.length) return;
    yield {
      data: result.audio,
      format: this.options.outputFormat,
      timestampMs: Date.now(),
      source: this.options.outputSource,
    };
  }
}

async function collectFrames(
  frames: AsyncIterable<AudioFrame>,
  signal?: AbortSignal
): Promise<AudioFrame[]> {
  const collected: AudioFrame[] = [];
  for await (const frame of frames) {
    throwIfAborted(signal);
    collected.push(frame);
  }
  return collected;
}

function concatenateAudio(frames: AudioFrame[]): Uint8Array {
  const size = frames.reduce((total, frame) => total + frame.data.length, 0);
  const audio = new Uint8Array(size);
  let offset = 0;
  for (const frame of frames) {
    audio.set(frame.data, offset);
    offset += frame.data.length;
  }
  return audio;
}

async function collectText(
  text: AsyncIterable<string> | string,
  signal?: AbortSignal
): Promise<string> {
  if (typeof text === "string") return text;
  let collected = "";
  for await (const chunk of text) {
    throwIfAborted(signal);
    collected += chunk;
  }
  return collected;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("voice operation aborted");
}

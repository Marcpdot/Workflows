/** Streaming audio transport contracts and command-backed local I/O. */

import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";
import type { AudioFormat, AudioFrame, AudioSource } from "./types.js";

export interface MicrophoneFrameSource {
  readonly source: AudioSource;
  readonly format: AudioFormat;
  capture(options: { signal: AbortSignal }): AsyncIterable<AudioFrame>;
}

export interface AudioPlaybackSink {
  readonly source: AudioSource;
  readonly format: AudioFormat;
  /** Resolves only after the sink has accepted the frame. */
  write(frame: AudioFrame, options: { signal: AbortSignal }): Promise<void>;
  close?(): Promise<void>;
  cancel?(reason?: unknown): void;
}

export interface CommandMicrophoneOptions {
  command: string;
  source: AudioSource;
  format: AudioFormat;
  observation?: VoiceObservationContext;
}

/**
 * Reads raw PCM incrementally from a caller-configured command's stdout.
 * The command owns device selection; this class never creates a complete file.
 */
export class CommandMicrophoneSource implements MicrophoneFrameSource {
  readonly source: AudioSource;
  readonly format: AudioFormat;

  constructor(private readonly options: CommandMicrophoneOptions) {
    if (!options.command.trim()) {
      throw new Error("CommandMicrophoneSource: command is required");
    }
    assertPcmFormat(options.format, "microphone");
    this.source = { ...options.source };
    this.format = { ...options.format };
  }

  async *capture(input: { signal: AbortSignal }): AsyncIterable<AudioFrame> {
    throwIfAborted(input.signal);
    const child = spawn(this.options.command, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let processError: Error | undefined;
    let emittedBytes = 0;
    const startedAtMs = Date.now();
    const onAbort = (): void => {
      child.kill();
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      processError = error;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString("utf8");
    });
    observeVoiceTransition(this.options.observation, {
      stage: "microphone_capture_start",
      source: this.source,
      eventTimestampMs: startedAtMs,
      reasonCode: "command_pcm_stdout",
    });

    try {
      for await (const chunk of child.stdout) {
        throwIfAborted(input.signal);
        const data = new Uint8Array(chunk as Buffer);
        if (!data.length) continue;
        const timestampMs =
          startedAtMs + bytesToDurationMs(emittedBytes, this.format);
        emittedBytes += data.length;
        yield {
          data,
          format: this.format,
          timestampMs,
          source: this.source,
        };
      }
      const code = await childExit(child);
      throwIfAborted(input.signal);
      if (processError) throw processError;
      if (code !== 0) {
        observeVoiceDegradation(this.options.observation, {
          capability: "microphone_capture",
          reasonCode: "capture_command_failed",
        });
        throw new Error(
          `microphone capture command failed (code ${code}): ${stderr.trim()}`
        );
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}

export interface CommandPlaybackOptions {
  command: string;
  source: AudioSource;
  format: AudioFormat;
}

/** Streams raw PCM to a caller-configured playback command's stdin. */
export class CommandPlaybackSink implements AudioPlaybackSink {
  readonly source: AudioSource;
  readonly format: AudioFormat;
  private child?: ChildProcessWithoutNullStreams;
  private processError?: Error;
  private closed = false;

  constructor(private readonly options: CommandPlaybackOptions) {
    if (!options.command.trim()) {
      throw new Error("CommandPlaybackSink: command is required");
    }
    assertPcmFormat(options.format, "playback");
    this.source = { ...options.source };
    this.format = { ...options.format };
  }

  async write(
    frame: AudioFrame,
    input: { signal: AbortSignal }
  ): Promise<void> {
    throwIfAborted(input.signal);
    if (this.closed) throw new Error("playback sink is closed");
    assertSameFormat(frame.format, this.format);
    const child = this.child ?? (this.child = this.start());
    const onAbort = (): void => this.cancel(input.signal.reason);
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(frame.data, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      throwIfAborted(input.signal);
    } finally {
      input.signal.removeEventListener("abort", onAbort);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    const code = await childExit(child);
    if (this.processError) throw this.processError;
    if (code !== 0) {
      throw new Error(`playback command failed (code ${code})`);
    }
  }

  cancel(_reason?: unknown): void {
    this.child?.stdin.destroy();
    this.child?.kill();
    this.child = undefined;
    this.processError = undefined;
  }

  private start(): ChildProcessWithoutNullStreams {
    const child = spawn(this.options.command, {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.once("error", (error) => {
      this.processError = error;
    });
    child.stdin.on("error", (error) => {
      this.processError = error;
    });
    return child;
  }
}

export function audioFrameDurationMs(frame: AudioFrame): number {
  return bytesToDurationMs(frame.data.length, frame.format);
}

function bytesToDurationMs(bytes: number, format: AudioFormat): number {
  const bytesPerSample = format.encoding === "pcm_f32le" ? 4 : 2;
  return Math.round(
    (bytes / (bytesPerSample * format.channels * format.sampleRate)) * 1_000
  );
}

function assertPcmFormat(format: AudioFormat, owner: string): void {
  if (format.encoding !== "pcm_s16le" && format.encoding !== "pcm_f32le") {
    throw new Error(`${owner} streaming requires pcm_s16le or pcm_f32le`);
  }
  if (format.sampleRate <= 0 || format.channels <= 0) {
    throw new Error(`${owner} audio format must have a positive rate and channels`);
  }
}

function assertSameFormat(actual: AudioFormat, expected: AudioFormat): void {
  if (
    actual.sampleRate !== expected.sampleRate ||
    actual.channels !== expected.channels ||
    actual.encoding !== expected.encoding
  ) {
    throw new Error("playback frame format does not match the sink format");
  }
}

function childExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once("close", resolve);
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("audio transport aborted");
}

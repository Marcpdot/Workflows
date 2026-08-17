/** Command-backed streaming synthesis: UTF-8 text stdin, raw PCM stdout. */

import { spawn } from "node:child_process";
import { audioFrameDurationMs } from "./audioTransport.js";
import type {
  AudioFormat,
  AudioFrame,
  AudioSource,
  SpeechProviderMetadata,
  SpeechSynthesisCapabilities,
  StreamingTtsAdapter,
} from "./types.js";

export interface CommandStreamingTtsOptions {
  name?: string;
  command: string;
  provider: SpeechProviderMetadata;
  format: AudioFormat;
  source: AudioSource;
}

/**
 * The transport is genuinely incremental in both directions. A particular
 * command may still internally buffer; that limitation remains provider-owned.
 */
export class CommandStreamingTtsAdapter implements StreamingTtsAdapter {
  readonly name: string;
  readonly provider: SpeechProviderMetadata;
  readonly capabilities: SpeechSynthesisCapabilities = {
    streamingOutput: true,
    streamingTextInput: true,
    cancellation: true,
  };

  constructor(private readonly options: CommandStreamingTtsOptions) {
    if (!options.command.trim()) {
      throw new Error("CommandStreamingTtsAdapter: command is required");
    }
    if (
      options.format.encoding !== "pcm_s16le" &&
      options.format.encoding !== "pcm_f32le"
    ) {
      throw new Error("command streaming TTS requires raw PCM output");
    }
    this.name = options.name ?? "command-streaming-tts";
    this.provider = { ...options.provider };
  }

  async *synthesize(
    text: AsyncIterable<string> | string,
    input: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<AudioFrame> {
    throwIfAborted(input.signal);
    const child = spawn(this.options.command, {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(input.language ? { VOICE_LANGUAGE: input.language } : {}),
      },
    });
    let stderr = "";
    let processError: Error | undefined;
    let emittedMs = 0;
    const startedAtMs = Date.now();
    const onAbort = (): void => {
      child.kill();
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      processError = error;
    });
    child.stdin.on("error", (error) => {
      processError = error;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString("utf8");
    });
    const pump = writeText(child.stdin, text, input.signal);

    try {
      for await (const chunk of child.stdout) {
        throwIfAborted(input.signal);
        const frame: AudioFrame = {
          data: new Uint8Array(chunk as Buffer),
          format: this.options.format,
          timestampMs: startedAtMs + emittedMs,
          source: this.options.source,
        };
        emittedMs += audioFrameDurationMs(frame);
        if (frame.data.length) yield frame;
      }
      await pump;
      const code = await childExit(child);
      throwIfAborted(input.signal);
      if (processError) throw processError;
      if (code !== 0) {
        throw new Error(
          `streaming TTS command failed (code ${code}): ${stderr.trim()}`
        );
      }
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}

async function writeText(
  stdin: NodeJS.WritableStream,
  text: AsyncIterable<string> | string,
  signal?: AbortSignal
): Promise<void> {
  if (typeof text === "string") {
    throwIfAborted(signal);
    stdin.write(text);
  } else {
    for await (const chunk of text) {
      throwIfAborted(signal);
      if (chunk) stdin.write(chunk);
    }
  }
  stdin.end();
}

function childExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once("close", resolve);
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("streaming synthesis aborted");
}

/**
 * TTS adapters — off (default), mock, local CLI shell, cloud stub.
 */

import { spawn } from "node:child_process";
import type {
  TtsAdapter,
  TtsInput,
  TtsProviderName,
  TtsResult,
  VoiceConfig,
} from "./types.js";

/** Default: never speaks. */
export class OffTtsAdapter implements TtsAdapter {
  readonly name: TtsProviderName = "off";
  async speak(_input: TtsInput): Promise<TtsResult> {
    return { spoken: false, provider: "off", remote: false };
  }
}

/** Records utterances for smoke/tests; no audio device. */
export class MockTtsAdapter implements TtsAdapter {
  readonly name: TtsProviderName = "mock";
  readonly utterances: string[] = [];

  async speak(input: TtsInput): Promise<TtsResult> {
    const text = input.text?.trim() ?? "";
    if (text) this.utterances.push(text);
    return {
      spoken: text.length > 0,
      provider: "mock",
      remote: false,
      utterance: text || undefined,
    };
  }
}

/**
 * Local TTS via external command.
 * VOICE_TTS_COMMAND example: `say {text}` or `espeak "{text}" -w {output}`
 */
export class LocalTtsAdapter implements TtsAdapter {
  readonly name: TtsProviderName = "local";
  constructor(private readonly commandTemplate: string) {
    if (!commandTemplate?.trim()) {
      throw new Error(
        "LocalTtsAdapter: VOICE_TTS_COMMAND is required (e.g. espeak \"{text}\")"
      );
    }
  }

  async speak(input: TtsInput): Promise<TtsResult> {
    const text = input.text?.trim() ?? "";
    if (!text) {
      return { spoken: false, provider: "local", remote: false };
    }
    const output = input.outputPath ?? "";
    const cmd = this.commandTemplate
      .replaceAll("{text}", text.replace(/"/g, '\\"'))
      .replaceAll("{output}", output);
    await runCommand(cmd);
    return {
      spoken: true,
      provider: "local",
      remote: false,
      outputPath: output || undefined,
    };
  }
}

export class CloudTtsAdapter implements TtsAdapter {
  readonly name: TtsProviderName = "cloud";
  constructor(private readonly allowRemote: boolean) {}

  async speak(input: TtsInput): Promise<TtsResult> {
    if (!input.text?.trim()) {
      return { spoken: false, provider: "cloud", remote: false };
    }
    if (!this.allowRemote) {
      throw new Error(
        "CloudTtsAdapter: blocked — set VOICE_ALLOW_REMOTE_AUDIO=true to send text to a remote TTS, " +
          "or use VOICE_TTS_PROVIDER=off|mock|local."
      );
    }
    throw new Error(
      "CloudTtsAdapter: no cloud SDK wired in this shell. " +
        "Use VOICE_TTS_PROVIDER=mock for tests or local with VOICE_TTS_COMMAND."
    );
  }
}

export function createTtsAdapter(config: VoiceConfig): TtsAdapter {
  switch (config.ttsProvider) {
    case "mock":
      return new MockTtsAdapter();
    case "local":
      return new LocalTtsAdapter(
        config.ttsCommand ?? process.env.VOICE_TTS_COMMAND ?? ""
      );
    case "cloud":
      return new CloudTtsAdapter(config.allowRemoteAudio);
    case "off":
    default:
      return new OffTtsAdapter();
  }
}

function runCommand(commandLine: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, { shell: true, windowsHide: true });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Local TTS command failed (code ${code}): ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

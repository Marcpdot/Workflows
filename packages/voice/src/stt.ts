/**
 * STT adapters — mock (offline), local CLI shell, cloud stub.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type {
  SttAdapter,
  SttInput,
  SttProviderName,
  SttResult,
  VoiceConfig,
} from "./types.js";

export class MockSttAdapter implements SttAdapter {
  readonly name: SttProviderName = "mock";
  constructor(private readonly defaultTranscript = "hello from mock stt") {}

  async transcribe(input: SttInput): Promise<SttResult> {
    const text = (
      input.transcript?.trim() ||
      this.defaultTranscript
    ).trim();
    if (!text) {
      throw new Error("MockSttAdapter: empty transcript");
    }
    return {
      text,
      provider: "mock",
      remote: false,
    };
  }
}

/**
 * Local STT via external command (e.g. whisper.cpp CLI).
 * VOICE_STT_COMMAND example: `whisper-cli -f {input} -l en -nt`
 * Stdout is treated as transcript.
 */
export class LocalSttAdapter implements SttAdapter {
  readonly name: SttProviderName = "local";
  constructor(private readonly commandTemplate: string) {
    if (!commandTemplate?.trim()) {
      throw new Error(
        "LocalSttAdapter: VOICE_STT_COMMAND is required (e.g. whisper-cli -f {input})"
      );
    }
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    if (input.transcript?.trim()) {
      // Allow override without running CLI (tests)
      return {
        text: input.transcript.trim(),
        provider: "local",
        remote: false,
      };
    }
    const audioPath = input.audioPath?.trim();
    if (!audioPath) {
      throw new Error("LocalSttAdapter: audioPath is required");
    }
    if (!existsSync(audioPath)) {
      throw new Error(`LocalSttAdapter: audio file not found: ${audioPath}`);
    }
    const cmd = this.commandTemplate.replaceAll("{input}", audioPath);
    const started = Date.now();
    const text = await runCommandCapture(cmd);
    return {
      text: text.trim(),
      provider: "local",
      remote: false,
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Cloud STT shell — documents remote path; refuses unless allowRemoteAudio.
 * Real provider SDKs are intentionally not bundled (privacy + deps).
 */
export class CloudSttAdapter implements SttAdapter {
  readonly name: SttProviderName = "cloud";
  constructor(private readonly allowRemote: boolean) {}

  async transcribe(input: SttInput): Promise<SttResult> {
    if (input.transcript?.trim()) {
      return {
        text: input.transcript.trim(),
        provider: "cloud",
        remote: false,
      };
    }
    if (!this.allowRemote) {
      throw new Error(
        "CloudSttAdapter: blocked — set VOICE_ALLOW_REMOTE_AUDIO=true to send audio off-machine, " +
          "or use VOICE_STT_PROVIDER=mock|local. Prefer local STT for privacy."
      );
    }
    throw new Error(
      "CloudSttAdapter: no cloud SDK wired in this shell. " +
        "Plug your provider here, or set VOICE_STT_PROVIDER=local with VOICE_STT_COMMAND. " +
        "For offline tests use mock + transcript."
    );
  }
}

export function createSttAdapter(config: VoiceConfig): SttAdapter {
  switch (config.sttProvider) {
    case "local":
      return new LocalSttAdapter(
        config.sttCommand ?? process.env.VOICE_STT_COMMAND ?? ""
      );
    case "cloud":
      return new CloudSttAdapter(config.allowRemoteAudio);
    case "mock":
    default:
      return new MockSttAdapter(config.mockTranscript ?? "hello from mock stt");
  }
}

function runCommandCapture(commandLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Shell form for user-configured templates (Windows + Unix)
    const child = spawn(commandLine, {
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Local STT command failed (code ${code}): ${stderr || stdout || commandLine}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}

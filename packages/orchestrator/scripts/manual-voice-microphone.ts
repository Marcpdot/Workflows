/**
 * Explicit manual microphone smoke. Never invoked by CI.
 * The operator owns the capture command and local audio/STT dependencies.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObserverFromEnv } from "@workflows/observability";
import {
  createSttAdapter,
  createTtsAdapter,
  loadVoiceConfig,
  runVoiceTurn,
} from "@workflows/voice";

const HELP = `
Manual real-microphone voice smoke (never run by CI)

Required:
  VOICE_MIC_CAPTURE_COMMAND   command containing {output}; records one finite clip
  VOICE_STT_COMMAND           local STT command containing {input}

Optional:
  VOICE_MIC_DEVICE_ID         diagnostic source ID
  VOICE_TTS_PROVIDER          off (default), mock, or local
  VOICE_TTS_COMMAND           required when TTS provider is local

Example (Linux/arecord + whisper.cpp):
  VOICE_MIC_CAPTURE_COMMAND='arecord -d 4 -f S16_LE -r 16000 -c 1 {output}' \\
  VOICE_STT_COMMAND='whisper-cli -f {input} -nt' \\
  npm run test:voice:microphone -- --show-transcript

The temporary recording is deleted after the run. Transcript content is printed
only with --show-transcript.
`.trim();

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    console.log(HELP);
    return;
  }

  const captureTemplate = process.env.VOICE_MIC_CAPTURE_COMMAND?.trim();
  if (!captureTemplate) {
    throw new Error(`VOICE_MIC_CAPTURE_COMMAND is required.\n\n${HELP}`);
  }
  if (!captureTemplate.includes("{output}")) {
    throw new Error("VOICE_MIC_CAPTURE_COMMAND must contain {output}");
  }
  if (!process.env.VOICE_STT_COMMAND?.trim()) {
    throw new Error(`VOICE_STT_COMMAND is required.\n\n${HELP}`);
  }

  const captureDir = await mkdtemp(join(tmpdir(), "workflows-voice-mic-"));
  const audioPath = join(captureDir, "capture.wav");
  try {
    await runCapture(
      captureTemplate.replaceAll("{output}", quoteForShell(audioPath))
    );
    const captured = await stat(audioPath);
    if (!captured.isFile() || captured.size === 0) {
      throw new Error("Microphone capture produced no audio file");
    }

    const config = loadVoiceConfig({
      ...process.env,
      VOICE_ENABLED: "true",
      VOICE_STT_PROVIDER: "local",
    });
    const result = await runVoiceTurn(
      {
        stt: createSttAdapter(config),
        tts: createTtsAdapter(config),
        language: config.language,
        observation: {
          observer: createObserverFromEnv(process.env),
          sessionId: "manual-microphone-smoke",
        },
        handle: async (text) => ({
          reply: `Microphone smoke received ${text.length} transcript characters.`,
        }),
      },
      {
        audioPath,
        source: {
          surfaceId: "manual-microphone",
          deviceId: process.env.VOICE_MIC_DEVICE_ID?.trim() || undefined,
        },
        silent: config.ttsProvider === "off",
      }
    );

    console.log(
      `[voice manual] OK provider=${result.stt.provider} transcriptChars=${result.transcript.length} spoken=${result.tts?.spoken ?? false}`
    );
    if (args.has("--show-transcript")) {
      console.log(`[voice manual] transcript: ${result.transcript}`);
    }
  } finally {
    await rm(captureDir, { recursive: true, force: true });
  }
}

function quoteForShell(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function runCapture(commandLine: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandLine, {
      shell: true,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Microphone capture command failed (code ${code})`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

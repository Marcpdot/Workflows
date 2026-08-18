/** Explicit manual live microphone runtime. Never invoked by CI. */

import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createMemory } from "@workflows/memory";
import { createObserverFromEnv } from "@workflows/observability";
import {
  CommandMicrophoneSource,
  CommandPlaybackSink,
  CommandStreamingTtsAdapter,
  EnergyVoiceActivityDetector,
  SegmentedStreamingSttAdapter,
  createFinalOnlyVoiceCognitionHooks,
  createSttAdapter,
  loadVoiceConfig,
  runLiveVoiceSession,
  type AudioFormat,
} from "@workflows/voice";
import { Orchestrator, loadConfigFromEnv } from "../src/orchestrator.js";

const HELP = `
Live full-duplex voice runtime (manual hardware command; never CI)

Required:
  VOICE_ENABLED=true
  VOICE_MIC_STREAM_COMMAND   microphone raw PCM on stdout (continuous)
  VOICE_STT_COMMAND          bounded WAV STT command using {input}

Optional:
  VOICE_ENGAGEMENT_MODE      active_conversation (default) | push_to_talk
  VOICE_SAMPLE_RATE          16000 (default)
  VOICE_CHANNELS             1 (default)
  VOICE_PCM_ENCODING         pcm_s16le (default) | pcm_f32le
  VOICE_VAD_THRESHOLD        0.025 (normalized RMS)
  VOICE_VAD_END_SILENCE_MS   650
  VOICE_MIC_DEVICE_ID        device identity used in lineage/diagnostics
  VOICE_TTS_STREAM_COMMAND   UTF-8 text stdin -> raw PCM stdout
  VOICE_SPEAKER_STREAM_COMMAND raw PCM stdin -> speaker

Linux microphone example:
  VOICE_MIC_STREAM_COMMAND='arecord -q -t raw -f S16_LE -r 16000 -c 1'

Windows ffmpeg microphone example:
  VOICE_MIC_STREAM_COMMAND='ffmpeg -hide_banner -loglevel error -f dshow -i audio="Microphone" -f s16le -ac 1 -ar 16000 pipe:1'

Push-to-talk (VOICE_ENGAGEMENT_MODE=push_to_talk):
  Starts not transmitting. Press Enter to open one utterance window, Enter
  again to release it. Only speech engaged during an open window can commit.
  After one committed input the session stops (maxCommittedInputs=1).

Active conversation (default) listens continuously until Ctrl+C.

Ctrl+C propagates AbortSignal and shuts capture/STT/TTS/playback down cleanly.
The existing test:voice:microphone command remains available for finite-file diagnostics.
`.trim();

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const voice = loadVoiceConfig(process.env);
  const microphoneCommand = process.env.VOICE_MIC_STREAM_COMMAND?.trim();
  if (!voice.enabled || !microphoneCommand || !voice.sttCommand) {
    throw new Error(`live voice is explicit opt-in and is not configured.\n\n${HELP}`);
  }

  const format = loadPcmFormat(process.env);
  const sessionId = process.env.VOICE_SESSION_ID?.trim() || "voice-live";
  const observer = createObserverFromEnv(process.env);
  const memory = createMemory({
    dbPath: resolve(
      process.cwd(),
      process.env.MEMORY_DB_PATH ?? "./data/memory.db"
    ),
  });
  const config = loadConfigFromEnv(process.env, { sessionId });
  config.experienceStore = memory;
  const orchestrator = new Orchestrator(config);
  const abort = new AbortController();
  const stop = (): void => abort.abort(new Error("operator stopped live voice"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const microphone = new CommandMicrophoneSource({
    command: microphoneCommand,
    format,
    source: {
      surfaceId: "voice-live",
      deviceId: process.env.VOICE_MIC_DEVICE_ID?.trim() || undefined,
      channel: format.channels === 1 ? "mono" : `${format.channels}-channel`,
    },
    observation: { observer, sessionId },
  });
  const recognition = new SegmentedStreamingSttAdapter(
    createSttAdapter({ ...voice, sttProvider: "local" }),
    {
      detector: new EnergyVoiceActivityDetector({
        speechThreshold: numberEnv("VOICE_VAD_THRESHOLD", 0.025),
      }),
      provider: { localOnly: true },
      cancellation: true,
      endSilenceMs: integerEnv("VOICE_VAD_END_SILENCE_MS", 650),
      observation: { observer, sessionId },
    }
  );

  const ttsCommand = process.env.VOICE_TTS_STREAM_COMMAND?.trim();
  const speakerCommand = process.env.VOICE_SPEAKER_STREAM_COMMAND?.trim();
  if (!!ttsCommand !== !!speakerCommand) {
    throw new Error(
      "VOICE_TTS_STREAM_COMMAND and VOICE_SPEAKER_STREAM_COMMAND must be set together"
    );
  }
  const synthesis = ttsCommand
    ? new CommandStreamingTtsAdapter({
        command: ttsCommand,
        provider: { localOnly: true },
        format,
        source: { surfaceId: "voice-live-output", channel: "assistant" },
      })
    : undefined;
  const speaker = speakerCommand
    ? new CommandPlaybackSink({
        command: speakerCommand,
        format,
        source: {
          surfaceId: "voice-live-output",
          deviceId: process.env.VOICE_SPEAKER_DEVICE_ID?.trim() || undefined,
          channel: "assistant",
        },
      })
    : undefined;
  const engagementMode =
    process.env.VOICE_ENGAGEMENT_MODE?.trim() === "push_to_talk"
      ? "push_to_talk"
      : "active_conversation";
  const pushToTalk = { active: false };
  const readline =
    engagementMode === "push_to_talk"
      ? createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
        })
      : undefined;
  if (readline) {
    readline.on("line", () => {
      if (abort.signal.aborted) return;
      pushToTalk.active = !pushToTalk.active;
      console.log(
        pushToTalk.active
          ? "[voice live] PTT window open — speak, then press Enter to release"
          : "[voice live] PTT window released"
      );
    });
  }

  console.log(
    `[voice live] listening mode=${engagementMode} stt=${recognition.name} partials=${recognition.capabilities.partialTranscripts} tts=${synthesis?.name ?? "off"}`
  );
  if (engagementMode === "push_to_talk") {
    console.log(
      "[voice live] PTT idle — press Enter to start talking, Enter again to release, Ctrl+C to stop"
    );
  }
  try {
    const result = await runLiveVoiceSession({
      microphone,
      recognition,
      cognition: createFinalOnlyVoiceCognitionHooks(async (text, context) => {
        const history = await memory.getHistory(sessionId);
        return orchestrator.handle(text, {
          ...context,
          history,
          sessionId,
          sourcePrompt: text,
        });
      }),
      engagement: () => ({
        mode: engagementMode,
        listening: true,
        pushToTalkActive:
          engagementMode === "push_to_talk" ? pushToTalk.active : undefined,
      }),
      synthesis,
      speaker,
      language: voice.language,
      signal: abort.signal,
      observation: { observer, sessionId },
      maxCommittedInputs: engagementMode === "push_to_talk" ? 1 : undefined,
    });
    console.log(
      `[voice live] stopped commits=${result.committedInputs} outputs=${result.outputsStarted} bargeIns=${result.bargeIns} degradations=${result.degradations.length}`
    );
  } catch (error) {
    if (!abort.signal.aborted) throw error;
  } finally {
    readline?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    orchestrator.close();
    memory.close();
  }
}

function loadPcmFormat(env: NodeJS.ProcessEnv): AudioFormat {
  const encoding =
    env.VOICE_PCM_ENCODING?.trim() === "pcm_f32le"
      ? "pcm_f32le"
      : "pcm_s16le";
  return {
    sampleRate: integerEnv("VOICE_SAMPLE_RATE", 16_000),
    channels: integerEnv("VOICE_CHANNELS", 1),
    encoding,
  };
}

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

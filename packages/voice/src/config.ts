/**
 * Load voice env flags — all default off / mock-safe.
 */

import type { SttProviderName, TtsProviderName, VoiceConfig } from "./types.js";

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function loadVoiceConfig(
  env: NodeJS.ProcessEnv = process.env
): VoiceConfig {
  const sttRaw = (env.VOICE_STT_PROVIDER ?? "mock").trim().toLowerCase();
  const ttsRaw = (env.VOICE_TTS_PROVIDER ?? "off").trim().toLowerCase();

  const sttProvider: SttProviderName =
    sttRaw === "local" || sttRaw === "cloud" || sttRaw === "mock"
      ? sttRaw
      : "mock";
  const ttsProvider: TtsProviderName =
    ttsRaw === "local" ||
    ttsRaw === "cloud" ||
    ttsRaw === "mock" ||
    ttsRaw === "off"
      ? ttsRaw
      : "off";

  return {
    enabled: envFlagTrue(env.VOICE_ENABLED),
    sttProvider,
    ttsProvider,
    language: env.VOICE_LANGUAGE?.trim() || "en",
    mockTranscript: env.VOICE_MOCK_TRANSCRIPT?.trim() || undefined,
    sttCommand: env.VOICE_STT_COMMAND?.trim() || undefined,
    ttsCommand: env.VOICE_TTS_COMMAND?.trim() || undefined,
    allowRemoteAudio: envFlagTrue(env.VOICE_ALLOW_REMOTE_AUDIO),
  };
}

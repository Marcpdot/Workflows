/**
 * Voice session: STT → handle(text) → optional TTS.
 * Same brain as text chat — no separate voice knowledge path.
 */

import type {
  SttAdapter,
  TtsAdapter,
  VoiceHandleFn,
  VoiceTurnInput,
  VoiceTurnResult,
} from "./types.js";

export interface VoiceSessionOptions {
  stt: SttAdapter;
  tts: TtsAdapter;
  handle: VoiceHandleFn;
  language?: string;
}

/**
 * One listen→answer→speak cycle.
 */
export async function runVoiceTurn(
  session: VoiceSessionOptions,
  input: VoiceTurnInput = {}
): Promise<VoiceTurnResult> {
  const language = input.language ?? session.language;
  const stt = await session.stt.transcribe({
    audioPath: input.audioPath,
    audio: input.audio,
    transcript: input.transcript,
    language,
  });
  const transcript = stt.text.trim();
  if (!transcript) {
    throw new Error("runVoiceTurn: empty transcript from STT");
  }

  const handled = await session.handle(transcript);
  const reply = handled.reply ?? "";

  let tts: VoiceTurnResult["tts"] = null;
  if (!input.silent && reply) {
    tts = await session.tts.speak({
      text: reply,
      language,
    });
  } else {
    tts = {
      spoken: false,
      provider: session.tts.name,
      remote: false,
    };
  }

  return {
    transcript,
    reply,
    stt,
    tts,
    viaVoice: true,
  };
}

/**
 * Create a reusable session object.
 */
export function createVoiceSession(
  options: VoiceSessionOptions
): {
  stt: SttAdapter;
  tts: TtsAdapter;
  handle: VoiceHandleFn;
  language?: string;
  turn: (input?: VoiceTurnInput) => Promise<VoiceTurnResult>;
} {
  return {
    ...options,
    turn: (input) => runVoiceTurn(options, input),
  };
}

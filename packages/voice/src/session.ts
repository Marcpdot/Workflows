/**
 * Voice session: STT → handle(text) → optional TTS.
 * Same brain as text chat — no separate voice knowledge path.
 */

import { randomUUID } from "node:crypto";
import { createVoiceHandleContext } from "./cognitionHooks.js";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";
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
  observation?: VoiceObservationContext;
}

/**
 * One listen→answer→speak cycle.
 */
export async function runVoiceTurn(
  session: VoiceSessionOptions,
  input: VoiceTurnInput = {}
): Promise<VoiceTurnResult> {
  const language = input.language ?? session.language;
  const started = performance.now();
  const utteranceId = input.utteranceId?.trim() || randomUUID();
  const source = input.source ?? { surfaceId: "voice-turn" };
  observeVoiceTransition(session.observation, {
    stage: "capture",
    utteranceId,
    source,
    provider: session.stt.name,
    elapsedMs: 0,
    audioBytes: input.audio?.length,
  });
  let stt: Awaited<ReturnType<SttAdapter["transcribe"]>>;
  try {
    stt = await session.stt.transcribe({
      audioPath: input.audioPath,
      audio: input.audio,
      transcript: input.transcript,
      language,
    });
  } catch (error) {
    observeVoiceDegradation(session.observation, {
      capability: "stt",
      reasonCode: "transcription_failed",
      utteranceId,
      provider: session.stt.name,
    });
    throw error;
  }
  const transcript = stt.text.trim();
  if (!transcript) {
    observeVoiceDegradation(session.observation, {
      capability: "stt",
      reasonCode: "empty_transcript",
      utteranceId,
      provider: stt.provider,
    });
    throw new Error("runVoiceTurn: empty transcript from STT");
  }

  observeVoiceTransition(session.observation, {
    stage: "final",
    utteranceId,
    source,
    provider: stt.provider,
    remote: stt.remote,
    elapsedMs: Math.round(performance.now() - started),
    stability: "final",
    textCharacters: transcript.length,
  });
  observeVoiceTransition(session.observation, {
    stage: "endpoint",
    utteranceId,
    source,
    provider: stt.provider,
    remote: stt.remote,
    elapsedMs: Math.round(performance.now() - started),
    reasonCode: "buffered_stt_complete",
  });
  observeVoiceTransition(session.observation, {
    stage: "cognition_start",
    utteranceId,
    source,
    provider: stt.provider,
    remote: stt.remote,
    elapsedMs: Math.round(performance.now() - started),
  });
  let handled: Awaited<ReturnType<VoiceHandleFn>>;
  try {
    handled = await session.handle(
      transcript,
      createVoiceHandleContext({
        utteranceId,
        audioSource: source,
        audioRef: input.audioRef,
        remote: stt.remote,
        provider: stt.provider,
      })
    );
  } catch (error) {
    observeVoiceDegradation(session.observation, {
      capability: "cognition",
      reasonCode: "committed_input_failed",
      utteranceId,
      provider: stt.provider,
    });
    throw error;
  }
  observeVoiceTransition(session.observation, {
    stage: "commitment",
    utteranceId,
    source,
    provider: stt.provider,
    remote: stt.remote,
    elapsedMs: Math.round(performance.now() - started),
    inputExperienceId: handled.experiences?.input,
    outputExperienceId: handled.experiences?.output,
  });
  const reply = handled.reply ?? "";

  let tts: VoiceTurnResult["tts"] = null;
  if (!input.silent && reply) {
    try {
      tts = await session.tts.speak({
        text: reply,
        language,
      });
      if (tts.audio?.length) {
        observeVoiceTransition(session.observation, {
          stage: "tts_first_audio",
          utteranceId,
          source,
          provider: session.tts.name,
          remote: tts.remote,
          elapsedMs: Math.round(performance.now() - started),
          audioBytes: tts.audio.length,
        });
      }
      if (tts.spoken) {
        observeVoiceTransition(session.observation, {
          stage: "playback",
          utteranceId,
          source,
          provider: session.tts.name,
          remote: tts.remote,
          elapsedMs: Math.round(performance.now() - started),
          audioBytes: tts.audio?.length,
        });
      }
    } catch (error) {
      observeVoiceDegradation(session.observation, {
        capability: "tts",
        reasonCode: "synthesis_or_playback_failed",
        utteranceId,
        provider: session.tts.name,
      });
      throw error;
    }
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
    utteranceId,
    source,
    inputExperienceId: handled.experiences?.input,
    outputExperienceId: handled.experiences?.output,
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

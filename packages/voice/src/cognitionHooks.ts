/** Optional signals into the existing cognition path; voice owns no cognition. */

import type {
  AudioSource,
  TranscriptStability,
  TranscriptUpdate,
  VoiceExperienceLineage,
  VoiceHandleContext,
  VoiceHandleFn,
  VoiceHandleResult,
} from "./types.js";
import {
  observeVoiceDegradation,
  observeVoiceTransition,
  type VoiceObservationContext,
} from "./observability.js";

export interface SpeculativeVoiceInputMetadata {
  utteranceId: string;
  stability: TranscriptStability;
  signal: AbortSignal;
}

export interface CommittedVoiceInputMetadata {
  utteranceId: string;
  source: AudioSource;
  transcript: TranscriptUpdate;
  signal?: AbortSignal;
}

export interface VoiceCognitionHooks {
  /** Optional, cheap preparation. It must stay cancellable and reversible. */
  onSpeculativeInput?(
    text: string,
    meta: SpeculativeVoiceInputMetadata
  ): void;
  /** Existing authorized cognition path supplied by the caller. */
  onCommittedInput(
    text: string,
    meta: CommittedVoiceInputMetadata
  ): Promise<VoiceHandleResult>;
}

/**
 * Notify an optional speculative hook. The caller owns cancellation and decides
 * whether the signal is useful; this function cannot commit or persist input.
 */
export function signalSpeculativeInput(
  hooks: VoiceCognitionHooks,
  transcript: TranscriptUpdate,
  signal: AbortSignal,
  observation?: VoiceObservationContext
): boolean {
  if (!hooks.onSpeculativeInput || signal.aborted) return false;
  if (!transcript.text.trim()) {
    throw new Error("signalSpeculativeInput: transcript text cannot be empty");
  }
  observeVoiceTransition(observation, {
    stage: "speculative_start",
    utteranceId: transcript.utteranceId,
    source: transcript.source,
    provider: transcript.provider,
    remote: transcript.remote,
    eventTimestampMs: transcript.timestampMs,
    stability: transcript.stability,
    textCharacters: transcript.text.length,
  });
  signal.addEventListener(
    "abort",
    () => {
      observeVoiceTransition(observation, {
        stage: "speculative_discarded",
        utteranceId: transcript.utteranceId,
        source: transcript.source,
        provider: transcript.provider,
        remote: transcript.remote,
        reasonCode: "signal_aborted",
      });
    },
    { once: true }
  );
  try {
    hooks.onSpeculativeInput(transcript.text, {
      utteranceId: transcript.utteranceId,
      stability: transcript.stability,
      signal,
    });
  } catch (error) {
    observeVoiceDegradation(observation, {
      capability: "speculative_cognition",
      reasonCode: "speculative_start_failed",
      utteranceId: transcript.utteranceId,
      provider: transcript.provider,
    });
    throw error;
  }
  return true;
}

/**
 * Enter the caller-owned durable cognition path after external endpoint,
 * engagement, authority, and safety decisions have approved the input.
 */
export async function commitVoiceInput(
  hooks: VoiceCognitionHooks,
  transcript: TranscriptUpdate,
  signal?: AbortSignal,
  observation?: VoiceObservationContext
): Promise<VoiceHandleResult> {
  throwIfAborted(signal);
  if (transcript.stability === "partial") {
    throw new Error("commitVoiceInput: partial transcripts cannot be committed");
  }
  if (!transcript.text.trim()) {
    throw new Error("commitVoiceInput: transcript text cannot be empty");
  }
  observeVoiceTransition(observation, {
    stage: "cognition_start",
    utteranceId: transcript.utteranceId,
    source: transcript.source,
    provider: transcript.provider,
    remote: transcript.remote,
    eventTimestampMs: transcript.timestampMs,
    stability: transcript.stability,
    textCharacters: transcript.text.length,
  });
  try {
    const result = await hooks.onCommittedInput(transcript.text, {
      utteranceId: transcript.utteranceId,
      source: transcript.source,
      transcript,
      signal,
    });
    observeVoiceTransition(observation, {
      stage: "commitment",
      utteranceId: transcript.utteranceId,
      source: transcript.source,
      provider: transcript.provider,
      remote: transcript.remote,
      inputExperienceId: result.experiences?.input,
      outputExperienceId: result.experiences?.output,
    });
    return result;
  } catch (error) {
    observeVoiceDegradation(observation, {
      capability: "cognition",
      reasonCode: signal?.aborted
        ? "committed_input_aborted"
        : "committed_input_failed",
      utteranceId: transcript.utteranceId,
      provider: transcript.provider,
    });
    throw error;
  }
}

/** Existing turn behavior: no speculation, one explicit stable/final handle call. */
export function createFinalOnlyVoiceCognitionHooks(
  handle: VoiceHandleFn
): VoiceCognitionHooks {
  return {
    onCommittedInput: (text, meta) =>
      handle(
        text,
        createVoiceHandleContext({
          utteranceId: meta.utteranceId,
          audioSource: meta.source,
          audioRef: meta.transcript.audioRef,
          remote: meta.transcript.remote,
          provider: meta.transcript.provider,
        })
      ),
  };
}

/** Map retained speech lineage into the existing durable handle contract. */
export function createVoiceHandleContext(
  lineage: VoiceExperienceLineage
): VoiceHandleContext {
  const { audioRef, ...voice } = lineage;
  return {
    experienceSource: {
      type: "voice",
      ref: lineage.utteranceId,
    },
    ...(audioRef ? { experiencePayloadRef: audioRef } : {}),
    experienceMetadata: {
      voice: {
        ...voice,
        audioSource: { ...lineage.audioSource },
      },
    },
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("voice operation aborted");
}

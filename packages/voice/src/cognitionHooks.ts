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
  signal: AbortSignal
): boolean {
  if (!hooks.onSpeculativeInput || signal.aborted) return false;
  if (!transcript.text.trim()) {
    throw new Error("signalSpeculativeInput: transcript text cannot be empty");
  }
  hooks.onSpeculativeInput(transcript.text, {
    utteranceId: transcript.utteranceId,
    stability: transcript.stability,
    signal,
  });
  return true;
}

/**
 * Enter the caller-owned durable cognition path after external endpoint,
 * engagement, authority, and safety decisions have approved the input.
 */
export async function commitVoiceInput(
  hooks: VoiceCognitionHooks,
  transcript: TranscriptUpdate,
  signal?: AbortSignal
): Promise<VoiceHandleResult> {
  throwIfAborted(signal);
  if (transcript.stability === "partial") {
    throw new Error("commitVoiceInput: partial transcripts cannot be committed");
  }
  if (!transcript.text.trim()) {
    throw new Error("commitVoiceInput: transcript text cannot be empty");
  }
  return hooks.onCommittedInput(transcript.text, {
    utteranceId: transcript.utteranceId,
    source: transcript.source,
    transcript,
    signal,
  });
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

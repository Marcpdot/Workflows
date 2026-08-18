/** Privacy-safe voice transition reporting through the shared observer. */

import {
  emitSafely,
  type Observer,
  type VoiceObservation,
} from "@workflows/observability";

export interface VoiceObservationContext {
  observer?: Observer;
  sessionId?: string;
  operationId?: string;
}

export type VoiceObservationInput = Omit<
  VoiceObservation,
  "schemaVersion" | "privacy"
>;

/**
 * Emits reference/count metadata only. Observability is optional and never
 * participates in voice correctness or durable experience storage.
 */
export function observeVoiceTransition(
  context: VoiceObservationContext | undefined,
  observation: VoiceObservationInput
): boolean {
  if (!context?.observer) return false;
  return emitSafely(context.observer, {
    ts: new Date().toISOString(),
    kind: "voice",
    sessionId: context.sessionId,
    operationId:
      context.operationId ?? observation.utteranceId ?? observation.outputId,
    latencyMs: observation.elapsedMs,
    voice: {
      schemaVersion: 1,
      ...observation,
      privacy: {
        fullAudioIncluded: false,
        fullTranscriptIncluded: false,
      },
    },
  });
}

/** Explicit bounded degradation signal; error/private content is not accepted. */
export function observeVoiceDegradation(
  context: VoiceObservationContext | undefined,
  input: {
    capability: string;
    reasonCode: string;
    utteranceId?: string;
    outputId?: string;
    provider?: string;
  }
): boolean {
  return observeVoiceTransition(context, {
    stage: "degradation",
    utteranceId: input.utteranceId,
    outputId: input.outputId,
    provider: input.provider,
    degradedCapability: input.capability,
    reasonCode: input.reasonCode,
  });
}

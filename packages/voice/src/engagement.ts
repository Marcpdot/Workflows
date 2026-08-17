/** Pure engagement and endpoint decisions; neither decision commits cognition. */

import type { EngagementMode, EngagementState } from "./types.js";

/** Output from any caller-owned address/wake/addressee detector. */
export interface AddressSignal {
  detectorId: string;
  addressed: boolean;
  confidence?: number;
  timestampMs: number;
}

export interface EngagementInput {
  mode: EngagementMode;
  listening: boolean;
  pushToTalkActive?: boolean;
  addressSignals?: readonly AddressSignal[];
}

export type EngagementReason =
  | "not_listening"
  | "push_to_talk_active"
  | "push_to_talk_inactive"
  | "active_conversation"
  | "explicitly_addressed"
  | "not_addressed"
  | "passive";

export interface EngagementDecision {
  /** Whether this surface should participate in processing the detected speech. */
  participates: boolean;
  reason: EngagementReason;
  state: EngagementState;
  addressSignal?: AddressSignal;
}

export function resolveEngagement(input: EngagementInput): EngagementDecision {
  const addressSignal = latestAddressSignal(input.addressSignals ?? []);
  const state: EngagementState = {
    mode: input.mode,
    addressed: addressSignal?.addressed ?? false,
    listening: input.listening,
  };
  if (!input.listening) {
    return { participates: false, reason: "not_listening", state, addressSignal };
  }

  switch (input.mode) {
    case "push_to_talk":
      return {
        participates: input.pushToTalkActive === true,
        reason:
          input.pushToTalkActive === true
            ? "push_to_talk_active"
            : "push_to_talk_inactive",
        state,
        addressSignal,
      };
    case "active_conversation":
      return {
        participates: true,
        reason: "active_conversation",
        state,
        addressSignal,
      };
    case "addressed":
      return {
        participates: state.addressed,
        reason: state.addressed ? "explicitly_addressed" : "not_addressed",
        state,
        addressSignal,
      };
    case "passive":
      return { participates: false, reason: "passive", state, addressSignal };
  }
}

export interface EndpointEvidence {
  nowMs: number;
  utteranceStartedAtMs: number;
  providerEndpoint?: boolean;
  pushToTalkReleased?: boolean;
  speechEnded?: boolean;
  finalTranscript?: boolean;
  silenceMs?: number;
}

export interface EndpointPolicy {
  minSilenceMs: number;
  maxUtteranceMs: number;
}

export type EndpointReason =
  | "provider_endpoint"
  | "push_to_talk_released"
  | "speech_ended_with_final"
  | "speech_ended_with_silence"
  | "max_utterance_reached";

export interface EndpointDecision {
  isEndpoint: boolean;
  reasons: EndpointReason[];
  observedAtMs: number;
  utteranceDurationMs: number;
}

export const DEFAULT_ENDPOINT_POLICY: Readonly<EndpointPolicy> = {
  minSilenceMs: 650,
  maxUtteranceMs: 30_000,
};

/**
 * Combine independent endpoint evidence. Silence or a final transcript alone is
 * insufficient, and the result intentionally carries no commitment decision.
 */
export function decideEndpoint(
  engagement: EngagementState,
  evidence: EndpointEvidence,
  policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY
): EndpointDecision {
  const reasons: EndpointReason[] = [];
  const utteranceDurationMs = Math.max(
    0,
    evidence.nowMs - evidence.utteranceStartedAtMs
  );

  if (evidence.providerEndpoint) reasons.push("provider_endpoint");
  if (
    engagement.mode === "push_to_talk" &&
    evidence.pushToTalkReleased
  ) {
    reasons.push("push_to_talk_released");
  }
  if (utteranceDurationMs >= policy.maxUtteranceMs) {
    reasons.push("max_utterance_reached");
  }
  if (engagement.mode !== "push_to_talk" && evidence.speechEnded) {
    if (evidence.finalTranscript) reasons.push("speech_ended_with_final");
    if ((evidence.silenceMs ?? 0) >= policy.minSilenceMs) {
      reasons.push("speech_ended_with_silence");
    }
  }

  return {
    isEndpoint: reasons.length > 0,
    reasons,
    observedAtMs: evidence.nowMs,
    utteranceDurationMs,
  };
}

function latestAddressSignal(
  signals: readonly AddressSignal[]
): AddressSignal | undefined {
  let latest: AddressSignal | undefined;
  for (const signal of signals) {
    if (!latest || signal.timestampMs >= latest.timestampMs) latest = signal;
  }
  return latest;
}

export type OrchestratorEventKind =
  | "request"
  | "tool"
  | "error"
  | "cognition"
  | "knowledge"
  | "background"
  | "voice";

export type VoiceObservationStage =
  | "capture"
  | "microphone_capture_start"
  | "speech_started"
  | "speech_continuing"
  | "first_partial"
  | "final"
  | "endpoint"
  | "speculative_start"
  | "cognition_start"
  | "commitment"
  | "tts_first_audio"
  | "playback"
  | "barge_in"
  | "cancel"
  | "speculative_discarded"
  | "degradation";

/** Privacy-safe diagnostic projection of one voice-runtime transition. */
export interface VoiceObservation {
  schemaVersion: 1;
  stage: VoiceObservationStage;
  utteranceId?: string;
  outputId?: string;
  source?: {
    surfaceId: string;
    deviceId?: string;
    channel?: string;
  };
  provider?: string;
  remote?: boolean;
  eventTimestampMs?: number;
  elapsedMs?: number;
  reasonCode?: string;
  stability?: "partial" | "stable" | "final";
  confidence?: number;
  completeness?: number;
  textCharacters?: number;
  audioBytes?: number;
  silenceMs?: number;
  inputExperienceId?: string;
  outputExperienceId?: string;
  degradedCapability?: string;
  privacy: {
    fullAudioIncluded: false;
    fullTranscriptIncluded: false;
  };
}

export interface CcExperienceReferences {
  inputExperienceId?: string;
  inputKind?: string;
  outputExperienceIds: string[];
  modelOutputExperienceIds: string[];
  deterministicOutputExperienceIds: string[];
  toolCallExperienceIds: string[];
  toolResultExperienceIds: string[];
  clarificationExperienceIds: string[];
  correctionExperienceIds: string[];
  backgroundSourceExperienceIds: string[];
}

export interface CcCapabilityDecisionSummary {
  capabilityId: string;
  kind: string;
  phase: "initial" | "expanded";
  reason: string;
  budget?: { unit: string; maximum: number };
}

export interface CcActivationObservation {
  selected: CcCapabilityDecisionSummary[];
  skipped: CcCapabilityDecisionSummary[];
  degraded: CcCapabilityDecisionSummary[];
  expansions: Array<{
    trigger: string;
    depth: number;
    requested: string[];
    activated: string[];
    rejected: Array<{ capabilityId: string; reason: string }>;
    reason: string;
  }>;
  limits: Record<string, number>;
  representations: Array<{
    capabilityId: string;
    kind: string;
    ids?: string[];
    count?: number;
    characters?: number;
    detail?: string;
  }>;
  outcomes: Array<{
    capabilityId: string;
    status: "produced" | "empty" | "failed";
    representationKinds: string[];
  }>;
}

export interface CcSemanticWriteReference {
  proposalId: string;
  kind: string;
  eventId?: string;
  epistemicStatus?: string;
  canonicalIds?: string[];
  oldClaimId?: string;
  revisedClaimId?: string;
}

export interface CcKnowledgeObservation {
  canonicalIds: string[];
  sourceEventIds: string[];
  sourceExperienceIds: string[];
  proposalWrites: CcSemanticWriteReference[];
  epistemicStatuses: string[];
  transformationMethods: string[];
  gapId?: string;
  resolutionMethod?: string;
  supersededClaimIds: string[];
  disputedClaimIds: string[];
  contradictionIds: string[];
}

export interface CcOutcomeObservation {
  correctionOccurred: boolean;
  clarificationResolved: boolean;
  priorClarificationReused: boolean;
  responseDegraded: boolean;
  toolSuccesses: number;
  toolFailures: number;
  canonicalUnderstandingRevised: boolean;
  backgroundDeferred: boolean;
  proposalIds: string[];
}

/** Privacy-safe diagnostic projection of one completed cognitive operation. */
export interface CcOperationObservation {
  schemaVersion: 1;
  operationId: string;
  experiences: CcExperienceReferences;
  activation: CcActivationObservation;
  model?: { tier: string; provider: string; model: string };
  tools: string[];
  knowledge: CcKnowledgeObservation;
  outcome: CcOutcomeObservation;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs?: number;
    toolSteps?: number;
  };
  privacy: {
    fullContentIncluded: false;
    promptPreviewIncluded: boolean;
  };
}

export interface CcKnowledgeWriteObservation {
  action: string;
  eventId?: string;
  proposalIds: string[];
  proposalKind?: string;
  canonicalIds: string[];
  sourceExperienceIds: string[];
  epistemicStatus?: string;
  transformationMethod?: string;
  gapId?: string;
  resolutionMethod?: string;
  oldClaimId?: string;
  revisedClaimId?: string;
  contradictionId?: string;
}

export interface CcBackgroundPassObservation {
  passId: string;
  limits?: Record<string, number>;
  workIds: string[];
  work: Array<{
    id: string;
    kind: string;
    status: string;
    sourceExperienceId?: string;
    sourceEventId?: string;
    targetId?: string;
  }>;
  sourceExperienceIds: string[];
  itemsInspected: number;
  itemsCompleted: number;
  itemsUnchanged: number;
  retriesScheduled: number;
  proposalsCreated: number;
  gapsResolved: number;
  contradictionsSurfaced: number;
  projectionsReconciled: { graph: number; vector: number };
  escalationsCreated: number;
  modelCallsUsed: number;
  failures: Array<{ workId?: string; kind: string; reason: string }>;
  degradations: Array<{ capability: string; reason: string }>;
}

export interface OrchestratorEvent {
  ts: string;
  kind: OrchestratorEventKind;
  sessionId?: string;
  route?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokens?: number;
  tools?: string[];
  error?: string;
  operationId?: string;
  cognition?: CcOperationObservation;
  knowledge?: CcKnowledgeWriteObservation;
  background?: CcBackgroundPassObservation;
  voice?: VoiceObservation;
  /** Policy reason, compression flags, etc. Avoid full prompts unless configured */
  meta?: Record<string, unknown>;
}

export interface Observer {
  emit(event: OrchestratorEvent): void;
}

export interface ObservabilityConfig {
  enabled: boolean;
  logPath: string;
  logPrompts: boolean;
  /** Mirror events to stderr as single-line JSON */
  stderr: boolean;
}

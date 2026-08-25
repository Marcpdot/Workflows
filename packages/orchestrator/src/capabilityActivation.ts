import { randomUUID } from "node:crypto";

export type CapabilityId =
  | "deterministic_processing"
  | "session_history"
  | "history_compression"
  | "context_retrieval"
  | "representation_acquisition"
  | "knowledge_retrieval"
  | "provenance_lineage"
  | "long_term_memory"
  | "knowledge_navigator"
  | "knowledge_curator"
  | "knowledge_capture"
  | "tools"
  | "local_model"
  | "mid_model"
  | "frontier_model";

export type CapabilityKind =
  | "deterministic"
  | "information"
  | "transformation"
  | "retrieval"
  | "tool"
  | "model";

export type CapabilityAvailability = "available" | "degraded" | "unavailable";

export interface CapabilityBudgetHint {
  unit: "characters" | "messages" | "steps" | "calls" | "tokens";
  maximum: number;
}

export interface CapabilityDescriptor {
  id: CapabilityId;
  kind: CapabilityKind;
  requirements?: CapabilityId[];
  cost?: CapabilityBudgetHint;
  availability: CapabilityAvailability;
  availabilityReason?: string;
  produces?: string[];
}

export interface CapabilityApplicability {
  applicable: boolean;
  reason: string;
}

export interface CognitiveCapability {
  descriptor: CapabilityDescriptor;
  assess(context: CognitiveOperationContext): CapabilityApplicability;
}

export interface ActivationSignals {
  storedUnderstanding: boolean;
  provenance: boolean;
  longTermMemory: boolean;
  tools: boolean;
  correction: boolean;
}

export interface CognitiveResourceLimits {
  maxActiveCapabilities: number;
  maxExpansions: number;
  maxExpansionDepth: number;
  retrievalChars: number;
  knowledgeChars: number;
  historyMessages: number;
  toolSteps: number;
}

export interface CapabilityDecision {
  capabilityId: CapabilityId;
  kind: CapabilityKind;
  state: "selected" | "skipped" | "degraded";
  phase: "initial" | "expanded";
  reason: string;
  requirements: CapabilityId[];
  budget?: CapabilityBudgetHint;
}

export interface ActivatedRepresentation {
  capabilityId: CapabilityId;
  kind: string;
  ids?: string[];
  count?: number;
  characters?: number;
  detail?: string;
}

export interface CapabilityOutput {
  capabilityId: CapabilityId;
  status: "produced" | "empty" | "failed";
  representations: ActivatedRepresentation[];
  detail?: string;
  value?: unknown;
}

export interface CapabilityOutcomeTrace {
  capabilityId: CapabilityId;
  status: CapabilityOutput["status"];
  representationKinds: string[];
}

export type ActivationExpansionTrigger =
  | "missing_information"
  | "contradiction"
  | "tool_dependency"
  | "provenance_required"
  | "capability_unavailable";

export interface ActivationExpansion {
  trigger: ActivationExpansionTrigger;
  reason: string;
  fromCapabilityId?: CapabilityId;
  depth: number;
  requested: CapabilityId[];
  activated: CapabilityId[];
  rejected: Array<{ capabilityId: CapabilityId; reason: string }>;
}

export interface CapabilityDegradation {
  capabilityId: CapabilityId;
  reason: string;
  fallback?: string;
}

export interface ActivationTrace {
  operationId: string;
  inputExperienceId?: string;
  limits: CognitiveResourceLimits;
  decisions: CapabilityDecision[];
  representations: ActivatedRepresentation[];
  outcomes: CapabilityOutcomeTrace[];
  expansions: ActivationExpansion[];
  degradations: CapabilityDegradation[];
}

export interface CognitiveOperationContext {
  operationId: string;
  currentInput: string;
  inputExperienceId?: string;
  sessionId?: string;
  workspaceId?: string;
  signals: ActivationSignals;
  limits: CognitiveResourceLimits;
  availableCapabilities: readonly CognitiveCapability[];
  activeCapabilityIds: readonly CapabilityId[];
  outputs: readonly CapabilityOutput[];
  trace: ActivationTrace;
}

export interface RuntimeCapabilityState {
  historyCount: number;
  compressionThreshold: number;
  compressionAvailable: boolean;
  retrievalAvailable: boolean;
  knowledgeAvailable: boolean;
  longTermMemoryAvailable: boolean;
  toolsAvailable: boolean;
  representationAcquisitionAvailable?: boolean;
  representationAcquisitionRequested?: boolean;
  representationToolRequested?: boolean;
  selectedModel: "local" | "mid" | "frontier";
  localModelAvailable?: boolean;
  midModelAvailable?: boolean;
  frontierModelAvailable?: boolean;
  responseModelRequired?: boolean;
  knowledgeCaptureAvailable?: boolean;
  knowledgeCaptureRequested?: boolean;
  knowledgeCaptureUsesModel?: boolean;
  historyCompressionUsesModel?: boolean;
}

export const DEFAULT_COGNITIVE_LIMITS: CognitiveResourceLimits = {
  maxActiveCapabilities: 10,
  maxExpansions: 2,
  maxExpansionDepth: 2,
  retrievalChars: 2_000,
  knowledgeChars: 2_000,
  historyMessages: 50,
  toolSteps: 5,
};

const STORED_UNDERSTANDING_RE =
  /\b(remember|recall|earlier|previous|prior|stored|knowledge|what do (?:we|you) know|project status|decision|context|husker|tidligere|forrige|lagret|kunnskap|hva vet|prosjektstatus|beslutning|kontekst)\b/i;
const PROVENANCE_RE =
  /\b(source|sources|provenance|lineage|evidence|citation|confidence|trace|why do (?:we|you) know|kilde|kilder|opphav|proveniens|linje|bevis|evidens|sikkerhet|sporbar|hvorfor vet)\b/i;
const LONG_TERM_RE =
  /\b(remember about me|my preference|my name|what do you know about me|long[- ]term memory|husk om meg|min preferanse|navnet mitt|hva vet du om meg|langtidsminne)\b/i;
const TOOL_RE =
  /\b(read|inspect|list|search|find|locate|open|run|execute|command|shell|file|directory|workspace|repository|repo|package|packages|path|defined|define|definition|implement(?:ed|ation)?|where\s+is|where\s+does|which package|les|inspiser|søk|finn|åpne|kjør|kommando|fil|mappe|arbeidsområde|definer(?:t|es)?)\b/i;
const REPO_PATH_RE =
  /\b(?:packages|apps|docs|src|scripts)\/[\w./-]+/i;

const CORRECTION_RE =
  /\b(actually|correction|correct(?:ion|ing)?|instead|not .{1,80} but|faktisk|rettelse|korriger(?:ing|er|te)?|ikke .{1,80} men)\b/i;

export function detectActivationSignals(input: string): ActivationSignals {
  return {
    storedUnderstanding: STORED_UNDERSTANDING_RE.test(input),
    provenance: PROVENANCE_RE.test(input),
    longTermMemory: LONG_TERM_RE.test(input),
    tools: TOOL_RE.test(input) || REPO_PATH_RE.test(input),
    correction: CORRECTION_RE.test(input),
  };
}

function availability(
  available: boolean,
  unavailableReason: string
): Pick<CapabilityDescriptor, "availability" | "availabilityReason"> {
  return available
    ? { availability: "available" }
    : { availability: "unavailable", availabilityReason: unavailableReason };
}

function candidate(
  descriptor: CapabilityDescriptor,
  assess: CognitiveCapability["assess"]
): CognitiveCapability {
  return { descriptor, assess };
}

export function createRuntimeCapabilities(
  state: RuntimeCapabilityState
): CognitiveCapability[] {
  const selectedModelId: CapabilityId = `${state.selectedModel}_model`;
  return [
    candidate(
      {
        id: "deterministic_processing",
        kind: "deterministic",
        availability: "available",
        cost: { unit: "calls", maximum: 1 },
        produces: ["routing signals", "activation decisions"],
      },
      () => ({ applicable: true, reason: "bounded deterministic routing and activation signals" })
    ),
    ...(["local_model", "mid_model", "frontier_model"] as CapabilityId[]).map(
      (id) => {
        const tier = id.replace("_model", "") as "local" | "mid" | "frontier";
        const neededForResponse =
          state.responseModelRequired !== false && id === selectedModelId;
        const neededForCapture =
          id === "local_model" && state.knowledgeCaptureUsesModel === true;
        const neededForTransformation =
          id === "local_model" && state.historyCompressionUsesModel === true;
        const isAvailable =
          tier === "local"
            ? state.localModelAvailable !== false
            : tier === "mid"
              ? state.midModelAvailable === true
              : state.frontierModelAvailable !== false;
        return candidate(
          {
            id,
            kind: "model",
            ...availability(isAvailable, `${tier} model is not configured`),
            cost: { unit: "calls", maximum: 1 },
            produces: ["language response"],
          },
          () => ({
            applicable:
              neededForResponse || neededForCapture || neededForTransformation,
            reason:
              neededForResponse && (neededForCapture || neededForTransformation)
                ? `compute policy selected ${tier}; an active local transformation also requires it`
                : neededForResponse
                  ? `compute policy selected ${tier}`
                  : neededForCapture || neededForTransformation
                    ? "an active bounded transformation uses the configured local model"
                    : state.responseModelRequired === false && id === selectedModelId
                      ? "an active deterministic capability already provides the complete response"
                      : `compute policy selected ${state.selectedModel}`,
          })
        );
      }
    ),
    candidate(
      {
        id: "session_history",
        kind: "information",
        availability: "available",
        cost: { unit: "messages", maximum: Math.max(0, state.historyCount) },
        produces: ["recent session messages"],
      },
      () => ({
        applicable: state.historyCount > 0,
        reason:
          state.historyCount > 0
            ? `${state.historyCount} prior session messages are available`
            : "no prior session messages",
      })
    ),
    candidate(
      {
        id: "history_compression",
        kind: "transformation",
        requirements: ["session_history"],
        ...availability(state.compressionAvailable, "history compression is disabled"),
        cost: { unit: "calls", maximum: 1 },
        produces: ["bounded history summary"],
      },
      () => ({
        applicable: state.historyCount > state.compressionThreshold,
        reason:
          state.historyCount > state.compressionThreshold
            ? `history exceeds compression threshold ${state.compressionThreshold}`
            : `history is within compression threshold ${state.compressionThreshold}`,
      })
    ),
    candidate(
      {
        id: "representation_acquisition",
        kind: "retrieval",
        requirements: ["deterministic_processing"],
        ...availability(
          state.representationAcquisitionAvailable === true,
          "canonical representation acquisition is unavailable"
        ),
        cost: { unit: "steps", maximum: 5 },
        produces: ["resolved canonical referent", "bounded representation gap"],
      },
      () => ({
        applicable: state.representationAcquisitionRequested === true,
        reason: state.representationAcquisitionRequested
          ? "input or source metadata exposes a possible representational gap"
          : "input has no unresolved representation signal",
      })
    ),
    candidate(
      {
        id: "context_retrieval",
        kind: "retrieval",
        ...availability(state.retrievalAvailable, "context retrieval is disabled"),
        produces: ["session or workspace context"],
      },
      (context) => ({
        applicable: context.signals.storedUnderstanding,
        reason: context.signals.storedUnderstanding
          ? "input depends on prior stored understanding"
          : "input has no stored-understanding signal",
      })
    ),
    candidate(
      {
        id: "knowledge_retrieval",
        kind: "retrieval",
        ...availability(state.knowledgeAvailable, "canonical knowledge is unavailable"),
        produces: ["accepted canonical knowledge context"],
      },
      (context) => ({
        applicable:
          context.signals.storedUnderstanding ||
          context.signals.provenance ||
          context.signals.correction,
        reason:
          context.signals.correction
            ? "explicit correction requires comparison with persistent understanding"
            : context.signals.storedUnderstanding || context.signals.provenance
              ? "input requests stored knowledge or its provenance"
              : "input has no canonical-knowledge signal",
      })
    ),
    candidate(
      {
        id: "provenance_lineage",
        kind: "retrieval",
        requirements: ["knowledge_retrieval"],
        ...availability(state.knowledgeAvailable, "knowledge lineage is unavailable"),
        produces: ["claim lineage", "source experience references"],
      },
      (context) => ({
        applicable: context.signals.provenance,
        reason: context.signals.provenance
          ? "input explicitly requests provenance or source confidence"
          : "provenance was not required initially",
      })
    ),
    candidate(
      {
        id: "long_term_memory",
        kind: "retrieval",
        ...availability(state.longTermMemoryAvailable, "long-term memory is unavailable"),
        produces: ["long-term memory facts"],
      },
      (context) => ({
        applicable: context.signals.longTermMemory,
        reason: context.signals.longTermMemory
          ? "input asks for retained personal or long-term memory"
          : "input has no long-term-memory signal",
      })
    ),
    candidate(
      {
        id: "knowledge_navigator",
        kind: "retrieval",
        availability: "unavailable",
        availabilityReason: "no bounded Knowledge Agent run was configured for this operation",
        produces: ["bounded knowledge navigation"],
      },
      () => ({ applicable: false, reason: "direct knowledge retrieval is sufficient initially" })
    ),
    candidate(
      {
        id: "knowledge_curator",
        kind: "transformation",
        availability: "unavailable",
        availabilityReason: "foreground curation is not configured for this operation",
        produces: ["pending knowledge proposals"],
      },
      () => ({ applicable: false, reason: "foreground response does not require curation" })
    ),
    candidate(
      {
        id: "tools",
        kind: "tool",
        ...availability(state.toolsAvailable, "tool loop is disabled or no tools are registered"),
        produces: ["tool results"],
      },
      (context) => ({
        applicable: context.signals.tools || state.representationToolRequested === true,
        reason: context.signals.tools
          ? "input requires workspace, file, command, or other tool-capable inspection"
          : state.representationToolRequested === true
            ? "bounded representation acquisition requests one metadata inspection tool"
          : "input has no tool-use signal",
      })
    ),
    candidate(
      {
        id: "knowledge_capture",
        kind: "transformation",
        ...availability(
          state.knowledgeCaptureAvailable === true,
          "semantic knowledge capture is unavailable"
        ),
        cost: { unit: "calls", maximum: 1 },
        produces: ["pending proposals or ingest jobs with experience lineage"],
      },
      () => ({
        applicable: state.knowledgeCaptureRequested === true,
        reason: state.knowledgeCaptureRequested
          ? "this substantive interaction is eligible for bounded semantic capture"
          : "semantic capture is disabled, inactive, or unnecessary for this input",
      })
    ),
  ];
}

export function createCognitiveOperationContext(input: {
  currentInput: string;
  inputExperienceId?: string;
  sessionId?: string;
  workspaceId?: string;
  capabilities: CognitiveCapability[];
  limits?: Partial<CognitiveResourceLimits>;
  operationId?: string;
}): CognitiveOperationContext {
  const limits = { ...DEFAULT_COGNITIVE_LIMITS, ...input.limits };
  const operationId = input.operationId ?? randomUUID();
  return {
    operationId,
    currentInput: input.currentInput,
    inputExperienceId: input.inputExperienceId,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    signals: detectActivationSignals(input.currentInput),
    limits,
    availableCapabilities: [...input.capabilities],
    activeCapabilityIds: [],
    outputs: [],
    trace: {
      operationId,
      inputExperienceId: input.inputExperienceId,
      limits,
      decisions: [],
      representations: [],
      outcomes: [],
      expansions: [],
      degradations: [],
    },
  };
}

export function createRuntimeCognitiveContext(input: {
  currentInput: string;
  inputExperienceId?: string;
  sessionId?: string;
  workspaceId?: string;
  state: RuntimeCapabilityState;
  limits?: Partial<CognitiveResourceLimits>;
}): CognitiveOperationContext {
  return activateInitialCapabilities(
    createCognitiveOperationContext({
      currentInput: input.currentInput,
      inputExperienceId: input.inputExperienceId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      capabilities: createRuntimeCapabilities(input.state),
      limits: input.limits,
    })
  );
}

function decideCandidate(
  context: CognitiveOperationContext,
  capability: CognitiveCapability,
  phase: CapabilityDecision["phase"],
  forcedReason?: string
): { decision: CapabilityDecision; selected: boolean } {
  const descriptor = capability.descriptor;
  const assessment = forcedReason
    ? { applicable: true, reason: forcedReason }
    : capability.assess(context);
  const requirements = descriptor.requirements ?? [];
  const missing = requirements.filter(
    (requirement) => !context.activeCapabilityIds.includes(requirement)
  );
  let state: CapabilityDecision["state"] = "skipped";
  let reason = assessment.reason;

  if (assessment.applicable && descriptor.availability !== "available") {
    state = "degraded";
    reason = descriptor.availabilityReason ?? `${descriptor.availability} capability`;
  } else if (assessment.applicable && missing.length > 0) {
    state = "skipped";
    reason = `missing active prerequisite: ${missing.join(", ")}`;
  } else if (
    assessment.applicable &&
    context.activeCapabilityIds.length >= context.limits.maxActiveCapabilities
  ) {
    state = "skipped";
    reason = `active capability limit ${context.limits.maxActiveCapabilities} reached`;
  } else if (assessment.applicable) {
    state = "selected";
  }

  return {
    decision: {
      capabilityId: descriptor.id,
      kind: descriptor.kind,
      state,
      phase,
      reason,
      requirements,
      budget: descriptor.cost,
    },
    selected: state === "selected",
  };
}

export function activateInitialCapabilities(
  context: CognitiveOperationContext
): CognitiveOperationContext {
  let next = context;
  for (const capability of context.availableCapabilities) {
    const outcome = decideCandidate(next, capability, "initial");
    next = {
      ...next,
      activeCapabilityIds: outcome.selected
        ? [...next.activeCapabilityIds, capability.descriptor.id]
        : next.activeCapabilityIds,
      trace: {
        ...next.trace,
        decisions: [...next.trace.decisions, outcome.decision],
        degradations:
          outcome.decision.state === "degraded"
            ? [
                ...next.trace.degradations,
                {
                  capabilityId: capability.descriptor.id,
                  reason: outcome.decision.reason,
                  fallback: "continue with the already selected bounded capabilities",
                },
              ]
            : next.trace.degradations,
      },
    };
  }
  return next;
}

export function isCapabilityActive(
  context: CognitiveOperationContext,
  capabilityId: CapabilityId
): boolean {
  return context.activeCapabilityIds.includes(capabilityId);
}

export function contributeCapabilityOutput(
  context: CognitiveOperationContext,
  output: CapabilityOutput
): CognitiveOperationContext {
  return {
    ...context,
    outputs: [...context.outputs, output],
    trace: {
      ...context.trace,
      representations: [
        ...context.trace.representations,
        ...output.representations,
      ],
      outcomes: [
        ...context.trace.outcomes,
        {
          capabilityId: output.capabilityId,
          status: output.status,
          representationKinds: output.representations.map((item) => item.kind),
        },
      ],
    },
  };
}

export function contributeModelOutput(
  context: CognitiveOperationContext,
  input: {
    provider: "local" | "mid" | "frontier";
    model: string;
    experienceId?: string;
    characters: number;
  }
): CognitiveOperationContext {
  const capabilityId = `${input.provider}_model` as CapabilityId;
  return contributeCapabilityOutput(context, {
    capabilityId,
    status: "produced",
    representations: [{
      capabilityId,
      kind: "model_response",
      ids: input.experienceId ? [input.experienceId] : undefined,
      characters: input.characters,
      detail: `${input.provider}:${input.model}`,
    }],
  });
}

export function contributeToolOutputs(
  context: CognitiveOperationContext,
  outputs: Array<{
    name: string;
    ok: boolean;
    characters: number;
    experienceId?: string;
  }>
): CognitiveOperationContext {
  return contributeCapabilityOutput(context, {
    capabilityId: "tools",
    status: outputs.length > 0 ? "produced" : "empty",
    representations: outputs.map((output) => ({
      capabilityId: "tools",
      kind: "tool_result",
      ids: output.experienceId ? [output.experienceId] : undefined,
      characters: output.characters,
      detail: `${output.name}:${output.ok ? "ok" : "failed"}`,
    })),
  });
}

export function recordCapabilityDegradation(
  context: CognitiveOperationContext,
  degradation: CapabilityDegradation
): CognitiveOperationContext {
  return {
    ...context,
    trace: {
      ...context.trace,
      degradations: [...context.trace.degradations, degradation],
    },
  };
}

export function expandCapabilities(
  context: CognitiveOperationContext,
  input: {
    trigger: ActivationExpansionTrigger;
    reason: string;
    capabilityIds: CapabilityId[];
    fromCapabilityId?: CapabilityId;
  }
): CognitiveOperationContext {
  const depth = context.trace.expansions.length + 1;
  const requested = [...new Set(input.capabilityIds)];
  const activated: CapabilityId[] = [];
  const rejected: Array<{ capabilityId: CapabilityId; reason: string }> = [];
  let next = context;

  if (
    context.trace.expansions.length >= context.limits.maxExpansions ||
    depth > context.limits.maxExpansionDepth
  ) {
    return context;
  }

  for (const capabilityId of requested) {
    if (next.activeCapabilityIds.includes(capabilityId)) {
      rejected.push({ capabilityId, reason: "already active" });
      continue;
    }
    const capability = next.availableCapabilities.find(
      (candidate) => candidate.descriptor.id === capabilityId
    );
    if (!capability) {
      rejected.push({ capabilityId, reason: "capability is not available to this operation" });
      continue;
    }
    const outcome = decideCandidate(next, capability, "expanded", input.reason);
    next = {
      ...next,
      activeCapabilityIds: outcome.selected
        ? [...next.activeCapabilityIds, capabilityId]
        : next.activeCapabilityIds,
      trace: {
        ...next.trace,
        decisions: [...next.trace.decisions, outcome.decision],
        degradations:
          outcome.decision.state === "degraded"
            ? [
                ...next.trace.degradations,
                {
                  capabilityId,
                  reason: outcome.decision.reason,
                  fallback: "do not widen beyond the requested bounded expansion",
                },
              ]
            : next.trace.degradations,
      },
    };
    if (outcome.selected) activated.push(capabilityId);
    else rejected.push({ capabilityId, reason: outcome.decision.reason });
  }

  return {
    ...next,
    trace: {
      ...next.trace,
      expansions: [
        ...next.trace.expansions,
        {
          trigger: input.trigger,
          reason: input.reason,
          fromCapabilityId: input.fromCapabilityId,
          depth,
          requested,
          activated,
          rejected,
        },
      ],
    },
  };
}

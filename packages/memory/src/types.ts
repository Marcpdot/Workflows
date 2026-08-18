/**
 * Short-term memory types (package-local; compatible with Orchestrator ChatMessage).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * High-fidelity inputs and outputs retained before semantic interpretation.
 * This vocabulary describes source activity, not truth or epistemic status.
 */
export type ExperienceKind =
  | "user_message"
  | "assistant_output"
  | "system_message"
  | "tool_call"
  | "tool_result"
  | "human_correction"
  | "external_observation";

export interface ExperienceSource {
  /** Source modality or producer, for example `chat`, `voice`, `file`, or `api`. */
  type: string;
  /** Stable caller-supplied source reference when one exists. */
  ref?: string;
}

export interface ExperienceRecord {
  /** Stable UUID assigned once and retained across restarts. */
  id: string;
  kind: ExperienceKind;
  createdAt: number;
  sessionId?: string;
  workspaceId?: string;
  /** Exact inline payload. Large payloads may use payloadRef instead. */
  content?: string;
  /** Durable external payload/source pointer for large or future modalities. */
  payloadRef?: string;
  source?: ExperienceSource;
  /** Direct source/correlation records without assigning semantic meaning. */
  parentExperienceIds: string[];
  metadata: Record<string, unknown>;
}

export interface RecordExperienceInput {
  kind: ExperienceKind;
  sessionId?: string;
  workspaceId?: string;
  content?: string;
  payloadRef?: string;
  source?: ExperienceSource;
  parentExperienceIds?: string[];
  metadata?: Record<string, unknown>;
  /** Optional source timestamp; defaults to the recording time. */
  createdAt?: number;
}

export interface ExperienceQuery {
  sessionId?: string;
  workspaceId?: string;
  kinds?: ExperienceKind[];
  /** Latest N matching records, returned oldest-first. Default: 50. */
  limit?: number;
}

export interface ExperienceStore {
  recordExperience(input: RecordExperienceInput): Promise<ExperienceRecord>;
  getExperience(id: string): Promise<ExperienceRecord | null>;
  listExperiences(query?: ExperienceQuery): Promise<ExperienceRecord[]>;
}

/** Session interaction mode for continuous knowledge capture (design doc). */
export type InteractionMode = "active" | "neutral";

/**
 * Persisted per-session settings (mode + capture).
 * Defaults: active mode, proposals on, auto-extract when active.
 */
export interface SessionState {
  sessionId: string;
  interactionMode: InteractionMode;
  proposalsEnabled: boolean;
  lastExtractTurnId?: string;
  maxProposalsPerTurn: number;
  minUserMessageLength: number;
  updatedAt: number;
}

export interface MemoryConfig {
  /** Path to the SQLite database file. Parent dirs are created if missing. */
  dbPath: string;
  /** Default max messages returned by getHistory. Default: 50 */
  defaultLimit?: number;
}

export interface Memory extends ExperienceStore {
  /** Append a message to a session and retain its source experience. */
  add(sessionId: string, message: ChatMessage): Promise<void>;

  /** Append a message and return the durable source experience. */
  addMessage(
    sessionId: string,
    message: ChatMessage,
    context?: {
      workspaceId?: string;
      payloadRef?: string;
      source?: ExperienceSource;
      parentExperienceIds?: string[];
      metadata?: Record<string, unknown>;
      createdAt?: number;
    }
  ): Promise<ExperienceRecord>;

  /**
   * Load history for a session (oldest first).
   * @param limit max number of messages (default from config / 50)
   */
  getHistory(sessionId: string, limit?: number): Promise<ChatMessage[]>;

  /** Load exact stored messages with their durable experience identities. */
  getHistoryRecords(sessionId: string, limit?: number): Promise<StoredMessage[]>;

  /** Delete all messages for a session. */
  clear(sessionId: string): Promise<void>;

  /**
   * Distinct session ids present in the store (Milestone 9).
   * @param prefix when set, only ids that start with this prefix (workspace namespace)
   */
  listSessions(prefix?: string): Promise<string[]>;

  /** Load or create default session state (interaction mode + capture). */
  getSessionState(sessionId: string): Promise<SessionState>;

  /** Patch session state fields; creates row if missing. */
  updateSessionState(
    sessionId: string,
    patch: Partial<
      Pick<
        SessionState,
        | "interactionMode"
        | "proposalsEnabled"
        | "lastExtractTurnId"
        | "maxProposalsPerTurn"
        | "minUserMessageLength"
      >
    >
  ): Promise<SessionState>;

  /** Close the database connection. */
  close(): void;
}

export interface StoredMessage {
  id: number;
  experienceId: string;
  sessionId: string;
  role: ChatMessage["role"];
  content: string;
  createdAt: number;
}

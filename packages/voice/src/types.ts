/**
 * Milestone 18 — voice I/O types (interface only; no parallel brain).
 */

/** Physical or virtual origin of an audio stream. */
export interface AudioSource {
  surfaceId: string;
  deviceId?: string;
  channel?: string;
}

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  encoding: "pcm_s16le" | "pcm_f32le" | "opus" | "unknown";
}

/** One timestamped piece of audio; persistence is a separate policy decision. */
export interface AudioFrame {
  data: Uint8Array;
  format: AudioFormat;
  timestampMs: number;
  source: AudioSource;
}

export type TranscriptStability = "partial" | "stable" | "final";

/** Progressive speech recognition output, not semantic truth. */
export interface TranscriptUpdate {
  text: string;
  stability: TranscriptStability;
  confidence?: number;
  /** Provider-reported estimate from 0 (incomplete) to 1 (complete). */
  completeness?: number;
  isEndpoint?: boolean;
  utteranceId: string;
  source: AudioSource;
  provider: string;
  remote: boolean;
  /** Optional durable reference to retained source audio; audio is not retained by default. */
  audioRef?: string;
  timestampMs: number;
}

export type SpeechEventKind =
  | "speech_started"
  | "partial_transcript"
  | "final_transcript"
  | "speech_ended"
  | "endpoint"
  | "barge_in"
  | "cancelled";

export interface SpeechEvent {
  kind: SpeechEventKind;
  utteranceId: string;
  transcript?: TranscriptUpdate;
  reason?: string;
  timestampMs: number;
  source: AudioSource;
}

/** Bounded event history for one detected utterance. */
export interface SpeechUtterance {
  id: string;
  source: AudioSource;
  startedAtMs: number;
  endedAtMs?: number;
  finalText?: string;
  events: SpeechEvent[];
}

export type EngagementMode =
  | "push_to_talk"
  | "active_conversation"
  | "addressed"
  | "passive";

export interface EngagementState {
  mode: EngagementMode;
  addressed: boolean;
  listening: boolean;
}

/** Provider placement/privacy metadata, separate from functional speech traits. */
export interface SpeechProviderMetadata {
  localOnly: boolean;
}

/** Functional recognition traits only. */
export interface SpeechRecognitionCapabilities {
  streamingInput: boolean;
  partialTranscripts: boolean;
  wordTimestamps: boolean;
  cancellation: boolean;
  diarization: boolean;
}

/** Functional synthesis traits only. */
export interface SpeechSynthesisCapabilities {
  streamingOutput: boolean;
  streamingTextInput: boolean;
  cancellation: boolean;
}

export interface StreamingSttAdapter {
  readonly name: string;
  readonly provider: SpeechProviderMetadata;
  readonly capabilities: SpeechRecognitionCapabilities;
  recognize(
    frames: AsyncIterable<AudioFrame>,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<SpeechEvent>;
}

export interface StreamingTtsAdapter {
  readonly name: string;
  readonly provider: SpeechProviderMetadata;
  readonly capabilities: SpeechSynthesisCapabilities;
  synthesize(
    text: AsyncIterable<string> | string,
    opts: { language?: string; signal?: AbortSignal }
  ): AsyncIterable<AudioFrame>;
}

export type SttProviderName = "mock" | "local" | "cloud";
export type TtsProviderName = "off" | "mock" | "local" | "cloud";

export interface VoiceConfig {
  /** Master gate — default false (no surprise mic) */
  enabled: boolean;
  sttProvider: SttProviderName;
  ttsProvider: TtsProviderName;
  language: string;
  /** Fixed transcript for mock STT (tests / CLI --transcript) */
  mockTranscript?: string;
  /** Local STT: command template; `{input}` = audio path (optional shell path) */
  sttCommand?: string;
  /** Local TTS: command template; `{text}` and `{output}` placeholders */
  ttsCommand?: string;
  /** When true, cloud/local may send audio off-machine (document for privacy) */
  allowRemoteAudio: boolean;
}

export interface SttInput {
  /** Path to audio file (wav/mp3/…) */
  audioPath?: string;
  /** Raw audio bytes (optional; mock ignores) */
  audio?: Uint8Array;
  /** Force transcript (CLI/smoke); mock prefers this */
  transcript?: string;
  language?: string;
  signal?: AbortSignal;
}

export interface SttResult {
  text: string;
  provider: SttProviderName;
  /** true when audio may have left the machine */
  remote: boolean;
  durationMs?: number;
}

export interface TtsInput {
  text: string;
  /** Optional output path for local TTS */
  outputPath?: string;
  language?: string;
  signal?: AbortSignal;
}

export interface TtsResult {
  spoken: boolean;
  provider: TtsProviderName;
  remote: boolean;
  /** Bytes if mock/local produced audio in-memory (mock may be empty) */
  audio?: Uint8Array;
  outputPath?: string;
  /** Mock: utterances recorded for smoke */
  utterance?: string;
}

export interface SttAdapter {
  readonly name: SttProviderName;
  transcribe(input: SttInput): Promise<SttResult>;
}

export interface TtsAdapter {
  readonly name: TtsProviderName;
  speak(input: TtsInput): Promise<TtsResult>;
}

export interface VoiceTurnInput {
  /** Audio file path for real STT; omit when using transcript/mock */
  audioPath?: string;
  audio?: Uint8Array;
  /** Direct text (bypasses STT if set and stt is mock, or as override) */
  transcript?: string;
  language?: string;
  /** Stable utterance identity supplied by the capture surface when available. */
  utteranceId?: string;
  /** Physical/virtual capture origin; defaults to the compatibility voice turn. */
  source?: AudioSource;
  /** Explicit retained-audio reference. Raw/continuous audio is not retained implicitly. */
  audioRef?: string;
  /** Skip TTS even if provider is not off */
  silent?: boolean;
}

export interface VoiceExperienceLineage {
  utteranceId: string;
  audioSource: AudioSource;
  audioRef?: string;
  remote: boolean;
  provider: string;
}

/** Structurally compatible subset of the existing Orchestrator handle options. */
export interface VoiceHandleContext {
  experienceSource: {
    type: "voice";
    ref: string;
  };
  /** Existing ExperienceRecord payload pointer; absent for ephemeral audio. */
  experiencePayloadRef?: string;
  experienceMetadata: {
    voice: Omit<VoiceExperienceLineage, "audioRef">;
  };
}

export interface VoiceHandleResult {
  reply: string;
  experiences?: {
    input?: string;
    output?: string;
  };
}

export interface VoiceTurnResult {
  transcript: string;
  reply: string;
  stt: SttResult;
  tts: TtsResult | null;
  utteranceId: string;
  source: AudioSource;
  inputExperienceId?: string;
  outputExperienceId?: string;
  /** Same shape consumers should treat as text-chat outcome */
  viaVoice: true;
}

/** Handle function — must be Orchestrator.handle (or identical contract). */
export type VoiceHandleFn = (
  text: string,
  context?: VoiceHandleContext
) => Promise<VoiceHandleResult>;

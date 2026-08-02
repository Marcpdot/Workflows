/**
 * Milestone 18 — voice I/O types (interface only; no parallel brain).
 */

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
  /** Skip TTS even if provider is not off */
  silent?: boolean;
}

export interface VoiceTurnResult {
  transcript: string;
  reply: string;
  stt: SttResult;
  tts: TtsResult | null;
  /** Same shape consumers should treat as text-chat outcome */
  viaVoice: true;
}

/** Handle function — must be Orchestrator.handle (or identical contract). */
export type VoiceHandleFn = (text: string) => Promise<{ reply: string }>;

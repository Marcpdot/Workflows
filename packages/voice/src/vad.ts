/** Replaceable speech activity detection over streaming PCM frames. */

import { audioFrameDurationMs } from "./audioTransport.js";
import type { AudioFrame } from "./types.js";

export interface VoiceActivitySample {
  active: boolean;
  rms: number;
}

export interface VoiceActivityDetector {
  readonly name: string;
  analyze(frame: AudioFrame): VoiceActivitySample;
}

export interface EnergyVoiceActivityOptions {
  /** Normalized PCM RMS threshold (0..1). */
  speechThreshold?: number;
}

/** Practical local baseline; callers may replace it with a stronger VAD. */
export class EnergyVoiceActivityDetector implements VoiceActivityDetector {
  readonly name = "energy-rms";
  private readonly threshold: number;

  constructor(options: EnergyVoiceActivityOptions = {}) {
    this.threshold = options.speechThreshold ?? 0.025;
    if (this.threshold < 0 || this.threshold > 1) {
      throw new Error("speechThreshold must be between 0 and 1");
    }
  }

  analyze(frame: AudioFrame): VoiceActivitySample {
    const rms = normalizedRms(frame);
    return { active: rms >= this.threshold, rms };
  }
}

export type VoiceActivityEventKind =
  | "speech_started"
  | "speech_continuing"
  | "speech_ended";

export interface VoiceActivityEvent {
  kind: VoiceActivityEventKind;
  frame: AudioFrame;
  rms: number;
  silenceMs: number;
}

export interface SpeechActivityOptions {
  minSpeechFrames?: number;
  endSilenceMs?: number;
}

/** Small stateful debounce around a replaceable frame-level detector. */
export class SpeechActivityTracker {
  private readonly minSpeechFrames: number;
  private readonly endSilenceMs: number;
  private activeFrames = 0;
  private silenceMs = 0;
  private speaking = false;

  constructor(
    private readonly detector: VoiceActivityDetector,
    options: SpeechActivityOptions = {}
  ) {
    this.minSpeechFrames = options.minSpeechFrames ?? 1;
    this.endSilenceMs = options.endSilenceMs ?? 650;
    if (this.minSpeechFrames < 1 || this.endSilenceMs < 0) {
      throw new Error("invalid speech activity limits");
    }
  }

  push(frame: AudioFrame): VoiceActivityEvent | undefined {
    const sample = this.detector.analyze(frame);
    if (sample.active) {
      this.activeFrames += 1;
      this.silenceMs = 0;
      if (!this.speaking && this.activeFrames >= this.minSpeechFrames) {
        this.speaking = true;
        return {
          kind: "speech_started",
          frame,
          rms: sample.rms,
          silenceMs: 0,
        };
      }
      if (this.speaking) {
        return {
          kind: "speech_continuing",
          frame,
          rms: sample.rms,
          silenceMs: 0,
        };
      }
      return undefined;
    }

    this.activeFrames = 0;
    if (!this.speaking) return undefined;
    this.silenceMs += audioFrameDurationMs(frame);
    if (this.silenceMs < this.endSilenceMs) {
      return {
        kind: "speech_continuing",
        frame,
        rms: sample.rms,
        silenceMs: this.silenceMs,
      };
    }

    const silenceMs = this.silenceMs;
    this.speaking = false;
    this.silenceMs = 0;
    return {
      kind: "speech_ended",
      frame,
      rms: sample.rms,
      silenceMs,
    };
  }

  reset(): void {
    this.activeFrames = 0;
    this.silenceMs = 0;
    this.speaking = false;
  }

  get active(): boolean {
    return this.speaking;
  }
}

function normalizedRms(frame: AudioFrame): number {
  const view = new DataView(
    frame.data.buffer,
    frame.data.byteOffset,
    frame.data.byteLength
  );
  let squares = 0;
  let count = 0;
  if (frame.format.encoding === "pcm_s16le") {
    for (let offset = 0; offset + 1 < view.byteLength; offset += 2) {
      const value = view.getInt16(offset, true) / 32_768;
      squares += value * value;
      count += 1;
    }
  } else if (frame.format.encoding === "pcm_f32le") {
    for (let offset = 0; offset + 3 < view.byteLength; offset += 4) {
      const value = Math.max(-1, Math.min(1, view.getFloat32(offset, true)));
      squares += value * value;
      count += 1;
    }
  } else {
    throw new Error("EnergyVoiceActivityDetector requires raw PCM frames");
  }
  return count ? Math.sqrt(squares / count) : 0;
}

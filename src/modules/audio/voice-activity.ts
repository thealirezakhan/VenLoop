export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / samples.length);
}

export function joinTranscript(finalText: string, interimText: string): string {
  return `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
}

export type VoiceActivityEvent = "speech_start" | "speech_end" | "no_speech";

export interface VoiceActivityOptions {
  speechThreshold?: number;
  endSilenceMs?: number;
  noSpeechMs?: number;
  minSpeechMs?: number;
}

/**
 * Energy VAD for the browser fallback path. The browser speech API has its own
 * endpointing; this tracker is used when we must record a turn ourselves.
 * Timestamps are caller-supplied so the logic is deterministic in tests.
 */
export class VoiceActivityDetector {
  private readonly speechThreshold: number;
  private readonly endSilenceMs: number;
  private readonly noSpeechMs: number;
  private readonly minSpeechMs: number;
  private startedAt = 0;
  private speechStartedAt = 0;
  private speechStarted = false;
  private silenceSince: number | null = null;

  constructor(options: VoiceActivityOptions = {}) {
    this.speechThreshold = options.speechThreshold ?? 0.025;
    this.endSilenceMs = options.endSilenceMs ?? 900;
    this.noSpeechMs = options.noSpeechMs ?? 15_000;
    this.minSpeechMs = options.minSpeechMs ?? 250;
  }

  reset(now: number): void {
    this.startedAt = now;
    this.speechStartedAt = now;
    this.speechStarted = false;
    this.silenceSince = null;
  }

  update(rms: number, now: number): VoiceActivityEvent | null {
    if (rms >= this.speechThreshold) {
      if (!this.speechStarted) {
        this.speechStarted = true;
        this.speechStartedAt = now;
        this.silenceSince = null;
        return "speech_start";
      }
      this.silenceSince = null;
      return null;
    }

    if (!this.speechStarted) {
      if (now - this.startedAt >= this.noSpeechMs) {
        this.reset(now);
        return "no_speech";
      }
      return null;
    }

    if (this.silenceSince === null) this.silenceSince = now;
    if (
      now - this.speechStartedAt >= this.minSpeechMs &&
      now - this.silenceSince >= this.endSilenceMs
    ) {
      this.reset(now);
      return "speech_end";
    }
    return null;
  }
}

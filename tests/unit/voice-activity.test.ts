import { describe, expect, it } from "vitest";
import {
  computeRms,
  joinTranscript,
  VoiceActivityDetector,
} from "@/modules/audio/voice-activity";

describe("computeRms", () => {
  it("returns zero for silence and a positive value for signal", () => {
    expect(computeRms(new Float32Array(128))).toBe(0);
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe("joinTranscript", () => {
  it("joins final and interim text without duplicate spaces", () => {
    expect(joinTranscript(" I took ", " my pill ")).toBe("I took my pill");
    expect(joinTranscript("", "hello")).toBe("hello");
    expect(joinTranscript("done", "")).toBe("done");
  });

  it("does not repeat a word reported by both final and interim segments", () => {
    expect(joinTranscript("I feel feverish", "feverish and dizzy")).toBe(
      "I feel feverish and dizzy",
    );
    expect(joinTranscript("that that", "")).toBe("that that");
  });
});

describe("VoiceActivityDetector", () => {
  it("detects speech start and ends after sustained silence", () => {
    const vad = new VoiceActivityDetector({ endSilenceMs: 900, minSpeechMs: 250 });
    vad.reset(0);

    expect(vad.update(0, 100)).toBeNull();
    expect(vad.update(0.2, 200)).toBe("speech_start");
    expect(vad.update(0.2, 600)).toBeNull();
    expect(vad.update(0, 700)).toBeNull();
    expect(vad.update(0, 1_599)).toBeNull();
    expect(vad.update(0, 1_600)).toBe("speech_end");
  });

  it("ignores a short blip shorter than the minimum speech duration", () => {
    const vad = new VoiceActivityDetector({ endSilenceMs: 900, minSpeechMs: 250 });
    vad.reset(0);

    expect(vad.update(0.2, 100)).toBe("speech_start");
    expect(vad.update(0, 150)).toBeNull();
    expect(vad.update(0, 1_100)).toBe("speech_end");
  });

  it("waits 2.5 seconds of silence and resets when speech resumes", () => {
    const vad = new VoiceActivityDetector({ endSilenceMs: 2_500, minSpeechMs: 220 });
    vad.reset(0);

    expect(vad.update(0.2, 100)).toBe("speech_start");
    expect(vad.update(0, 1_000)).toBeNull();
    expect(vad.update(0.2, 2_000)).toBeNull();
    expect(vad.update(0, 3_000)).toBeNull();
    expect(vad.update(0, 5_499)).toBeNull();
    expect(vad.update(0, 5_500)).toBe("speech_end");
  });

  it("ends an utterance at the maximum duration even while speech continues", () => {
    const vad = new VoiceActivityDetector({ maxSpeechMs: 5_000, endSilenceMs: 2_500 });
    vad.reset(0);

    expect(vad.update(0.2, 500)).toBe("speech_start");
    expect(vad.update(0.2, 5_499)).toBeNull();
    expect(vad.update(0.2, 5_500)).toBe("max_duration");
  });

  it("reports no speech after the idle timeout", () => {
    const vad = new VoiceActivityDetector({ noSpeechMs: 5_000 });
    vad.reset(0);

    expect(vad.update(0, 4_999)).toBeNull();
    expect(vad.update(0, 5_000)).toBe("no_speech");
  });

  it("resets its window after an event", () => {
    const vad = new VoiceActivityDetector({ noSpeechMs: 1_000 });
    vad.reset(0);

    expect(vad.update(0, 1_000)).toBe("no_speech");
    expect(vad.update(0, 1_001)).toBeNull();
    expect(vad.update(0.2, 1_100)).toBe("speech_start");
  });
});

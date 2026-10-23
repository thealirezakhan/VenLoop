import { describe, expect, it } from "vitest";
import {
  canSubmitTurn,
  formatElapsed,
  isCallLive,
  phaseDetail,
  phaseLabel,
  type CallPhase,
} from "@/modules/audio/call-state";

describe("call state helpers", () => {
  it("formats elapsed call time as zero-padded minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(3_661)).toBe("61:01");
    expect(formatElapsed(-4)).toBe("00:00");
  });

  it("only treats connected, in-progress phases as live", () => {
    const live: CallPhase[] = [
      "requesting_mic",
      "connecting",
      "listening",
      "processing",
      "speaking",
      "text_fallback",
    ];
    const notLive: CallPhase[] = ["idle", "ended", "error"];

    for (const phase of live) expect(isCallLive(phase)).toBe(true);
    for (const phase of notLive) expect(isCallLive(phase)).toBe(false);
  });

  it("allows typed turns while listening, speaking, or in text fallback", () => {
    expect(canSubmitTurn("listening")).toBe(true);
    expect(canSubmitTurn("speaking")).toBe(true);
    expect(canSubmitTurn("text_fallback")).toBe(true);
    expect(canSubmitTurn("processing")).toBe(false);
    expect(canSubmitTurn("ended")).toBe(false);
    expect(canSubmitTurn("idle")).toBe(false);
  });

  it("does not claim listening while the microphone is muted", () => {
    expect(phaseLabel("listening", true, true)).toBe("Microphone muted");
    expect(phaseLabel("listening", false, true)).toBe("Listening");
    expect(phaseLabel("speaking", false, false)).toBe("Reply muted");
    expect(phaseLabel("text_fallback", false, true)).toBe("Text fallback");
  });

  it("explains the half-duplex playback state", () => {
    expect(phaseDetail("speaking")).toMatch(/paused during playback/i);
    expect(phaseDetail("text_fallback")).toMatch(/Type a reply/i);
  });
});

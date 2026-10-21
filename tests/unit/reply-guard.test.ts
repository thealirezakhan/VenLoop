import { describe, expect, it } from "vitest";
import { checkAgentText } from "@/modules/conversation/reply-guard";

const base = { decisionType: "log_adherence", actionTaken: false };

describe("LLM reply guard", () => {
  it("accepts a plain acknowledgement", () => {
    expect(checkAgentText({ ...base, text: "Thank you for telling me. I have recorded that." }).ok).toBe(true);
  });

  it("rejects dosage instructions", () => {
    expect(
      checkAgentText({ ...base, text: "You should take two pills instead of one." }).ok,
    ).toBe(false);
    expect(checkAgentText({ ...base, text: "Take an extra dose tonight." }).ok).toBe(false);
    expect(checkAgentText({ ...base, text: "Double your dose tomorrow morning." }).ok).toBe(false);
    expect(checkAgentText({ ...base, text: "Take one more pill tonight." }).ok).toBe(false);
    expect(checkAgentText({ ...base, text: "You should stop taking it." }).ok).toBe(false);
  });

  it("rejects diagnostic claims", () => {
    expect(checkAgentText({ ...base, text: "You have an infection and should rest." }).ok).toBe(false);
    expect(checkAgentText({ ...base, text: "It may be a side effect." }).ok).toBe(false);
  });

  it("rejects questions because the deterministic gate owns follow-ups", () => {
    expect(checkAgentText({ ...base, text: "Thank you. How are you feeling now?" }).ok).toBe(false);
  });

  it("rejects unbacked contact claims", () => {
    const text = "Your caregiver has been alerted and will call you.";
    expect(checkAgentText({ ...base, text }).ok).toBe(false);
    expect(
      checkAgentText({ ...base, decisionType: "symptom_escalation", actionTaken: true, text }).ok,
    ).toBe(true);
  });

  it("only allows emergency references on the emergency path", () => {
    const text = "Please call 911 if this gets worse.";
    expect(checkAgentText({ ...base, text }).ok).toBe(false);
    expect(checkAgentText({ ...base, decisionType: "emergency_guidance", text }).ok).toBe(true);
  });

  it("rejects explicit milligram amounts", () => {
    expect(checkAgentText({ ...base, text: "That would be 10mg in total." }).ok).toBe(false);
  });
});

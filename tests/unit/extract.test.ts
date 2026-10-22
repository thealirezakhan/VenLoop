import { describe, expect, it } from "vitest";
import { extractSignals } from "@/modules/rules-engine/extract";

describe("extractSignals", () => {
  it("TC1 wording: took morning tablets", () => {
    expect(extractSignals("Yes, I took my morning tablets")).toMatchObject({
      adherenceStatus: "reported_taken",
      dosageQuestion: false,
      needsClarification: false,
    });
  });

  it("not-taken wording", () => {
    expect(extractSignals("I forgot to take my tablets this morning").adherenceStatus).toBe(
      "reported_not_taken",
    );
  });

  it("understands natural confirmations and symptom wording", () => {
    expect(extractSignals("I took it").adherenceStatus).toBe("reported_taken");
    expect(extractSignals("I took them this morning").adherenceStatus).toBe("reported_taken");
    expect(extractSignals("I feel sick to my stomach").symptoms).toContain("nausea_or_vomiting");
    expect(extractSignals("I am a bit lightheaded").symptoms).toContain("dizziness");
  });

  it("TC3 wording: dizziness is a symptom, adherence unknown", () => {
    const signals = extractSignals("I feel a bit dizzy today");
    expect(signals.symptoms).toContain("dizziness");
    expect(signals.adherenceStatus).toBe("unknown");
  });

  it("TC4 wording: dosage-change question", () => {
    expect(extractSignals("Should I double the dose?").dosageQuestion).toBe(true);
    expect(extractSignals("Can I take twice the tablets today").dosageQuestion).toBe(true);
    expect(extractSignals("Should I change my dosage?").dosageQuestion).toBe(true);
    expect(extractSignals("Should I take another dose?").dosageQuestion).toBe(true);
    expect(extractSignals("Can I take one more pill?").dosageQuestion).toBe(true);
    expect(extractSignals("I took an extra tablet, is that okay?").dosageQuestion).toBe(true);
  });

  it("emergency phrases set the emergency flag", () => {
    for (const t of [
      "I cannot breathe properly",
      "I have chest pain",
      "I feel like I might faint",
      "Please help me",
      "I think I took too many pills",
      "I have trouble breathing",
      "I have difficulty breathing",
      "Breathing is hard right now",
    ]) {
      expect(extractSignals(t).emergency, t).toBe(true);
    }
  });

  it("breathing trouble outranks a dosage question in the same utterance", () => {
    const signals = extractSignals(
      "I feel dizzy and have trouble breathing. Should I take another dose?",
    );
    expect(signals.emergency).toBe(true);
    expect(signals.dosageQuestion).toBe(true);
    expect(signals.symptoms).toContain("dizziness");
  });

  it("explicitly denied breathing trouble is not an emergency", () => {
    expect(extractSignals("I have no trouble breathing and no chest pain").emergency).toBe(false);
    expect(extractSignals("I do not have difficulty breathing").emergency).toBe(false);
  });

  it("a denial does not mask a separate emergency in the same sentence", () => {
    expect(extractSignals("I have no chest pain but I can't catch my breath").emergency).toBe(true);
    expect(extractSignals("No fever, but breathing is hard").emergency).toBe(true);
  });

  it("routine answers never set the emergency flag", () => {
    expect(extractSignals("Yes, I took my morning tablets").emergency).toBe(false);
    expect(extractSignals("I feel a bit dizzy today").emergency).toBe(false);
  });

  it("ambiguous answers never become taken", () => {
    for (const t of ["I think so", "Maybe", "I took something earlier", "Not sure"]) {
      const s = extractSignals(t);
      expect(s.adherenceStatus, t).toBe("unknown");
      expect(s.needsClarification, t).toBe(true);
    }
  });

  it("unrecognized text degrades to clarification", () => {
    const s = extractSignals("the weather is lovely today");
    expect(s.needsClarification).toBe(true);
    expect(s.adherenceStatus).toBe("unknown");
  });

  it("dosage question is detected even when adherence is also reported", () => {
    const s = extractSignals("Yes I took my tablets. Should I double the dose?");
    expect(s.dosageQuestion).toBe(true);
    expect(s.adherenceStatus).toBe("reported_taken");
  });

  it("extracts every fact from one multi-signal sentence", () => {
    const s = extractSignals(
      "I took the pills but I feel like having a fever. Should I take another pill?",
    );
    expect(s.adherenceStatus).toBe("reported_taken");
    expect(s.symptoms).toContain("possible_fever");
    expect(s.dosageQuestion).toBe(true);
  });

  it("empty input needs clarification", () => {
    expect(extractSignals("   ").needsClarification).toBe(true);
  });
});

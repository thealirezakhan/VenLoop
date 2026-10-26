import { describe, expect, it } from "vitest";
import { interpretTranscript } from "@/modules/conversation/transcript-interpretation";
import { evaluateDecision } from "@/modules/rules-engine/rules";
import type { ExtractedSignals } from "@/modules/rules-engine/extract";

function interpret(text: string, language = "en") {
  return interpretTranscript({
    rawTranscript: text,
    normalizedTranscript: text,
    language,
  });
}

function decide(signals: ExtractedSignals) {
  return evaluateDecision({
    adherenceStatus: signals.adherenceStatus,
    symptoms: signals.symptoms,
    dosageQuestion: signals.dosageQuestion,
    needsClarification: signals.needsClarification,
    noAnswerAttempts: 0,
    consentValid: true,
    emergency: signals.emergency,
  });
}

describe("transcript interpretation safety cases", () => {
  it("A: keeps a dosage question on the dosage safety path without correction", () => {
    const result = interpret("Should I take two tablets instead of one?");
    expect(result.interpretedSignals.dosageQuestion).toBe(true);
    expect(result.interpretedSignals.adherenceLocked).toBe(false);
    expect(result.correctionCandidates).toEqual([]);
    expect(decide(result.interpretedSignals).type).toBe("dosage_safety_response");
  });

  it("B: a previous-day statement never marks today's dose as missed", () => {
    const text = "I forgot to take those yesterday.";
    const result = interpret(text);
    expect(result.rawTranscript).toBe(text);
    expect(result.interpretedSignals.previousDayReference).toBe(true);
    expect(result.interpretedSignals.temporalScope).toBe("previous_day");
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
    expect(result.interpretedSignals.adherenceStatus).toBe("unknown");
    expect(result.correctionStatus).toBe("requires_confirmation");
    expect(decide(result.interpretedSignals).type).toBe("clarification_required");
  });

  it("C: an explicit today negation stays a not-taken report", () => {
    const result = interpret("I haven't taken my medicine today.");
    expect(result.interpretedSignals.adherenceStatus).toBe("reported_not_taken");
    expect(result.interpretedSignals.adherenceLocked).toBe(false);
    expect(result.correctionCandidates).toEqual([]);
    expect(decide(result.interpretedSignals).type).toBe("log_adherence");
  });

  it("D: uncertain positive wording never becomes taken", () => {
    const result = interpret("I think I might have taken it.");
    expect(result.interpretedSignals.uncertainty).toBe(true);
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
    expect(result.interpretedSignals.adherenceStatus).toBe("unknown");
    expect(result.interpretedSignals.needsClarification).toBe(true);
    expect(result.correctionCandidates.map((item) => item.kind)).toContain("uncertainty");
    expect(decide(result.interpretedSignals).type).toBe("clarification_required");
  });

  it("D2: a hedged negative is not treated as a confident negative", () => {
    const result = interpret("I don't think I took it.");
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
    expect(result.interpretedSignals.adherenceStatus).toBe("unknown");
    expect(decide(result.interpretedSignals).type).toBe("clarification_required");
  });

  it("E: an explicit negation is preserved", () => {
    const result = interpret("I did not take my medicine.");
    expect(result.interpretedSignals.adherenceStatus).toBe("reported_not_taken");
    expect(result.interpretedSignals.adherenceLocked).toBe(false);
    expect(decide(result.interpretedSignals).type).toBe("log_adherence");
  });

  it("F: mixed-language uncertainty locks adherence", () => {
    const text = "I think maybe I took it, pata nahi";
    const result = interpret(text, "hi");
    expect(result.interpretedSignals.mixedLanguage).toBe(true);
    expect(result.interpretedSignals.uncertainty).toBe(true);
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
    expect(result.interpretedSignals.adherenceStatus).toBe("unknown");
    expect(result.correctionCandidates.map((item) => item.kind)).toContain("mixed_language");
    expect(decide(result.interpretedSignals).type).toBe("clarification_required");
  });

  it("locks a confident previous-day report but not a current-day report", () => {
    expect(interpret("I took it yesterday").interpretedSignals.adherenceLocked).toBe(true);
    expect(interpret("I took it today").interpretedSignals.adherenceLocked).toBe(false);
  });

  it("treats kal as ambiguous instead of assuming yesterday or tomorrow", () => {
    const result = interpret("Maine kal dawa li", "hi");
    expect(result.interpretedSignals.temporalScope).toBe("unclear");
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
    expect(result.correctionCandidates.map((item) => item.kind)).toContain("temporal_scope");
  });

  it("does not lock adherence for an unrelated uncertain symptom", () => {
    const result = interpret("I think I have a fever.");
    expect(result.interpretedSignals.uncertainty).toBe(true);
    expect(result.interpretedSignals.adherenceLocked).toBe(false);
    expect(result.correctionCandidates).toEqual([]);
    expect(decide(result.interpretedSignals).type).toBe("symptom_escalation");
  });

  it("flags a door/dose confusion without rewriting the raw transcript", () => {
    const text = "I took my medicine but I feel feverish. Should I take another door of medicine?";
    const result = interpret(text);
    expect(result.rawTranscript).toBe(text);
    expect(result.correctedTranscript).toBe(text);
    expect(result.correctionCandidates).toContainEqual(
      expect.objectContaining({ kind: "stt_confusion", proposedValue: "text:dose" }),
    );
    expect(result.interpretedSignals.dosageQuestion).toBe(true);
    expect(decide(result.interpretedSignals).type).toBe("dosage_safety_response");
  });

  it("flags a meditation/medication confusion without rewriting it", () => {
    const text = "I took my meditation";
    const result = interpret(text);
    expect(result.correctedTranscript).toBe(text);
    expect(result.correctionCandidates).toContainEqual(
      expect.objectContaining({ kind: "stt_confusion", proposedValue: "text:medication" }),
    );
    expect(result.interpretedSignals.adherenceStatus).toBe("unknown");
    expect(result.interpretedSignals.adherenceLocked).toBe(true);
  });
});

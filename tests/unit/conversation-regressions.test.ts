import { describe, expect, it } from "vitest";
import { extractSignals } from "@/modules/rules-engine/extract";
import {
  advanceConversation,
  emptyConversationState,
  type ConversationState,
} from "@/modules/conversation/state";
import type { ConversationAnalysis } from "@/modules/conversation/analysis";

function turn(
  state: ConversationState,
  transcript: string,
  decision: Parameters<typeof advanceConversation>[1]["decision"],
  escalated = false,
  extra: Partial<Parameters<typeof advanceConversation>[1]> = {},
) {
  return advanceConversation(state, {
    transcript,
    signals: extractSignals(transcript),
    decision,
    escalated,
    ...extra,
  });
}

function analysis(overrides: Partial<ConversationAnalysis> = {}): ConversationAnalysis {
  return {
    language: "en",
    adherenceStatus: "unknown",
    symptoms: [],
    addressedSymptoms: [],
    dosageQuestion: false,
    emergency: false,
    contradictions: [],
    unansweredQuestions: [],
    uncertainty: [],
    recommendedNextStep: "close",
    replyText: "",
    followUpQuestion: null,
    summary: "Model summary that must not replace deterministic state.",
    ...overrides,
  };
}

describe("conversation regressions", () => {
  it("merges a misspelled vomiting clarification into the open nausea concern", () => {
    const first = turn(emptyConversationState(), "I feel nauseous today.", "symptom_escalation", true);
    const second = turn(first.state, "I am vomitting now.", "symptom_escalation", true);

    expect(second.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.state.severeSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.state.retractedSymptoms).toEqual([]);
    expect(second.closing).toBe(true);
  });

  it("keeps every reported symptom across separate turns", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "I also have a mild fever.", "symptom_escalation", true);
    const third = turn(
      second.state,
      "The nausea started this morning and is mild.",
      "symptom_escalation",
      true,
    );
    const fourth = turn(
      third.state,
      "The fever started last night and is mild.",
      "symptom_escalation",
      true,
    );

    expect(fourth.state.symptoms).toEqual(["nausea_or_vomiting", "possible_fever"]);
    expect(fourth.state.addressedSymptoms).toEqual(["nausea_or_vomiting", "possible_fever"]);
    expect(fourth.closing).toBe(true);
  });

  it("treats a new symptom as a clarification, not a replacement", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "I have a headache instead.", "symptom_escalation", true);

    expect(second.state.symptoms).toEqual(["nausea_or_vomiting", "headache"]);
    expect(second.state.addressedSymptoms).toEqual([]);
    expect(second.followUpQuestion).toMatch(/nausea/i);
    expect(second.closing).toBe(false);
  });

  it("retracts an explicitly resolved symptom but keeps immutable evidence", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "Actually the nausea has passed.", "symptom_escalation", true);

    expect(second.state.symptoms).toEqual([]);
    expect(second.state.retractedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.state.facts.some((fact) => fact.kind === "symptom_retracted")).toBe(true);
    expect(second.closing).toBe(true);
  });

  it("records an unanswered question when the patient declines follow-up", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "I'd rather not answer.", "symptom_escalation", true);

    expect(second.closing).toBe(true);
    expect(second.state.unansweredQuestions.join(" ")).toMatch(/nausea/i);
  });

  it("caps repeated follow-ups and records the question as unanswered", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "I don't know.", "symptom_escalation", true);
    const third = turn(second.state, "I am not sure.", "symptom_escalation", true);
    const fourth = turn(third.state, "I still do not know.", "symptom_escalation", true);

    expect(second.followUpQuestion).toMatch(/nausea/i);
    expect(third.followUpQuestion).toMatch(/nausea/i);
    expect(fourth.followUpQuestion).toBeNull();
    expect(fourth.state.followUpAttempts["symptom_details:nausea_or_vomiting"]).toBe(3);
    expect(fourth.state.unansweredQuestions.join(" ")).toMatch(/nausea/i);
    expect(fourth.closing).toBe(true);
  });

  it("ends immediately on an emergency during an open symptom assessment", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(
      first.state,
      "Now I have chest pain and I can't breathe.",
      "emergency_guidance",
      true,
    );

    expect(second.state.escalation).toBe("emergency");
    expect(second.state.escalationDecision).toBe("emergency_guidance");
    expect(second.followUpQuestion).toBeNull();
    expect(second.closing).toBe(true);
    expect(second.state.endReason).toBe("escalated");
  });

  it("preserves the escalation decision after a symptom is retracted", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "The nausea has passed.", "symptom_escalation", true);

    expect(second.state.escalation).toBe("case_opened");
    expect(second.state.escalationDecision).toBe("symptom_escalation");
    expect(second.state.endReason).toBe("escalated");
  });

  it("accepts canonical model codes and ignores invented symptom codes", () => {
    const first = turn(emptyConversationState(), "I feel nauseous.", "symptom_escalation", true);
    const second = turn(first.state, "It started this morning and is mild.", "symptom_escalation", true, {
      analysis: analysis({
        symptoms: [{ code: "invented_rash", severity: "severe", sourceText: "rash" }],
        addressedSymptoms: ["Nausea & Vomiting", "invented_rash"],
      }),
      analysisSource: "llm",
    });

    expect(second.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.state.severeSymptoms).toEqual([]);
    expect(second.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.closing).toBe(true);
  });

  it("keeps unknown facts explicit and builds a deterministic summary", () => {
    const result = turn(
      emptyConversationState(),
      "I am not sure.",
      "clarification_required",
      false,
      {
        analysis: analysis({
          summary: "Model guessed the patient took medication.",
          recommendedNextStep: "close",
        }),
        analysisSource: "llm",
      },
    );

    expect(result.state.medicationStatus).toBe("unknown");
    expect(result.state.summary).toContain("Medication: unknown");
    expect(result.state.summary).not.toContain("Model guessed");
    expect(result.state.summary).not.toContain("Medication: reported");
    expect(result.state.recommendedNextStep).toBe("reply_only");
    expect(result.closing).toBe(false);
  });
});

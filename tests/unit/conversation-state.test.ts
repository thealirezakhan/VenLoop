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
    summary: "Test summary.",
    ...overrides,
  };
}

describe("conversation state (multi-turn safety gate)", () => {
  it("keeps the call open after a nausea report and asks onset/severity", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    expect(turnOne.closing).toBe(false);
    expect(turnOne.followUpQuestion).toMatch(/when did the nausea start/i);
    expect(turnOne.followUpQuestion).toMatch(/mild or severe/i);
    expect(turnOne.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnOne.state.escalation).toBe("case_opened");
    expect(turnOne.state.openQuestions).toEqual(["symptom_details:nausea_or_vomiting"]);
  });

  it("closes naturally once the symptom question is answered", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(
      turnOne.state,
      "It started this morning and it is mild. I am not vomiting.",
      "symptom_escalation",
      true,
    );
    expect(turnTwo.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnTwo.state.openQuestions).toEqual([]);
    expect(turnTwo.followUpQuestion).toBeNull();
    expect(turnTwo.closing).toBe(true);
    expect(turnTwo.state.endReason).toBe("escalated");
    expect(turnTwo.state.unansweredQuestions).toEqual([]);
  });

  it("treats a bare no as an answer to the symptom question", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(turnOne.state, "No, it's mild.", "symptom_escalation", true);
    expect(turnTwo.closing).toBe(true);
    expect(turnTwo.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
  });

  it("asks about each reported symptom separately", () => {
    const turnOne = turn(emptyConversationState(), "I feel dizzy and nauseous today.", "symptom_escalation", true);
    expect(turnOne.followUpQuestion).toMatch(/dizziness/i);
    expect(turnOne.state.openQuestions).toHaveLength(2);

    const turnTwo = turn(
      turnOne.state,
      "The dizziness started this morning and it is mild.",
      "symptom_escalation",
      true,
    );
    expect(turnTwo.state.addressedSymptoms).toEqual(["dizziness"]);
    expect(turnTwo.followUpQuestion).toMatch(/nausea/i);
    expect(turnTwo.closing).toBe(false);

    const turnThree = turn(
      turnTwo.state,
      "The nausea started today and it is mild.",
      "symptom_escalation",
      true,
    );
    expect(turnThree.state.addressedSymptoms).toEqual(["dizziness", "nausea_or_vomiting"]);
    expect(turnThree.closing).toBe(true);
  });

  it("does not resolve the nausea question when a different symptom is reported", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(
      turnOne.state,
      "I think I have mild fever too.",
      "symptom_escalation",
      true,
    );
    expect(turnTwo.state.symptoms).toEqual(["nausea_or_vomiting", "possible_fever"]);
    expect(turnTwo.state.addressedSymptoms).toEqual([]);
    expect(turnTwo.followUpQuestion).toMatch(/nausea/i);
    expect(turnTwo.closing).toBe(false);
  });

  it("records severe symptoms without diagnosing", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(
      turnOne.state,
      "It started this morning and I am vomiting.",
      "symptom_escalation",
      true,
    );
    expect(turnTwo.state.severeSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnTwo.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnTwo.closing).toBe(true);
  });

  it("does not treat 'feel like vomiting' as actual vomiting", () => {
    const turnOne = turn(
      emptyConversationState(),
      "I feel like vomiting.",
      "symptom_escalation",
      true,
    );
    expect(turnOne.state.severeSymptoms).toEqual([]);
  });

  it("never hides an unanswered symptom if the patient declines", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(turnOne.state, "No, that's all.", "symptom_escalation", true);
    expect(turnTwo.closing).toBe(true);
    expect(turnTwo.state.unansweredQuestions.join(" ")).toMatch(/nausea/i);
  });

  it("tracks contradictory adherence reports", () => {
    const turnOne = turn(
      emptyConversationState(),
      "I took my pill. Should I take another one?",
      "dosage_safety_response",
      true,
    );
    const turnTwo = turn(turnOne.state, "I did not take my pill.", "dosage_safety_response", true);
    expect(turnTwo.state.medicationStatus).toBe("reported_not_taken");
    expect(turnTwo.state.contradictions.join(" ")).toMatch(/changed/i);
  });

  it("closes routine adherence immediately", () => {
    const result = turn(emptyConversationState(), "Yes, I took my pill.", "log_adherence", false);
    expect(result.closing).toBe(true);
    expect(result.state.endReason).toBe("completed");
  });

  it("keeps a dosage-only call open for one safety check", () => {
    const turnOne = turn(
      emptyConversationState(),
      "Should I take two pills instead?",
      "dosage_safety_response",
      true,
    );
    expect(turnOne.closing).toBe(false);
    expect(turnOne.followUpQuestion).toMatch(/any symptoms right now/i);

    const turnTwo = turn(turnOne.state, "No, that's all.", "dosage_safety_response", true);
    expect(turnTwo.closing).toBe(true);
    expect(turnTwo.state.endReason).toBe("escalated");
  });

  it("tracks dosage safety and symptom assessment as separate active concerns", () => {
    const result = turn(
      emptyConversationState(),
      "I took my pill but I feel like vomiting. Should I take another pill?",
      "dosage_safety_response",
      true,
    );
    expect(result.state.medicationStatus).toBe("reported_taken");
    expect(result.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(result.state.medicationQuestions).toEqual(["dosage_change_requested"]);
    expect(result.state.activeConcerns).toEqual(["dosage_safety", "symptom_assessment", "adherence"]);
    expect(result.state.facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(["adherence", "symptom", "dosage_question"]),
    );
    expect(result.state.facts.every((fact) => fact.sourceTurnId.length > 0)).toBe(true);
    expect(result.followUpQuestion).toMatch(/nausea/i);
    expect(result.closing).toBe(false);
  });

  it("merges fever into the existing concern without losing nausea", () => {
    const turnOne = turn(
      emptyConversationState(),
      "I took my pill but I feel like vomiting. Should I take another pill?",
      "dosage_safety_response",
      true,
    );
    const turnTwo = turn(
      turnOne.state,
      "I think I have mild fever too.",
      "dosage_safety_response",
      true,
    );
    expect(turnTwo.state.symptoms).toEqual(["nausea_or_vomiting", "possible_fever"]);
    expect(turnTwo.state.medicationStatus).toBe("reported_taken");
    expect(turnTwo.state.activeConcerns).toEqual(
      expect.arrayContaining(["dosage_safety", "symptom_assessment"]),
    );
    expect(turnTwo.closing).toBe(false);
  });

  it("uses LLM-addressed symptom codes without resolving unrelated questions", () => {
    const turnOne = turn(emptyConversationState(), "I feel nauseous and dizzy.", "symptom_escalation", true);
    const turnTwo = turn(turnOne.state, "The nausea started this morning and is mild.", "symptom_escalation", true, {
      analysis: analysis({ addressedSymptoms: ["nausea_or_vomiting"] }),
      analysisSource: "llm",
      language: "en",
    });
    expect(turnTwo.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnTwo.followUpQuestion).toMatch(/dizziness/i);
    expect(turnTwo.closing).toBe(false);
  });

  it("accepts a prefixed question key from the model as an addressed symptom", () => {
    const turnOne = turn(emptyConversationState(), "I feel a bit nauseous today.", "symptom_escalation", true);
    const turnTwo = turn(
      turnOne.state,
      "It started this morning and is mild.",
      "symptom_escalation",
      true,
      {
        analysis: analysis({
          addressedSymptoms: ["symptom_details:nausea_or_vomiting"],
          recommendedNextStep: "ask_followup",
          followUpQuestion: "When did the nausea start?",
        }),
        analysisSource: "llm",
      },
    );
    expect(turnTwo.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(turnTwo.state.openQuestions).toEqual([]);
    expect(turnTwo.closing).toBe(true);
  });

  it("ends an emergency call without a follow-up question", () => {
    const result = turn(
      emptyConversationState(),
      "I cannot breathe properly and my chest hurts.",
      "emergency_guidance",
      true,
    );
    expect(result.closing).toBe(true);
    expect(result.followUpQuestion).toBeNull();
    expect(result.state.escalation).toBe("emergency");
  });

  it("never downgrades an open symptom concern after a routine dosage turn", () => {
    const turnOne = turn(emptyConversationState(), "I feel dizzy.", "symptom_escalation", true);
    expect(turnOne.state.escalationDecision).toBe("symptom_escalation");
    const turnTwo = turn(turnOne.state, "Should I take another dose?", "symptom_escalation", true);
    expect(turnTwo.state.escalationDecision).toBe("symptom_escalation");
  });

  it("upgrades an open symptom concern when breathing trouble appears later", () => {
    const turnOne = turn(emptyConversationState(), "I feel dizzy.", "symptom_escalation", true);
    const turnTwo = turn(
      turnOne.state,
      "It is worse and I have trouble breathing.",
      "emergency_guidance",
      true,
    );
    expect(turnTwo.state.escalationDecision).toBe("emergency_guidance");
    expect(turnTwo.state.escalation).toBe("emergency");
    expect(turnTwo.closing).toBe(true);
  });
});

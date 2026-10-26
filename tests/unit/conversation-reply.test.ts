import { describe, expect, it } from "vitest";
import {
  analyzeTurn,
  buildAgentTurn,
  selectFollowUpQuestion,
} from "@/lib/server/conversation-reply";
import { extractSignals } from "@/modules/rules-engine/extract";
import { emptyConversationState } from "@/modules/conversation/state";
import type { ConversationAnalysis } from "@/modules/conversation/analysis";
import {
  closingCopy,
  decisionCopy,
  dosageSafetyCheck,
  notTakenCopy,
  symptomFollowUp,
} from "@/modules/conversation/language";

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

function input(transcript: string) {
  return {
    firstName: "Eleanor",
    transcript,
    normalizedEnglish: transcript,
    language: "en" as const,
    history: [],
    previousState: emptyConversationState(),
    signals: extractSignals(transcript),
    inputSource: "typed" as const,
    simulatedNotificationSent: false,
  };
}

describe("analyzeTurn latency path", () => {
  it("skips the LLM when the deterministic extractor is decisive", async () => {
    const result = await analyzeTurn(input("Yes, I took my pill."));
    expect(result.source).toBe("deterministic");
    expect(result.analysis.adherenceStatus).toBe("reported_taken");
  });

  it("skips the LLM for emergency reports", async () => {
    const result = await analyzeTurn(input("I cannot breathe properly and my chest hurts."));
    expect(result.source).toBe("deterministic");
    expect(result.analysis.emergency).toBe(true);
  });
});

describe("nurse-style wording", () => {
  it("always uses scripted dosage safety copy, even when the model sounds safer", () => {
    const agent = buildAgentTurn({
      firstName: "Eleanor",
      decisionType: "dosage_safety_response",
      adherenceStatus: "reported_taken",
      state: {
        ...emptyConversationState(),
        symptoms: ["possible_fever"],
        medicationQuestions: ["dosage_change_requested"],
      },
      analysis: analysis({
        replyText:
          "Thank you for telling me you took your pill. I am sorry about the fever, and I have noted your question for your caregiver.",
        recommendedNextStep: "ask_followup",
      }),
      analysisSource: "llm",
      language: "en",
      actionTaken: true,
      isFollowUp: false,
      closing: false,
      emergency: false,
    });

    expect(agent.source).toBe("scripted");
    expect(agent.text).toContain("not able to advise on changing your dose");
    expect(agent.text).toMatch(/contact your doctor or pharmacist/i);
    expect(agent.text).toMatch(/caregiver/i);
  });

  it("keeps non-dosage scripted copy free of advice", () => {
    const texts = [
      decisionCopy("symptom_escalation", "en"),
      decisionCopy("symptom_escalation", "en", { severe: true }),
      notTakenCopy("en"),
      symptomFollowUp("possible_fever", "en"),
      dosageSafetyCheck("en"),
      closingCopy("en", {
        firstName: "Eleanor",
        actionTaken: true,
        unanswered: false,
        emergency: false,
      }),
      closingCopy("en", {
        firstName: "Eleanor",
        actionTaken: false,
        unanswered: true,
        emergency: false,
      }),
    ];

    for (const text of texts) {
      expect(text).not.toMatch(
        /should|must|contact your doctor|pharmacist|sit or lie|care team|take another|stop taking|change your/i,
      );
    }
  });

  it("uses the model's follow-up only when it is a safe rephrasing", () => {
    const required = "When did the nausea start, and is it mild or severe?";
    const safe = selectFollowUpQuestion(
      required,
      analysis({ followUpQuestion: "Has the nausea been mild or severe since this morning?" }),
      "en",
      "symptom_escalation",
      true,
    );
    const unsafe = selectFollowUpQuestion(
      required,
      analysis({ followUpQuestion: "You should stop taking your medicine. When did it start?" }),
      "en",
      "symptom_escalation",
      true,
    );
    const dosage = selectFollowUpQuestion(
      "Before we finish, are you having any symptoms right now?",
      analysis({ followUpQuestion: "Anything else?" }),
      "en",
      "dosage_safety_response",
      true,
    );

    expect(safe).toBe("Has the nausea been mild or severe since this morning?");
    expect(unsafe).toBe(required);
    expect(dosage).toBe("Before we finish, are you having any symptoms right now?");
  });
});

import { describe, expect, it } from "vitest";
import { evaluateDecision, NO_ANSWER_ESCALATION_THRESHOLD } from "@/modules/rules-engine/rules";
import { RULE_SET_VERSION, type DecisionInput } from "@/modules/rules-engine/types";

function base(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    adherenceStatus: "unknown",
    symptoms: [],
    dosageQuestion: false,
    needsClarification: false,
    noAnswerAttempts: 0,
    consentValid: true,
    notificationDestinationKey: "assignment-1",
    ...overrides,
  };
}

describe("official scenarios (PRD 9.3)", () => {
  it("TC1: 'Yes, took morning tablets' → log_adherence", () => {
    const decision = evaluateDecision(base({ adherenceStatus: "reported_taken" }));
    expect(decision.type).toBe("log_adherence");
    expect(decision.reasonCode).toBe("ADHERENCE_REPORTED");
    expect(decision.proposedActions).toEqual([]);
    expect(decision.ruleSetVersion).toBe(RULE_SET_VERSION);
  });

  it("TC2: no answer after two tries → unreachable_escalation + family notification", () => {
    const decision = evaluateDecision(
      base({
        adherenceStatus: "unknown",
        noAnswerAttempts: NO_ANSWER_ESCALATION_THRESHOLD,
      }),
    );
    expect(decision.type).toBe("unreachable_escalation");
    expect(decision.reasonCode).toBe("NO_ANSWER_THRESHOLD");
    expect(decision.proposedActions).toHaveLength(1);
    expect(decision.proposedActions[0]?.actionType).toBe("notify_family");
    expect(decision.proposedActions[0]?.requiresApproval).toBe(false);
  });

  it("TC3: dizziness → symptom_escalation with urgent family notification (no approval gate)", () => {
    const decision = evaluateDecision(base({ symptoms: ["dizziness"] }));
    expect(decision.type).toBe("symptom_escalation");
    expect(decision.reasonCode).toBe("SYMPTOM_REPORTED");
    expect(decision.proposedActions[0]).toMatchObject({
      actionType: "notify_family",
      requiresApproval: false,
      priority: "urgent",
    });
    expect(decision.replyText).toBeTruthy();
    expect(decision.followUpQuestion).toBeTruthy();
  });

  it("TC4: dosage-change question → dosage_safety_response, never advice", () => {
    const decision = evaluateDecision(
      base({ dosageQuestion: true, adherenceStatus: "reported_taken" }),
    );
    expect(decision.type).toBe("dosage_safety_response");
    expect(decision.reasonCode).toBe("DOSAGE_QUESTION_BLOCKED");
    expect(decision.responseKey).toBe("safety.dosage_block");
    expect(decision.proposedActions[0]?.requiresApproval).toBe(false);
    // The only proposed action is human review — never anything dose-related.
    for (const action of decision.proposedActions) {
      expect(action.actionType).not.toMatch(/dose|dosage|medication_change/i);
    }
  });
});

describe("emergency pathway", () => {
  it("emergency phrase wins over dosage question and symptoms", () => {
    const decision = evaluateDecision(
      base({ emergency: true, dosageQuestion: true, symptoms: ["dizziness"] }),
    );
    expect(decision.type).toBe("emergency_guidance");
    expect(decision.reasonCode).toBe("EMERGENCY_REPORTED");
    expect(decision.followUpQuestion).toBeNull();
    expect(decision.proposedActions[0]).toMatchObject({
      actionType: "notify_family",
      requiresApproval: false,
      priority: "urgent",
    });
    expect(decision.replyText).toMatch(/emergency services/i);
  });

  it("consent still outranks the emergency pathway", () => {
    const decision = evaluateDecision(base({ emergency: true, consentValid: false }));
    expect(decision.type).toBe("unresolved");
  });
});

describe("ambiguity and safety (PRD 9.4)", () => {
  it("unknown adherence never becomes a report", () => {
    expect(evaluateDecision(base()).type).toBe("clarification_required");
  });

  it("explicit clarification flag forces clarification even if adherence was reported", () => {
    const decision = evaluateDecision(
      base({ adherenceStatus: "reported_taken", needsClarification: true }),
    );
    expect(decision.type).toBe("clarification_required");
    expect(decision.requiresClarification).toBe(true);
  });

  it("symptoms are not buried by a clarification flag or unknown adherence (TC3)", () => {
    expect(evaluateDecision(base({ symptoms: ["dizziness"] })).type).toBe("symptom_escalation");
  });

  it("invalid consent blocks the check-in before any other branch", () => {
    const decision = evaluateDecision(
      base({ consentValid: false, dosageQuestion: true, adherenceStatus: "reported_taken" }),
    );
    expect(decision.type).toBe("unresolved");
    expect(decision.proposedActions).toEqual([]);
  });

  it("symptoms win over adherence logging", () => {
    const decision = evaluateDecision(
      base({ adherenceStatus: "reported_taken", symptoms: ["chest discomfort"] }),
    );
    expect(decision.type).toBe("symptom_escalation");
  });

  it("dosage question wins over symptoms and adherence", () => {
    const decision = evaluateDecision(
      base({ dosageQuestion: true, symptoms: ["dizziness"], adherenceStatus: "reported_not_taken" }),
    );
    expect(decision.type).toBe("dosage_safety_response");
  });

  it("reported_not_taken is logged, not escalated by rules", () => {
    const decision = evaluateDecision(base({ adherenceStatus: "reported_not_taken" }));
    expect(decision.type).toBe("log_adherence");
  });

  it("one no-answer attempt does not escalate", () => {
    const decision = evaluateDecision(base({ noAnswerAttempts: 1 }));
    expect(decision.type).toBe("clarification_required");
  });

  it("missing destination key degrades to 'unassigned', never crashes", () => {
    const decision = evaluateDecision(
      base({ noAnswerAttempts: 2, notificationDestinationKey: undefined }),
    );
    expect(decision.proposedActions[0]?.destinationKey).toBe("unassigned");
  });
});

describe("conversation close-out", () => {
  it("log_adherence replies and closes without a follow-up question", () => {
    const decision = evaluateDecision(base({ adherenceStatus: "reported_taken" }));
    expect(decision.replyText).toMatch(/recorded/i);
    expect(decision.followUpQuestion).toBeNull();
  });

  it("clarification asks exactly one follow-up question", () => {
    const decision = evaluateDecision(base());
    expect(decision.followUpQuestion).toBeTruthy();
  });
});

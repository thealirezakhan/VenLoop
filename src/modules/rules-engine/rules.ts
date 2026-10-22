import {
  REASON_CODES,
  RESPONSE_KEYS,
  RULE_SET_VERSION,
  type DecisionInput,
  type DecisionResult,
  type ProposedAction,
} from "./types";

/** PRD 8.1/TC2: unreachable only after this many no-answer attempts. */
export const NO_ANSWER_ESCALATION_THRESHOLD = 2;

/**
 * Escalation model: urgent notifications execute immediately in the mock
 * adapter (labelled simulated) and open an escalation case for human
 * acknowledgement/follow-up. There is no approve-before-notify gate — the
 * safety engine, not a caregiver click, controls what the agent may say
 * (dosage advice stays permanently blocked).
 */
const CLOSING_QUESTION = "Is there anything else you would like to tell me before we finish?";

/**
 * Deterministic safety rules (PRD 9.2–9.4). Pure function: no I/O, no DB,
 * no provider calls, no LLM. Precedence (most safety-critical first):
 * consent → emergency → dosage block → symptoms → no-answer → clarification flag → adherence.
 */
export function evaluateDecision(input: DecisionInput): DecisionResult {
  if (!input.consentValid) {
    return result(
      "unresolved",
      REASON_CODES.CONSENT_NOT_VALID,
      "Consent is not valid; check-in cannot proceed to external contact.",
      RESPONSE_KEYS.CONSENT_UNAVAILABLE,
      [],
      "We cannot continue this check-in right now. We have recorded the attempt.",
      null,
    );
  }

  // Emergency phrases outrank everything, including dosage questions (doc G).
  if (input.emergency) {
    return result(
      "emergency_guidance",
      REASON_CODES.EMERGENCY_REPORTED,
      "Emergency phrase detected. Direct the person to emergency services and alert contacts immediately; do not continue a routine script.",
      RESPONSE_KEYS.EMERGENCY_GUIDANCE,
      [
        {
          actionType: "notify_family",
          destinationKey: input.notificationDestinationKey ?? "unassigned",
          requiresApproval: false,
          priority: "urgent",
        },
      ],
      "This may be an emergency. Please contact your local emergency services now, or ask someone nearby to help you. We are alerting your contacts straight away.",
      null,
    );
  }

  // Dosage safety applies regardless of adherence, language, or wording (PRD TC4).
  if (input.dosageQuestion) {
    return result(
      "dosage_safety_response",
      REASON_CODES.DOSAGE_QUESTION_BLOCKED,
      "Dosage-change questions are always blocked; route to human review only.",
      RESPONSE_KEYS.DOSAGE_BLOCK,
      [
        {
          actionType: "request_human_review",
          destinationKey: input.notificationDestinationKey ?? "unassigned",
          requiresApproval: false,
          priority: "urgent",
        },
      ],
      "I am not able to advise on changing your dose. I have noted your question and I will let your caregiver know.",
      CLOSING_QUESTION,
    );
  }

  // Symptoms escalate even when adherence is unclear (TC3) — never buried by clarification.
  if (input.symptoms.length > 0) {
    return result(
      "symptom_escalation",
      REASON_CODES.SYMPTOM_REPORTED,
      `Reported symptom(s): ${input.symptoms.join(", ")}. General guidance only; no diagnosis.`,
      RESPONSE_KEYS.SYMPTOM_GUIDANCE,
      [
        {
          actionType: "notify_family",
          destinationKey: input.notificationDestinationKey ?? "unassigned",
          requiresApproval: false,
          priority: "urgent",
        },
      ],
      `I am sorry you are not feeling well. I have noted the ${(input.symptoms[0] ?? "symptom").replaceAll("_", " ")} and I will let your caregiver know.`,
      CLOSING_QUESTION,
    );
  }

  if (input.noAnswerAttempts >= NO_ANSWER_ESCALATION_THRESHOLD) {
    return result(
      "unreachable_escalation",
      REASON_CODES.NO_ANSWER_THRESHOLD,
      `No answer after ${input.noAnswerAttempts} attempts. Not evidence of missed medication.`,
      RESPONSE_KEYS.UNREACHABLE_END,
      [
        {
          actionType: "notify_family",
          destinationKey: input.notificationDestinationKey ?? "unassigned",
          requiresApproval: false,
          priority: "routine",
        },
      ],
      "",
      null,
    );
  }

  if (input.needsClarification) {
    return clarification();
  }

  if (input.adherenceStatus === "reported_taken") {
    return result(
      "log_adherence",
      REASON_CODES.ADHERENCE_REPORTED,
      "Self-reported taken; recorded as a report, not proof of ingestion.",
      RESPONSE_KEYS.ACK_TAKEN,
      [],
      "Thank you. I have recorded that you took your medicine.",
      null,
    );
  }

  if (input.adherenceStatus === "reported_not_taken") {
    return result(
      "log_adherence",
      REASON_CODES.ADHERENCE_REPORTED,
      "Self-reported not taken; recorded for caregiver review.",
      RESPONSE_KEYS.ACK_NOT_TAKEN,
      [],
      "Thank you for letting me know. I have recorded that you have not taken your medicine yet, and I will let your caregiver know.",
      null,
    );
  }

  // unknown / not_applicable with no other signal: never guess adherence (PRD 9.4).
  return clarification();
}

function clarification(): DecisionResult {
  return result(
    "clarification_required",
    REASON_CODES.AMBIGUOUS_ANSWER,
    "Answer was unclear; ask one clarification question. Never map uncertainty to taken.",
    RESPONSE_KEYS.CLARIFY_ASK_AGAIN,
    [],
    "I am sorry, I did not catch that.",
    "Could you tell me again whether you have taken your medicine yet?",
  );
}

function result(
  type: DecisionResult["type"],
  reasonCode: string,
  explanation: string,
  responseKey: string,
  proposedActions: ProposedAction[],
  replyText: string,
  followUpQuestion: string | null,
): DecisionResult {
  return {
    type,
    reasonCode,
    explanation,
    responseKey,
    ruleSetVersion: RULE_SET_VERSION,
    requiresClarification: type === "clarification_required",
    proposedActions,
    replyText,
    followUpQuestion,
  };
}

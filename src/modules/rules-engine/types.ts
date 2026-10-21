/**
 * Domain types for the deterministic decision layer (PRD 9.2).
 * Pure data — no I/O, no framework imports.
 */

export const RULE_SET_VERSION = "v1.1.0";

export type AdherenceStatus =
  | "reported_taken"
  | "reported_not_taken"
  | "unknown"
  | "not_applicable";

export type DecisionType =
  | "log_adherence"
  | "unreachable_escalation"
  | "symptom_escalation"
  | "dosage_safety_response"
  | "emergency_guidance"
  | "clarification_required"
  | "unresolved";

export type ProposedActionType = "notify_family" | "request_human_review";

export interface ProposedAction {
  actionType: ProposedActionType;
  /** Opaque destination reference resolved at execution time — never a raw phone number in domain output. */
  destinationKey: string;
  /** Explicit approval policy per action type and urgency (PRD 9.5). */
  requiresApproval: boolean;
  priority: "routine" | "urgent";
}

export interface DecisionInput {
  adherenceStatus: AdherenceStatus;
  symptoms: readonly string[];
  dosageQuestion: boolean;
  needsClarification: boolean;
  noAnswerAttempts: number;
  consentValid: boolean;
  /** Red-flag phrases detected by the extractor (emergency pathway). */
  emergency?: boolean;
  /** Caregiver/notification destination reference (e.g. assignment id). */
  notificationDestinationKey?: string;
}

export interface DecisionResult {
  type: DecisionType;
  reasonCode: string;
  explanation: string;
  responseKey: string;
  ruleSetVersion: string;
  requiresClarification: boolean;
  proposedActions: ProposedAction[];
  /** What the check-in agent says to the person (never dosage advice). */
  replyText: string;
  /**
   * One scripted follow-up question asked before the call ends (e.g. "anything
   * else?"). Null = close the conversation after the reply.
   */
  followUpQuestion: string | null;
}

/** Reason codes — stable identifiers for audit and evidence (PRD 17). */
export const REASON_CODES = {
  ADHERENCE_REPORTED: "ADHERENCE_REPORTED",
  NO_ANSWER_THRESHOLD: "NO_ANSWER_THRESHOLD",
  SYMPTOM_REPORTED: "SYMPTOM_REPORTED",
  DOSAGE_QUESTION_BLOCKED: "DOSAGE_QUESTION_BLOCKED",
  EMERGENCY_REPORTED: "EMERGENCY_REPORTED",
  AMBIGUOUS_ANSWER: "AMBIGUOUS_ANSWER",
  CONSENT_NOT_VALID: "CONSENT_NOT_VALID",
} as const;

/** Spoken/UI response keys. Text mapping lives with the simulator (Phase 5). */
export const RESPONSE_KEYS = {
  ACK_TAKEN: "ack.taken",
  ACK_NOT_TAKEN: "ack.not_taken",
  CLARIFY_ASK_AGAIN: "clarify.ask_again",
  DOSAGE_BLOCK: "safety.dosage_block",
  SYMPTOM_GUIDANCE: "symptom.general_guidance",
  EMERGENCY_GUIDANCE: "safety.emergency",
  UNREACHABLE_END: "unreachable.end",
  CONSENT_UNAVAILABLE: "consent.unavailable",
} as const;

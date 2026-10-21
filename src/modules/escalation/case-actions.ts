/**
 * Escalation case model — risk-based human follow-up (doc §4).
 * Pure data + transitions; no I/O.
 */

export const CASE_CATEGORIES = ["symptom", "dosage_question", "unreachable", "emergency"] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export type CaseStatus = "detected" | "escalated" | "closed";
export type NotificationStatus =
  | "notification_pending"
  | "notification_failed"
  | "notification_unknown"
  | "notified";
export type AcknowledgementStatus = "pending" | "acknowledged";
export type ResolutionStatus = "open" | "follow_up_in_progress" | "resolved_reported" | "closed";

export interface CaseState {
  status: CaseStatus;
  severity: number;
  notificationStatus: NotificationStatus;
  acknowledgementStatus: AcknowledgementStatus;
  resolutionStatus: ResolutionStatus;
  outcomeNote: string | null;
}

export type CaseActionType =
  | "acknowledge"
  | "contacted_patient"
  | "contact_healthcare_professional"
  | "escalate_urgently"
  | "assign_follow_up"
  | "call_alternate_contact"
  | "retry_later"
  | "record_professional_guidance"
  | "record_outcome"
  | "mark_resolved";

export const CASE_ACTIONS_BY_CATEGORY: Record<CaseCategory, CaseActionType[]> = {
  symptom: [
    "acknowledge",
    "contacted_patient",
    "contact_healthcare_professional",
    "escalate_urgently",
    "assign_follow_up",
    "record_outcome",
    "mark_resolved",
  ],
  dosage_question: [
    "acknowledge",
    "contact_healthcare_professional",
    "assign_follow_up",
    "record_professional_guidance",
    "record_outcome",
    "mark_resolved",
  ],
  unreachable: [
    "acknowledge",
    "call_alternate_contact",
    "retry_later",
    "assign_follow_up",
    "record_outcome",
    "mark_resolved",
  ],
  emergency: [
    "acknowledge",
    "contact_healthcare_professional",
    "escalate_urgently",
    "record_outcome",
    "mark_resolved",
  ],
};

/** Actions that send a simulated notification to a contact. */
export const NOTIFICATION_CASE_ACTIONS: readonly CaseActionType[] = [
  "contact_healthcare_professional",
  "escalate_urgently",
  "call_alternate_contact",
];

export type CaseActionResult =
  | { ok: true; next: Partial<CaseState>; sendsNotification: boolean }
  | { ok: false; code: "NOT_PERMITTED" | "REQUIRES_ACKNOWLEDGEMENT" | "ALREADY_RESOLVED" };

export function applyCaseAction(state: CaseState, action: CaseActionType): CaseActionResult {
  const allowed = (Object.entries(CASE_ACTIONS_BY_CATEGORY) as [CaseCategory, CaseActionType[]][])
    .find(([, actions]) => actions.includes(action));
  if (!allowed) return { ok: false, code: "NOT_PERMITTED" };

  if (state.resolutionStatus === "resolved_reported" || state.status === "closed") {
    return { ok: false, code: "ALREADY_RESOLVED" };
  }

  const acknowledged = state.acknowledgementStatus === "acknowledged";
  const needsAck = action !== "acknowledge" && action !== "escalate_urgently";

  if (action === "acknowledge") {
    if (acknowledged) return { ok: false, code: "NOT_PERMITTED" };
    return { ok: true, next: { acknowledgementStatus: "acknowledged" }, sendsNotification: false };
  }

  if (needsAck && !acknowledged) {
    return { ok: false, code: "REQUIRES_ACKNOWLEDGEMENT" };
  }

  switch (action) {
    case "escalate_urgently":
      return {
        ok: true,
        next: { status: "escalated", severity: 3 },
        sendsNotification: true,
      };
    case "contacted_patient":
    case "assign_follow_up":
    case "retry_later":
      return {
        ok: true,
        next: { resolutionStatus: "follow_up_in_progress" },
        sendsNotification: false,
      };
    case "contact_healthcare_professional":
    case "call_alternate_contact":
      return {
        ok: true,
        next: { resolutionStatus: "follow_up_in_progress" },
        sendsNotification: true,
      };
    case "record_professional_guidance":
    case "record_outcome":
      return {
        ok: true,
        next: { resolutionStatus: "follow_up_in_progress" },
        sendsNotification: false,
      };
    case "mark_resolved":
      // Reported resolution only — never an independent clinical verification.
      return {
        ok: true,
        next: { resolutionStatus: "resolved_reported" },
        sendsNotification: false,
      };
  }
}

export function categoryForDecision(decisionType: string): CaseCategory | null {
  switch (decisionType) {
    case "symptom_escalation":
      return "symptom";
    case "dosage_safety_response":
      return "dosage_question";
    case "unreachable_escalation":
      return "unreachable";
    case "emergency_guidance":
      return "emergency";
    default:
      return null;
  }
}

export function severityForDecision(decisionType: string): number {
  switch (decisionType) {
    case "emergency_guidance":
      return 3;
    case "symptom_escalation":
    case "dosage_safety_response":
      return 2;
    case "unreachable_escalation":
      return 1;
    default:
      return 0;
  }
}

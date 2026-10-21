/**
 * Canonical structured event names (PRD 17). Persistence and evidence export
 * reference these — logs must never contain secrets or full transcripts.
 */
export const AUDIT_EVENT_TYPES = [
  "check_in.created",
  "check_in.started",
  "conversation.input_received",
  "conversation.state_updated",
  "signals.extracted",
  "decision.evaluated",
  "escalation.upgraded",
  "approval.requested",
  "approval.decided",
  "action.started",
  "action.succeeded",
  "action.failed",
  "verification.passed",
  "verification.failed",
  "check_in.completed",
  "check_in.unresolved",
  "case.created",
  "case.acknowledged",
  "case.notification_sent",
  "case.follow_up_recorded",
  "case.resolved",
  "care_note.created",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

import type { ProposedActionType } from "@/modules/rules-engine/types";

/**
 * Deterministic idempotency key (PRD 8.3): one logical action per
 * check-in + action type + destination. DB enforces uniqueness on this key.
 */
export function actionIdempotencyKey(parts: {
  checkInId: string;
  actionType: ProposedActionType;
  destinationKey: string;
  /** Distinguishes an escalation upgrade (e.g. symptom → emergency) on one check-in. */
  purpose?: string;
}): string {
  const base = `${parts.checkInId}:${parts.actionType}:${parts.destinationKey}`;
  return parts.purpose ? `${base}:${parts.purpose}` : base;
}

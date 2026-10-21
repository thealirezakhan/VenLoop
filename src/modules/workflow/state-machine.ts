/**
 * Persisted workflow state machines (PRD 8). Transitions are validated;
 * invalid transitions return a typed error and change nothing.
 */

export const CHECK_IN_STATES = [
  "scheduled",
  "validating",
  "ready",
  "in_progress",
  "awaiting_clarification",
  "awaiting_approval",
  "processing_action",
  "verifying",
  "completed",
  "escalated",
  "failed",
  "cancelled",
  "unresolved",
] as const;
export type CheckInState = (typeof CHECK_IN_STATES)[number];

export const ACTION_STATES = [
  "pending",
  "approval_required",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

const CHECK_IN_TRANSITIONS: Record<CheckInState, readonly CheckInState[]> = {
  scheduled: ["validating", "cancelled"],
  validating: ["ready", "failed"],
  ready: ["in_progress", "cancelled", "failed"],
  in_progress: [
    "awaiting_clarification",
    "awaiting_approval",
    "processing_action",
    "completed",
    "escalated",
    "unresolved",
    "failed",
  ],
  awaiting_clarification: ["in_progress", "unresolved", "escalated", "cancelled"],
  awaiting_approval: ["processing_action", "escalated", "failed", "cancelled"],
  processing_action: ["verifying", "failed", "escalated"],
  verifying: ["completed", "failed", "escalated", "unresolved"],
  completed: [],
  escalated: [],
  failed: ["cancelled"],
  cancelled: [],
  unresolved: ["escalated"],
};

const ACTION_TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  pending: ["approval_required", "approved", "executing", "cancelled"],
  approval_required: ["approved", "rejected", "cancelled"],
  approved: ["executing", "cancelled"],
  rejected: [],
  executing: ["succeeded", "failed", "unknown"],
  succeeded: [],
  failed: ["pending"],
  unknown: ["succeeded", "failed"],
  cancelled: [],
};

export type TransitionResult<S> =
  | { ok: true; from: S; to: S }
  | { ok: false; code: "INVALID_TRANSITION"; from: S; to: S };

function transition<S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): TransitionResult<S> {
  if (!(from in table)) {
    return { ok: false, code: "INVALID_TRANSITION", from, to };
  }
  if (!table[from].includes(to)) {
    return { ok: false, code: "INVALID_TRANSITION", from, to };
  }
  return { ok: true, from, to };
}

export function transitionCheckIn(from: CheckInState, to: CheckInState): TransitionResult<CheckInState> {
  return transition(CHECK_IN_TRANSITIONS, from, to);
}

export function transitionAction(from: ActionState, to: ActionState): TransitionResult<ActionState> {
  return transition(ACTION_TRANSITIONS, from, to);
}

export function isTerminalCheckIn(state: CheckInState): boolean {
  return CHECK_IN_TRANSITIONS[state].length === 0;
}

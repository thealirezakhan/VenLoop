import { describe, expect, it } from "vitest";
import {
  isTerminalCheckIn,
  transitionAction,
  transitionCheckIn,
  type ActionState,
  type CheckInState,
} from "@/modules/workflow/state-machine";
import { isConsentValid } from "@/modules/workflow/consent";
import { actionIdempotencyKey } from "@/modules/workflow/idempotency";

describe("check-in state machine", () => {
  it("accepts the standard happy path", () => {
    const path: CheckInState[] = [
      "scheduled",
      "validating",
      "ready",
      "in_progress",
      "processing_action",
      "verifying",
      "completed",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const result = transitionCheckIn(path[i]!, path[i + 1]!);
      expect(result.ok, `${path[i]} → ${path[i + 1]}`).toBe(true);
    }
    expect(isTerminalCheckIn("completed")).toBe(true);
  });

  it("supports the clarification loop", () => {
    expect(transitionCheckIn("in_progress", "awaiting_clarification").ok).toBe(true);
    expect(transitionCheckIn("awaiting_clarification", "in_progress").ok).toBe(true);
  });

  it("rejects illegal transitions with a typed error", () => {
    const result = transitionCheckIn("scheduled", "completed");
    expect(result).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
      from: "scheduled",
      to: "completed",
    });
  });

  it("terminal states allow no exit", () => {
    for (const to of ["in_progress", "cancelled", "failed", "completed"] as CheckInState[]) {
      expect(transitionCheckIn("completed", to).ok).toBe(false);
      expect(transitionCheckIn("cancelled", to).ok).toBe(false);
      expect(transitionCheckIn("escalated", to).ok).toBe(false);
    }
  });

  it("unresolved may escalate but not complete silently", () => {
    expect(transitionCheckIn("unresolved", "escalated").ok).toBe(true);
    expect(transitionCheckIn("unresolved", "completed").ok).toBe(false);
  });
});

describe("action state machine", () => {
  it("routes approval_required through an explicit approval", () => {
    expect(transitionAction("pending", "approval_required").ok).toBe(true);
    expect(transitionAction("approval_required", "approved").ok).toBe(true);
    expect(transitionAction("approved", "executing").ok).toBe(true);
    expect(transitionAction("executing", "succeeded").ok).toBe(true);
  });

  it("rejection is terminal", () => {
    const rejected: ActionState = "rejected";
    expect(transitionAction(rejected, "executing").ok).toBe(false);
    expect(transitionAction(rejected, "approved").ok).toBe(false);
  });

  it("failed may retry to pending; succeeded may not move", () => {
    expect(transitionAction("failed", "pending").ok).toBe(true);
    expect(transitionAction("succeeded", "pending").ok).toBe(false);
  });

  it("unknown can be reconciled, never jumped straight from executing to succeeded after unknown", () => {
    expect(transitionAction("executing", "unknown").ok).toBe(true);
    expect(transitionAction("unknown", "succeeded").ok).toBe(true);
    expect(transitionAction("unknown", "failed").ok).toBe(true);
  });
});

describe("consent validation", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("granted with no expiry is valid", () => {
    expect(isConsentValid({ status: "granted", expiresAt: null }, now)).toBe(true);
  });

  it("granted but expired is invalid", () => {
    expect(
      isConsentValid({ status: "granted", expiresAt: "2026-10-01T00:00:00Z" }, now),
    ).toBe(false);
  });

  it("revoked / denied / expired statuses are invalid", () => {
    for (const status of ["revoked", "denied", "expired"] as const) {
      expect(isConsentValid({ status, expiresAt: null }, now)).toBe(false);
    }
  });

  it("missing or unparseable consent is invalid", () => {
    expect(isConsentValid(null, now)).toBe(false);
    expect(isConsentValid({ status: "granted", expiresAt: "not-a-date" }, now)).toBe(false);
  });
});

describe("action idempotency key", () => {
  const parts = {
    checkInId: "ci_1",
    actionType: "notify_family" as const,
    destinationKey: "assignment-1",
  };

  it("is deterministic for the same logical action", () => {
    expect(actionIdempotencyKey(parts)).toBe(actionIdempotencyKey(parts));
  });

  it("differs per destination and action type", () => {
    expect(actionIdempotencyKey({ ...parts, destinationKey: "assignment-2" })).not.toBe(
      actionIdempotencyKey(parts),
    );
    expect(actionIdempotencyKey({ ...parts, actionType: "request_human_review" })).not.toBe(
      actionIdempotencyKey(parts),
    );
  });
});

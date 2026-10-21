import { adminClient } from "./admin";
import { ApiFailure } from "./failures";
import {
  createCheckIn,
  recordNoAnswer,
  startCheckIn,
  submitInput,
  type Actor,
} from "./check-ins";
import type { DecisionType } from "@/modules/rules-engine/types";
import type { AuditEventType } from "@/modules/workflow/audit-events";

export interface ScenarioDefinition {
  id: string;
  label: string;
  expectedDecision: DecisionType;
  kind: "transcript" | "no_answer";
  transcript?: string;
}

/** Official test cases (PRD 9.3). Fixtures feed the same pipeline as the simulator. */
export const SCENARIOS: Record<string, ScenarioDefinition> = {
  TC1: {
    id: "TC1",
    label: "TC1 — Yes, took morning tablets",
    expectedDecision: "log_adherence",
    kind: "transcript",
    transcript: "Yes, I took my morning tablets.",
  },
  TC2: {
    id: "TC2",
    label: "TC2 — No answer after two tries",
    expectedDecision: "unreachable_escalation",
    kind: "no_answer",
  },
  TC3: {
    id: "TC3",
    label: "TC3 — Mentions dizziness",
    expectedDecision: "symptom_escalation",
    kind: "transcript",
    transcript: "I feel a bit dizzy today.",
  },
  TC4: {
    id: "TC4",
    label: "TC4 — Should I double the dose?",
    expectedDecision: "dosage_safety_response",
    kind: "transcript",
    transcript: "Should I double the dose?",
  },
  TC5: {
    id: "TC5",
    label: "TC5 — Emergency phrase (demo)",
    expectedDecision: "emergency_guidance",
    kind: "transcript",
    transcript: "I cannot breathe properly and my chest hurts.",
  },
};

export interface TestRunRow {
  id: string;
  scenario_id: string;
  status: string;
  expected_result: unknown;
  actual_result: unknown;
  evidence_reference: string | null;
  failure_summary: string | null;
}

async function auditRun(actorId: string, eventType: AuditEventType, runId: string, details: Record<string, unknown>) {
  await adminClient().from("audit_events").insert({
    actor_type: "user",
    actor_id: actorId,
    event_type: eventType,
    entity_type: "test_run",
    entity_id: runId,
    details,
  });
}

export async function runScenario(
  actor: Actor,
  scenarioId: string,
  options: { patientId?: string } = {},
): Promise<TestRunRow> {
  if (actor.role !== "super_admin") {
    throw new ApiFailure("FORBIDDEN", "Only super-admins can run official scenarios.", 403);
  }
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new ApiFailure("NOT_FOUND", `Unknown scenario ${scenarioId}.`, 404);

  const admin = adminClient();
  const patientId = await resolvePatientId(options.patientId);
  const expected = { decisionType: scenario.expectedDecision, patientId };

  const { data: run, error } = await admin
    .from("test_runs")
    .insert({
      scenario_id: scenario.id,
      run_mode: "simulated",
      expected_result: expected,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !run) throw new ApiFailure("INTERNAL", "Failed to create test run.", 500);
  await auditRun(actor.id, "check_in.created", run.id, { scenarioId, phase: "run_started" });

  try {
    const checkIn = await createCheckIn(actor, {
      patientId,
      channel: "manual_test",
      scenarioId: scenario.id,
    });
    await startCheckIn(actor, checkIn.id);

    if (scenario.kind === "no_answer") {
      await recordNoAnswer(actor, checkIn.id);
      await recordNoAnswer(actor, checkIn.id);
    } else {
      await submitInput(actor, checkIn.id, {
        transcript: scenario.transcript ?? "",
        inputSource: "synthetic_fixture",
      });
    }

    const { data: decision } = await admin
      .from("decisions")
      .select("decision_type, decision_reason, id")
      .eq("check_in_id", checkIn.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const actualType = (decision?.decision_type as string | undefined) ?? null;
    const passed = actualType === scenario.expectedDecision;

    const { data: updated, error: updateError } = await admin
      .from("test_runs")
      .update({
        check_in_id: checkIn.id,
        actual_result: { decisionType: actualType, decisionId: decision?.id ?? null },
        status: passed ? "passed" : "failed",
        completed_at: new Date().toISOString(),
        evidence_reference: `check_in:${checkIn.id}`,
        failure_summary: passed
          ? null
          : `Expected decision ${scenario.expectedDecision}, observed ${actualType ?? "none"}.`,
      })
      .eq("id", run.id)
      .select("id, scenario_id, status, expected_result, actual_result, evidence_reference, failure_summary")
      .single();
    if (updateError || !updated) throw new ApiFailure("INTERNAL", "Failed to store run result.", 500);
    return updated as TestRunRow;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown failure";
    await admin
      .from("test_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        failure_summary: message,
      })
      .eq("id", run.id);
    throw err instanceof ApiFailure ? err : new ApiFailure("INTERNAL", message, 500);
  }
}

async function resolvePatientId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { data } = await adminClient()
    .from("patients")
    .select("id")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) throw new ApiFailure("INVALID_STATE", "No active patient for scenario run.", 409);
  return data.id as string;
}

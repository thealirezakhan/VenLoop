import { adminClient } from "./admin";
import { ApiFailure } from "./failures";
import {
  applyCaseAction,
  CASE_ACTIONS_BY_CATEGORY,
  type CaseActionType,
  type CaseCategory,
  type CaseState,
} from "@/modules/escalation/case-actions";
import { audit, type Actor } from "./check-ins";
import { mockNotificationProvider } from "@/modules/providers/notification";

export interface CaseRow {
  id: string;
  patient_id: string;
  check_in_id: string | null;
  action_id: string | null;
  category: string;
  severity: number;
  reason: string;
  evidence_reference: string;
  assigned_contact: string | null;
  status: string;
  notification_status: string;
  acknowledgement_status: string;
  resolution_status: string;
  outcome_note: string | null;
  created_at: string;
  updated_at: string;
}

const CASE_COLUMNS =
  "id, patient_id, check_in_id, action_id, category, severity, reason, evidence_reference, assigned_contact, status, notification_status, acknowledgement_status, resolution_status, outcome_note, created_at, updated_at";

export async function listCases(actor: Actor): Promise<(CaseRow & { patient?: { id: string; display_name: string; mrn: string | null; date_of_birth: string | null; risk_level: string | null; phone: string | null } })[]> {
  const admin = adminClient();
  // Service role bypasses RLS; scope caregiver reads by assignment explicitly.
  let query = admin
    .from("escalation_cases")
    .select(`${CASE_COLUMNS}, patient:patients(id, display_name, mrn, date_of_birth, risk_level, phone)`)
    .order("created_at", { ascending: false });
  if (actor.role === "caregiver") {
    const { data: assignments } = await admin
      .from("caregiver_patient_assignments")
      .select("patient_id")
      .eq("caregiver_id", actor.id)
      .eq("is_active", true);
    const ids = (assignments ?? []).map((r) => r.patient_id as string);
    if (ids.length === 0) return [];
    query = query.in("patient_id", ids);
  }
  const { data, error } = await query;
  if (error) throw new ApiFailure("INTERNAL", "Failed to load cases.", 500);
  return (data ?? []) as unknown as (CaseRow & { patient?: { id: string; display_name: string; mrn: string | null; date_of_birth: string | null; risk_level: string | null; phone: string | null } })[];
}

async function loadCaseForUpdate(actor: Actor, caseId: string): Promise<CaseRow> {
  const { data, error } = await adminClient()
    .from("escalation_cases")
    .select(CASE_COLUMNS)
    .eq("id", caseId)
    .single();
  if (error || !data) throw new ApiFailure("NOT_FOUND", "Case not found.", 404);
  if (actor.role !== "super_admin") {
    const { data: assignment } = await adminClient()
      .from("caregiver_patient_assignments")
      .select("id")
      .eq("caregiver_id", actor.id)
      .eq("patient_id", data.patient_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!assignment) throw new ApiFailure("FORBIDDEN", "You are not assigned to this patient.", 403);
  }
  return data as CaseRow;
}

export async function acknowledgeCase(actor: Actor, caseId: string): Promise<CaseRow> {
  const row = await loadCaseForUpdate(actor, caseId);
  if (row.acknowledgement_status !== "pending") {
    throw new ApiFailure("INVALID_STATE", "Case is already acknowledged.", 409);
  }
  const { data, error } = await adminClient()
    .from("escalation_cases")
    .update({ acknowledgement_status: "acknowledged", updated_at: new Date().toISOString() })
    .eq("id", caseId)
    .select(CASE_COLUMNS)
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to acknowledge case.", 500);
  await audit(actor.id, "case.acknowledged", "case", caseId);
  return data as CaseRow;
}

export async function applyCaseActionEndpoint(
  actor: Actor,
  caseId: string,
  actionType: CaseActionType,
): Promise<CaseRow> {
  const row = await loadCaseForUpdate(actor, caseId);
  const state: CaseState = {
    status: row.status as CaseState["status"],
    severity: row.severity,
    notificationStatus: row.notification_status as CaseState["notificationStatus"],
    acknowledgementStatus: row.acknowledgement_status as CaseState["acknowledgementStatus"],
    resolutionStatus: row.resolution_status as CaseState["resolutionStatus"],
    outcomeNote: row.outcome_note,
  };
  const allowed = CASE_ACTIONS_BY_CATEGORY[row.category as CaseCategory] ?? [];
  if (!allowed.includes(actionType)) {
    throw new ApiFailure("FORBIDDEN", `Action "${actionType}" is not permitted for category "${row.category}".`, 403);
  }
  const result = applyCaseAction(state, actionType);
  if (!result.ok) {
    if (result.code === "REQUIRES_ACKNOWLEDGEMENT") {
      throw new ApiFailure("INVALID_STATE", "Acknowledge the case first.", 409);
    }
    if (result.code === "ALREADY_RESOLVED") {
      throw new ApiFailure("INVALID_STATE", "Case is already resolved.", 409);
    }
    throw new ApiFailure("FORBIDDEN", "Action not permitted.", 403);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (result.next.status) patch.status = result.next.status;
  if (result.next.severity !== undefined) patch.severity = result.next.severity;
  if (result.next.resolutionStatus) patch.resolution_status = result.next.resolutionStatus;
  if (result.next.acknowledgementStatus) patch.acknowledgement_status = result.next.acknowledgementStatus;

  if (result.sendsNotification && row.action_id) {
    const { data: action } = await adminClient()
      .from("actions")
      .select("destination_reference")
      .eq("id", row.action_id)
      .single();
    const send = await mockNotificationProvider.send({
      actionId: row.action_id,
      destinationKey: (action?.destination_reference as string) ?? "unassigned",
      messageKey: `case.${actionType}`,
      explanation: "",
      priority: result.next.severity === 3 ? "urgent" : "routine",
    });
    await adminClient().from("notification_events").insert({
      action_id: row.action_id,
      provider_name: send.providerName,
      provider_message_id: send.providerMessageId,
      status: send.status,
      confirmed_at: null,
    });
    await audit(actor.id, "case.notification_sent", "case", caseId, {
      actionType,
      simulated: true,
    });
  } else if (result.sendsNotification) {
    await audit(actor.id, "case.notification_sent", "case", caseId, {
      actionType,
      simulated: true,
      note: "no linked action row",
    });
  }

  const { data, error } = await adminClient()
    .from("escalation_cases")
    .update(patch)
    .eq("id", caseId)
    .select(CASE_COLUMNS)
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to update case.", 500);
  await audit(actor.id, "case.follow_up_recorded", "case", caseId, { actionType });
  return data as CaseRow;
}

export async function resolveCase(actor: Actor, caseId: string, note: string): Promise<CaseRow> {
  const row = await loadCaseForUpdate(actor, caseId);
  if (row.acknowledgement_status !== "acknowledged") {
    throw new ApiFailure("INVALID_STATE", "Acknowledge the case before recording an outcome.", 409);
  }
  if (row.resolution_status === "resolved_reported" || row.status === "closed") {
    throw new ApiFailure("INVALID_STATE", "Case is already resolved.", 409);
  }
  const { data, error } = await adminClient()
    .from("escalation_cases")
    .update({
      resolution_status: "resolved_reported",
      outcome_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId)
    .select(CASE_COLUMNS)
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to resolve case.", 500);
  await audit(actor.id, "case.resolved", "case", caseId, { note });
  return data as CaseRow;
}

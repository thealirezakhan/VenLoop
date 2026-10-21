import { adminClient } from "./admin";
import {
  loadCheckIn,
  verifyReadBack,
  type Actor,
  type CheckInRow,
} from "./check-ins";

export interface ActionRow {
  id: string;
  check_in_id: string;
  action_type: string;
  status: string;
  destination_reference: string | null;
  payload_reference: string | null;
}

export async function reverify(actor: Actor, checkInId: string): Promise<CheckInRow> {
  await loadCheckIn(actor, checkInId);
  const { data: action } = await adminClient()
    .from("actions")
    .select("id")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return verifyReadBack(actor.id, checkInId, Boolean(action));
}

export async function evidenceFor(actor: Actor, checkInId: string) {
  const checkIn = await loadCheckIn(actor, checkInId);
  const admin = adminClient();

  const [patient, conversation, decisions, actions, attempts, cases, verifications] =
    await Promise.all([
      admin.from("patients").select("id, display_name, timezone, preferred_language, status").eq("id", checkIn.patient_id).single(),
      admin.from("conversation_records").select("*").eq("check_in_id", checkInId).order("created_at"),
      admin.from("decisions").select("*").eq("check_in_id", checkInId).order("created_at"),
      admin.from("actions").select("*").eq("check_in_id", checkInId).order("created_at"),
      admin.from("call_attempts").select("*").eq("check_in_id", checkInId).order("attempt_number"),
      admin.from("escalation_cases").select("*").eq("check_in_id", checkInId).order("created_at"),
      admin.from("verification_records").select("*").eq("check_in_id", checkInId).order("verified_at"),
    ]);

  const recordIds = (conversation.data ?? []).map((c) => c.id as string);
  const signals = recordIds.length
    ? (await admin.from("extracted_signals").select("*").in("conversation_record_id", recordIds)).data ?? []
    : [];

  const notificationActionIds = (actions.data ?? []).map((a) => a.id as string);
  const notifications = notificationActionIds.length
    ? (await admin.from("notification_events").select("*").in("action_id", notificationActionIds)).data ?? []
    : [];

  return {
    checkIn,
    patient: patient.data ?? null,
    conversation: conversation.data ?? [],
    signals,
    decisions: decisions.data ?? [],
    actions: actions.data ?? [],
    callAttempts: attempts.data ?? [],
    escalationCases: cases.data ?? [],
    notifications,
    verifications: verifications.data ?? [],
  };
}

import { adminClient } from "./admin";
import { ApiFailure } from "./failures";
import { env } from "@/lib/env";
import type { Actor } from "./check-ins";
import { audit } from "./check-ins";

function requireSuperAdmin(actor: Actor): void {
  if (actor.role !== "super_admin") {
    throw new ApiFailure("FORBIDDEN", "Super-admin role required.", 403);
  }
}

export async function platformOverview() {
  const admin = adminClient();
  const [patients, caregivers, checkIns, openCases, runs, verifications] = await Promise.all([
    admin.from("patients").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "caregiver").eq("is_active", true),
    admin.from("check_ins").select("status"),
    admin.from("escalation_cases").select("id", { count: "exact", head: true }).neq("resolution_status", "resolved_reported"),
    admin.from("test_runs").select("id, scenario_id, status, started_at, completed_at, failure_summary").order("started_at", { ascending: false }).limit(20),
    admin.from("verification_records").select("result"),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of checkIns.data ?? []) {
    const s = row.status as string;
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const failedVerifications = (verifications.data ?? []).filter((v) => v.result === "failed").length;

  return {
    activePatients: patients.count ?? 0,
    activeCaregivers: caregivers.count ?? 0,
    checkInsByStatus: statusCounts,
    openCases: openCases.count ?? 0,
    failedVerifications,
    recentRuns: runs.data ?? [],
  };
}

export async function createCaregiver(
  actor: Actor,
  input: { email: string; password: string; displayName: string },
) {
  requireSuperAdmin(actor);
  const admin = adminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !created.user) {
    throw new ApiFailure("CONFLICT", error?.message ?? "Failed to create auth user.", 409);
  }
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      id: created.user.id,
      role: "caregiver",
      display_name: input.displayName,
      email: input.email,
    })
    .select("id, role, display_name, email, is_active")
    .single();
  if (profileError || !profile) {
    throw new ApiFailure("INTERNAL", "Failed to create profile.", 500);
  }
  await audit(actor.id, "approval.decided", "profile", profile.id as string, {
    action: "create_caregiver",
  });
  return profile;
}

const RESETTABLE_TABLES = [
  "escalation_cases",
  "notification_events",
  "approvals",
  "actions",
  "verification_records",
  "decisions",
  "extracted_signals",
  "conversation_records",
  "call_attempts",
  "test_runs",
  "check_ins",
] as const;

/**
 * Wipes workflow data only; identity, patients, assignments, and audit stay.
 * Hard-gated: DEMO_MODE + ENABLE_DEMO_RESET (PRD 12.1, 18.1).
 */
export async function demoReset(actor: Actor): Promise<{ deleted: Record<string, number> }> {
  requireSuperAdmin(actor);
  if (!env.DEMO_MODE || !env.ENABLE_DEMO_RESET) {
    throw new ApiFailure("FORBIDDEN", "Demo reset is disabled in this environment.", 403);
  }
  const admin = adminClient();
  const deleted: Record<string, number> = {};
  for (const table of RESETTABLE_TABLES) {
    const { error, count } = await admin.from(table).delete({ count: "exact" }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new ApiFailure("INTERNAL", `Failed to reset ${table}: ${error.message}`, 500);
    deleted[table] = count ?? 0;
  }
  await audit(actor.id, "approval.decided", "platform", "demo_reset", { deleted });
  return { deleted };
}

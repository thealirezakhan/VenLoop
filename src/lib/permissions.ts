export type Role = "caregiver" | "super_admin";

/**
 * Pure authorization helpers. No I/O — unit-testable (PRD 16.1).
 * Database RLS is the second enforcement layer, never the only one.
 */
export function canViewPatient(input: {
  role: Role;
  assignedPatientIds: readonly string[];
  patientId: string;
}): boolean {
  if (input.role === "super_admin") return true;
  return input.assignedPatientIds.includes(input.patientId);
}

/** Only super-admins manage accounts, assignments, and demo reset (PRD 3.3). */
export function canManagePlatform(role: Role): boolean {
  return role === "super_admin";
}

/** No user — including super-admin via self-service — may change their own role. */
export function canChangeOwnRole(): false {
  return false;
}

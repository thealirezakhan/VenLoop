import { describe, expect, it } from "vitest";
import { canChangeOwnRole, canManagePlatform, canViewPatient } from "@/lib/permissions";

describe("canViewPatient", () => {
  it("super_admin sees every patient", () => {
    expect(
      canViewPatient({ role: "super_admin", assignedPatientIds: [], patientId: "p1" }),
    ).toBe(true);
  });

  it("caregiver sees only assigned patients", () => {
    expect(
      canViewPatient({ role: "caregiver", assignedPatientIds: ["p1"], patientId: "p1" }),
    ).toBe(true);
    expect(
      canViewPatient({ role: "caregiver", assignedPatientIds: ["p1"], patientId: "p2" }),
    ).toBe(false);
  });

  it("caregiver with no assignments sees nothing", () => {
    expect(
      canViewPatient({ role: "caregiver", assignedPatientIds: [], patientId: "p1" }),
    ).toBe(false);
  });
});

describe("role guards", () => {
  it("only super_admin manages the platform", () => {
    expect(canManagePlatform("super_admin")).toBe(true);
    expect(canManagePlatform("caregiver")).toBe(false);
  });

  it("nobody can change their own role", () => {
    expect(canChangeOwnRole()).toBe(false);
  });
});

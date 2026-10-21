import { describe, expect, it } from "vitest";
import { runScenario } from "@/lib/server/test-runs";
import { adminClient } from "@/lib/server/admin";
import type { Actor } from "@/lib/server/check-ins";

const adminActor: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "super_admin",
};

const dbConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!dbConfigured)("official scenarios through the real pipeline (PRD 9.3, 16.2)", () => {
  it("TC1–TC4 produce the expected decision and persist evidence", async () => {
    for (const scenarioId of ["TC1", "TC2", "TC3", "TC4"] as const) {
      const run = await runScenario(adminActor, scenarioId);
      expect(run.status, `${scenarioId}: ${run.failure_summary ?? ""}`).toBe("passed");
      expect(run.evidence_reference).toMatch(/^check_in:/);
      expect(run.actual_result).toBeTruthy();
    }
  });

  it("TC3, TC4 and TC5 open escalation cases with notified mock delivery", async () => {
    const expectedCategory: Record<string, string> = {
      TC3: "symptom",
      TC4: "dosage_question",
      TC5: "emergency",
    };
    for (const scenarioId of ["TC3", "TC4", "TC5"] as const) {
      const run = await runScenario(adminActor, scenarioId);
      expect(run.status, `${scenarioId}: ${run.failure_summary ?? ""}`).toBe("passed");
      const checkInId = (run.evidence_reference ?? "").replace(/^check_in:/, "");
      const { data: cases } = await adminClient()
        .from("escalation_cases")
        .select("id, category, notification_status, acknowledgement_status")
        .eq("check_in_id", checkInId);
      expect(cases?.length, `${scenarioId} case count`).toBeGreaterThan(0);
      expect(cases?.[0]?.category).toBe(expectedCategory[scenarioId]);
      expect(cases?.[0]?.notification_status).toBe("notified");
      expect(cases?.[0]?.acknowledgement_status).toBe("pending");
    }
  });
});

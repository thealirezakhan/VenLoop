import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor, requireSuperAdminActor } from "@/lib/server/actor";
import { runScenario, SCENARIOS } from "@/lib/server/test-runs";
import { createClient } from "@/lib/supabase/server";
import { ApiFailure } from "@/lib/server/failures";

const runSchema = z.object({
  scenarioId: z.enum(["TC1", "TC2", "TC3", "TC4"]),
  patientId: z.uuid().optional(),
});

export async function GET() {
  return handle(async () => {
    await requireSuperAdminActor();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("test_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return { runs: data, scenarios: Object.values(SCENARIOS).map((s) => ({ id: s.id, label: s.label })) };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const parsed = runSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return runScenario(actor, parsed.data.scenarioId, { patientId: parsed.data.patientId });
  });
}

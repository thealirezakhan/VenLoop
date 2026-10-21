import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { runScenario } from "@/lib/server/test-runs";
import { createClient } from "@/lib/supabase/server";
import { ApiFailure } from "@/lib/server/failures";

type Params = { params: Promise<{ id: string }> };

/** Retry creates a NEW run row — failed results are never overwritten (PRD 7.1). */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const supabase = await createClient();
    const { data: original } = await supabase.from("test_runs").select("*").eq("id", id).single();
    if (!original) throw new ApiFailure("NOT_FOUND", "Test run not found.", 404);
    const patientId = (original.expected_result as { patientId?: string } | null)?.patientId;
    return runScenario(actor, original.scenario_id, { patientId });
  });
}

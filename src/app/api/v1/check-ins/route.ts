import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { createCheckIn } from "@/lib/server/check-ins";
import { ApiFailure } from "@/lib/server/failures";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  patientId: z.uuid(),
  scheduleId: z.uuid().optional(),
  scenarioId: z.string().max(50).optional(),
  channel: z.enum(["browser_simulation", "telephone", "inbound_telephone", "manual_test"]),
});

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return createCheckIn(actor, parsed.data);
  });
}

export async function GET() {
  return handle(async () => {
    await requireActor();
    // RLS scopes rows to assigned patients / super-admin.
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("check_ins")
      .select("id, patient_id, status, scenario_id, channel, execution_mode, created_at, started_at, completed_at, patients(display_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data;
  });
}

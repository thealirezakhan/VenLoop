import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor, requireSuperAdminActor } from "@/lib/server/actor";
import { adminClient } from "@/lib/server/admin";
import { audit } from "@/lib/server/check-ins";
import { ApiFailure } from "@/lib/server/failures";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  displayName: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  preferredLanguage: z.string().min(2).max(10).default("en"),
});

export async function GET() {
  return handle(async () => {
    await requireActor();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("patients")
      .select("id, display_name, timezone, preferred_language, status, created_at")
      .order("display_name");
    if (error) throw error;
    return data;
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireSuperAdminActor();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    const { data, error } = await adminClient()
      .from("patients")
      .insert({
        display_name: parsed.data.displayName,
        timezone: parsed.data.timezone,
        preferred_language: parsed.data.preferredLanguage,
        status: "active",
      })
      .select("id, display_name, timezone, preferred_language, status")
      .single();
    if (error || !data) throw new ApiFailure("INTERNAL", "Failed to create patient.", 500);
    await audit(actor.id, "approval.decided", "patient", data.id as string, { action: "create_patient" });
    return data;
  });
}

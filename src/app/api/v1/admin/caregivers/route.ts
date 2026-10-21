import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor, requireSuperAdminActor } from "@/lib/server/actor";
import { createCaregiver } from "@/lib/server/admin-ops";
import { ApiFailure } from "@/lib/server/failures";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  email: z.email(),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(120),
});

export async function GET() {
  return handle(async () => {
    await requireSuperAdminActor();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, display_name, email, is_active, created_at")
      .eq("role", "caregiver")
      .order("created_at");
    if (error) throw error;
    return data;
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return createCaregiver(actor, parsed.data);
  });
}

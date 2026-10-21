import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor, requireSuperAdminActor } from "@/lib/server/actor";
import { adminClient } from "@/lib/server/admin";
import { audit } from "@/lib/server/check-ins";
import { ApiFailure } from "@/lib/server/failures";
import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  caregiverId: z.uuid(),
  patientId: z.uuid(),
  relationshipLabel: z.string().max(120).optional(),
});

export async function GET() {
  return handle(async () => {
    await requireActor();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("caregiver_patient_assignments")
      .select("id, caregiver_id, patient_id, relationship_label, is_active, created_at, patients(display_name), profiles:caregiver_id(display_name)")
      .order("created_at");
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
      .from("caregiver_patient_assignments")
      .insert({
        caregiver_id: parsed.data.caregiverId,
        patient_id: parsed.data.patientId,
        relationship_label: parsed.data.relationshipLabel ?? null,
        created_by: actor.id,
        is_active: true,
      })
      .select("id, caregiver_id, patient_id, relationship_label, is_active")
      .single();
    if (error) throw new ApiFailure("CONFLICT", error.message, 409);
    await audit(actor.id, "approval.decided", "assignment", data.id as string, { action: "create" });
    return data;
  });
}

export async function DELETE(request: NextRequest) {
  return handle(async () => {
    const actor = await requireSuperAdminActor();
    const id = request.nextUrl.searchParams.get("id");
    if (!id || !z.uuid().safeParse(id).success) {
      throw new ApiFailure("VALIDATION_ERROR", "A valid assignment id is required.", 400);
    }
    const { data, error } = await adminClient()
      .from("caregiver_patient_assignments")
      .update({ is_active: false })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) throw new ApiFailure("NOT_FOUND", "Assignment not found.", 404);
    await audit(actor.id, "approval.decided", "assignment", id, { action: "deactivate" });
    return { deactivated: id };
  });
}

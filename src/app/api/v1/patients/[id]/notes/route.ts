import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { ApiFailure } from "@/lib/server/failures";
import { audit } from "@/lib/server/check-ins";
import { createClient } from "@/lib/supabase/server";

const noteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = noteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "Note must be 1–2000 characters.", 400);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("care_notes")
      .insert({ patient_id: id, author_id: actor.id, body: parsed.data.body })
      .select("id, patient_id, author_id, body, created_at")
      .single();
    if (error || !data) {
      throw new ApiFailure("FORBIDDEN", "You cannot add notes for this patient.", 403);
    }

    await audit(actor.id, "care_note.created", "patient", id, { noteId: data.id });
    return data;
  });
}

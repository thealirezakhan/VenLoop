import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { applyCaseActionEndpoint } from "@/lib/server/cases";
import { ApiFailure } from "@/lib/server/failures";

const bodySchema = z.object({
  actionType: z.enum([
    "contacted_patient",
    "contact_healthcare_professional",
    "escalate_urgently",
    "assign_follow_up",
    "call_alternate_contact",
    "retry_later",
    "record_professional_guidance",
    "record_outcome",
    "mark_resolved",
  ]),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return applyCaseActionEndpoint(actor, id, parsed.data.actionType);
  });
}

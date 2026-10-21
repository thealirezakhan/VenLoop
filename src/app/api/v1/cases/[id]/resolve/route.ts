import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { resolveCase } from "@/lib/server/cases";
import { ApiFailure } from "@/lib/server/failures";

const bodySchema = z.object({ note: z.string().max(1000).default("") });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return resolveCase(actor, id, parsed.data.note);
  });
}

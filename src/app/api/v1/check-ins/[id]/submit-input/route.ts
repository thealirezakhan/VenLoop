import { NextRequest } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { submitInput } from "@/lib/server/check-ins";
import { ApiFailure } from "@/lib/server/failures";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const inputSchema = z.object({
  transcript: z.string().min(1).max(2000),
  inputSource: z.enum(["speech", "typed", "synthetic_fixture"]).default("typed"),
  language: z.enum(["en", "hi", "mr"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    enforceRateLimit(`submit:${actor.id}:${id}`, 20, 60_000);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    return submitInput(actor, id, parsed.data);
  });
}

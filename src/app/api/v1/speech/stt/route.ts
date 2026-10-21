import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/server/actor";
import { ApiFailure } from "@/lib/server/failures";
import { apiError } from "@/lib/http";
import { transcribeSpeech } from "@/lib/server/speech";
import { enforceRateLimit, requestKey } from "@/lib/server/rate-limit";

const inputSchema = z.object({
  audioBase64: z.string().min(1).max(8_000_000),
  language: z.string().min(2).max(16).default("en"),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor();
    enforceRateLimit(`stt:${actor.id}:${requestKey(request, "ip")}`, 15, 60_000);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    const result = await transcribeSpeech(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: {
            code: result.code === "not_configured" ? "SPEECH_NOT_CONFIGURED" : "SPEECH_UNAVAILABLE",
            message:
              result.code === "not_configured"
                ? "Real speech-to-text is not configured. Type the patient answer or use browser speech."
                : "Speech-to-text is temporarily unavailable. Type the patient answer instead.",
            requestId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ data: { text: result.value.text, simulated: false } });
  } catch (err) {
    const failure = err instanceof ApiFailure ? err : new ApiFailure("INTERNAL", "Unexpected server error.", 500);
    return apiError(failure.code, failure.message, failure.status);
  }
}

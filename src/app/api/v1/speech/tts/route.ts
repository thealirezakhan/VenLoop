import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/server/actor";
import { ApiFailure } from "@/lib/server/failures";
import { apiError } from "@/lib/http";
import { synthesizeSpeech } from "@/lib/server/speech";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const inputSchema = z.object({
  text: z.string().min(1).max(600),
  language: z.string().min(2).max(16).default("en"),
  voiceId: z.string().min(1).max(120).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor();
    enforceRateLimit(`tts:${actor.id}`, 30, 60_000);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiFailure("VALIDATION_ERROR", "The request could not be validated.", 400);
    }
    const result = await synthesizeSpeech(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: {
            code: result.code === "not_configured" ? "SPEECH_NOT_CONFIGURED" : "SPEECH_UNAVAILABLE",
            message:
              result.code === "not_configured"
                ? "Real voice is not configured. Text-only simulated call is still available."
                : "Voice playback is temporarily unavailable. Continue with text.",
            requestId: crypto.randomUUID(),
          },
        },
        { status: 503 },
      );
    }
    return new NextResponse(result.value.audio, {
      headers: {
        "Content-Type": result.value.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const failure = err instanceof ApiFailure ? err : new ApiFailure("INTERNAL", "Unexpected server error.", 500);
    return apiError(failure.code, failure.message, failure.status);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActor } from "@/lib/server/actor";
import { ApiFailure } from "@/lib/server/failures";
import { apiError } from "@/lib/http";
import { transcribeSpeech, type SpeechFailureCode } from "@/lib/server/speech";
import { enforceRateLimit, requestKey } from "@/lib/server/rate-limit";

const inputSchema = z.object({
  audioBase64: z.string().min(1).max(8_000_000),
  language: z.string().min(2).max(16).default("en"),
  audioMimeType: z.string().min(3).max(64).optional(),
});

function failureResponse(code: SpeechFailureCode, retryAfterSeconds?: number) {
  const status =
    code === "rate_limited"
      ? 429
      : code === "timeout"
        ? 504
        : code === "invalid_audio"
          ? 400
          : 503;
  const errorCode =
    code === "rate_limited"
      ? "SPEECH_RATE_LIMITED"
      : code === "timeout"
        ? "SPEECH_TIMEOUT"
        : code === "invalid_audio"
          ? "SPEECH_INVALID_AUDIO"
          : code === "not_configured"
            ? "SPEECH_NOT_CONFIGURED"
            : "SPEECH_UNAVAILABLE";
  const message =
    code === "rate_limited"
      ? "Speech-to-text is rate limited. Wait before retrying, or type the patient answer."
      : code === "timeout"
        ? "Speech-to-text timed out. Retry the microphone or type the patient answer."
        : code === "invalid_audio"
          ? "The recording could not be transcribed. Retry the microphone or type the patient answer."
          : code === "not_configured"
            ? "Real speech-to-text is not configured. Type the patient answer or use browser speech."
            : "Speech-to-text is temporarily unavailable. Type the patient answer instead.";

  const headers: Record<string, string> = {};
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json(
    { error: { code: errorCode, message, requestId: crypto.randomUUID() } },
    { status, headers },
  );
}

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
      return failureResponse(result.code, result.retryAfterSeconds);
    }
    return NextResponse.json({
      data: { text: result.value.text, provider: result.provider, simulated: false },
    });
  } catch (err) {
    const failure = err instanceof ApiFailure ? err : new ApiFailure("INTERNAL", "Unexpected server error.", 500);
    return apiError(failure.code, failure.message, failure.status);
  }
}

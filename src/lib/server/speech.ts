import { z } from "zod";
import { env } from "@/lib/env";

/**
 * Optional VerbX speech adapter. Server-only: the API key never reaches the
 * browser and raw provider errors are not surfaced. When no key is configured
 * the routes return an explicit `not_configured` result so the simulator can
 * fall back to typing and label speech as simulated.
 */

const sttResponseSchema = z.object({ text: z.string() });

const translateResponseSchema = z.object({ text: z.string() });

const ttsJsonSchema = z.object({
  audio_base64: z.string().optional(),
  audio: z.string().optional(),
  url: z.string().url().optional(),
  data: z.object({ audio_base64: z.string().optional() }).optional(),
});

export type SpeechFailureCode = "not_configured" | "provider_error";

export type SpeechResult<T> =
  | { ok: true; value: T; simulated: false }
  | { ok: false; code: SpeechFailureCode; simulated: true };

export function verbxConfigured(): boolean {
  return env.SPEECH_PROVIDER === "verbx" && Boolean(env.VERBX_API_KEY);
}

export function speechStatus() {
  return {
    provider: env.SPEECH_PROVIDER,
    configured: verbxConfigured(),
    voiceConfigured: Boolean(env.VERBX_TTS_VOICE_ID),
    mode: verbxConfigured() ? ("live_provider" as const) : ("simulated_fallback" as const),
  };
}

function authHeaders(): Record<string, string> {
  // VerbX accepts the key via X-API-Key; its OpenAPI file advertises Bearer,
  // which returns 401 against the live API.
  return {
    "X-API-Key": env.VERBX_API_KEY ?? "",
    "Content-Type": "application/json",
  };
}

export async function transcribeSpeech(input: {
  audioBase64: string;
  language: string;
}): Promise<SpeechResult<{ text: string }>> {
  if (!verbxConfigured()) return { ok: false, code: "not_configured", simulated: true };

  try {
    const response = await fetch(`${env.VERBX_BASE_URL}/v1/stt`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        audio_base64: input.audioBase64,
        language: input.language,
        punctuate: true,
        enable_timestamps: false,
        diarize: false,
        max_latency_ms: 5000,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, code: "provider_error", simulated: true };
    const parsed = sttResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.text.trim()) {
      return { ok: false, code: "provider_error", simulated: true };
    }
    return { ok: true, value: { text: parsed.data.text.trim() }, simulated: false };
  } catch {
    return { ok: false, code: "provider_error", simulated: true };
  }
}

/** Normalize non-English patient speech to English for the deterministic extractor. */
export async function translateText(input: {
  text: string;
  sourceLang: string;
  targetLang: string;
}): Promise<SpeechResult<{ text: string }>> {
  if (!verbxConfigured()) return { ok: false, code: "not_configured", simulated: true };
  if (input.sourceLang === input.targetLang) {
    return { ok: true, value: { text: input.text }, simulated: false };
  }

  try {
    const response = await fetch(`${env.VERBX_BASE_URL}/v1/translate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        text: input.text,
        source_lang: input.sourceLang,
        target_lang: input.targetLang,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, code: "provider_error", simulated: true };
    const parsed = translateResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.text.trim()) {
      return { ok: false, code: "provider_error", simulated: true };
    }
    return { ok: true, value: { text: parsed.data.text.trim() }, simulated: false };
  } catch {
    return { ok: false, code: "provider_error", simulated: true };
  }
}

export async function synthesizeSpeech(input: {
  text: string;
  language: string;
  voiceId?: string;
}): Promise<SpeechResult<{ audio: ArrayBuffer; contentType: string }>> {
  if (!verbxConfigured()) return { ok: false, code: "not_configured", simulated: true };

  try {
    const response = await fetch(`${env.VERBX_BASE_URL}/v1/tts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        text: input.text,
        options: {
          voice_id: input.voiceId ?? env.VERBX_TTS_VOICE_ID,
          language: input.language,
          emotion: "neutral",
          style: "assistant",
          speed: 0.95,
          format: "mp3",
          sample_rate: 22050,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, code: "provider_error", simulated: true };

    const contentType = response.headers.get("content-type") ?? "audio/mpeg";
    if (contentType.includes("application/json")) {
      const parsed = ttsJsonSchema.safeParse(await response.json());
      if (!parsed.success) return { ok: false, code: "provider_error", simulated: true };
      const base64 =
        parsed.data.audio_base64 ?? parsed.data.data?.audio_base64 ?? parsed.data.audio;
      if (!base64) return { ok: false, code: "provider_error", simulated: true };
      const bytes = Buffer.from(base64, "base64");
      const audio = new Uint8Array(bytes).buffer;
      return { ok: true, value: { audio, contentType: "audio/mpeg" }, simulated: false };
    }

    return {
      ok: true,
      value: { audio: await response.arrayBuffer(), contentType },
      simulated: false,
    };
  } catch {
    return { ok: false, code: "provider_error", simulated: true };
  }
}

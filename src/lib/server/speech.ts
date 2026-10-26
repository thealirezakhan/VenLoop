import { z } from "zod";
import { env } from "@/lib/env";
import { normalizeLanguage } from "@/modules/conversation/language";
import type { SttProviderId } from "@/modules/providers/speech";

/**
 * Optional speech adapters. Server-only: API keys never reach the browser and
 * raw provider errors are not surfaced. When no provider is configured the
 * routes return an explicit `not_configured` result so the simulator can fall
 * back to typing and label speech as simulated.
 */

const sttResponseSchema = z.object({ text: z.string() });

const translateResponseSchema = z.object({ text: z.string() });

const ttsJsonSchema = z.object({
  audio_base64: z.string().optional(),
  audio: z.string().optional(),
  url: z.string().url().optional(),
  data: z.object({ audio_base64: z.string().optional() }).optional(),
});

export type SpeechFailureCode =
  | "not_configured"
  | "provider_error"
  | "invalid_audio"
  | "rate_limited"
  | "timeout";

export type SpeechResult<T> =
  | { ok: true; value: T; simulated: false; provider?: SttProviderId }
  | {
      ok: false;
      code: SpeechFailureCode;
      simulated: true;
      retryAfterSeconds?: number;
    };

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export function verbxConfigured(): boolean {
  return env.SPEECH_PROVIDER === "verbx" && Boolean(env.VERBX_API_KEY);
}

export function groqSttConfigured(): boolean {
  return Boolean(env.GROQ_API_KEY);
}

function activeServerSttProvider(): "groq" | "verbx" | null {
  if (env.SPEECH_STT_PROVIDER === "groq") {
    return groqSttConfigured() ? "groq" : null;
  }
  if (env.SPEECH_STT_PROVIDER === "verbx") {
    return verbxConfigured() ? "verbx" : null;
  }
  if (env.SPEECH_STT_PROVIDER === "browser") return null;
  return groqSttConfigured() ? "groq" : verbxConfigured() ? "verbx" : null;
}

export function speechStatus() {
  const sttProvider = activeServerSttProvider();
  return {
    provider: env.SPEECH_PROVIDER,
    configured: verbxConfigured(),
    sttConfigured: sttProvider !== null,
    voiceConfigured: Boolean(env.VERBX_TTS_VOICE_ID),
    mode: verbxConfigured() ? ("live_provider" as const) : ("simulated_fallback" as const),
    sttSelection: env.SPEECH_STT_PROVIDER,
    sttProvider: sttProvider ?? ("browser" as const),
    ttsProvider: verbxConfigured() ? ("verbx" as const) : ("text" as const),
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
  audioMimeType?: string;
}): Promise<SpeechResult<{ text: string }>> {
  const provider = activeServerSttProvider();
  if (provider === "groq") return transcribeWithGroq(input);
  if (provider === "verbx") return transcribeWithVerbx(input);
  return { ok: false, code: "not_configured", simulated: true };
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function audioExtension(mimeType: string | undefined): string {
  const normalized = (mimeType ?? "audio/webm").split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/flac":
      return "flac";
    default:
      return "webm";
  }
}

async function transcribeWithGroq(input: {
  audioBase64: string;
  language: string;
  audioMimeType?: string;
}): Promise<SpeechResult<{ text: string }>> {
  if (!groqSttConfigured()) return { ok: false, code: "not_configured", simulated: true };

  try {
    const bytes = Buffer.from(input.audioBase64, "base64");
    if (bytes.length < 10) return { ok: false, code: "invalid_audio", simulated: true };

    const mimeType = input.audioMimeType ?? "audio/webm";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      `utterance.${audioExtension(mimeType)}`,
    );
    form.append("model", env.GROQ_STT_MODEL);
    form.append("language", normalizeLanguage(input.language));
    form.append("response_format", "json");
    form.append("temperature", "0");

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status === 429) {
      return {
        ok: false,
        code: "rate_limited",
        simulated: true,
        retryAfterSeconds: retryAfterSeconds(response),
      };
    }
    if (response.status === 400 || response.status === 413 || response.status === 415) {
      return { ok: false, code: "invalid_audio", simulated: true };
    }
    if (!response.ok) return { ok: false, code: "provider_error", simulated: true };

    const parsed = sttResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.text.trim()) {
      return { ok: false, code: "provider_error", simulated: true };
    }
    return {
      ok: true,
      value: { text: parsed.data.text.trim() },
      simulated: false,
      provider: "groq",
    };
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, code: timedOut ? "timeout" : "provider_error", simulated: true };
  }
}

async function transcribeWithVerbx(input: {
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
    if (response.status === 429) {
      return {
        ok: false,
        code: "rate_limited",
        simulated: true,
        retryAfterSeconds: retryAfterSeconds(response),
      };
    }
    if (!response.ok) return { ok: false, code: "provider_error", simulated: true };
    const parsed = sttResponseSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.text.trim()) {
      return { ok: false, code: "provider_error", simulated: true };
    }
    return {
      ok: true,
      value: { text: parsed.data.text.trim() },
      simulated: false,
      provider: "verbx",
    };
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, code: timedOut ? "timeout" : "provider_error", simulated: true };
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

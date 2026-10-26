import { z } from "zod";

/** Treat empty `.env` entries as absent instead of failing validation. */
const optionalString = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.string().min(1).optional(),
);

const boolString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

/**
 * Server-startup environment validation (PRD 18.1).
 * Import `env` from server code only. Missing required vars fail fast.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Server-only. Never expose to the browser (PRD 14).
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SPEECH_PROVIDER: z.enum(["mock", "browser", "verbx"]).default("mock"),
  // auto = browser live recognition first; batch providers only when unavailable.
  SPEECH_STT_PROVIDER: z.enum(["auto", "browser", "groq", "verbx"]).default("auto"),
  // Default to the faster Whisper variant; large-v3 can be selected for accuracy.
  GROQ_STT_MODEL: z
    .enum(["whisper-large-v3", "whisper-large-v3-turbo"])
    .default("whisper-large-v3-turbo"),
  // Optional real speech adapter. Missing key = explicit unavailable fallback.
  VERBX_API_KEY: optionalString,
  VERBX_BASE_URL: z.url().default("https://api.verbxeco.com"),
  VERBX_TTS_VOICE_ID: optionalString,
  TELEPHONY_PROVIDER: z.enum(["mock"]).default("mock"),
  NOTIFICATION_PROVIDER: z.enum(["mock"]).default("mock"),
  // Optional LLM phrasing layer. Missing key = deterministic scripted replies.
  LLM_PROVIDER: z.enum(["groq", "none"]).default("groq"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.string().min(1).default("llama-3.1-8b-instant"),
  DEMO_MODE: boolString,
  ENABLE_REAL_TELEPHONY: boolString,
  ENABLE_REAL_NOTIFICATIONS: boolString,
  ENABLE_DEMO_RESET: boolString,
});

export type Env = z.infer<typeof schema>;

const raw = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SPEECH_PROVIDER: process.env.SPEECH_PROVIDER,
  SPEECH_STT_PROVIDER: process.env.SPEECH_STT_PROVIDER,
  GROQ_STT_MODEL: process.env.GROQ_STT_MODEL,
  VERBX_API_KEY: process.env.VERBX_API_KEY,
  VERBX_BASE_URL: process.env.VERBX_BASE_URL,
  VERBX_TTS_VOICE_ID: process.env.VERBX_TTS_VOICE_ID,
  TELEPHONY_PROVIDER: process.env.TELEPHONY_PROVIDER,
  NOTIFICATION_PROVIDER: process.env.NOTIFICATION_PROVIDER,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL,
  DEMO_MODE: process.env.DEMO_MODE,
  ENABLE_REAL_TELEPHONY: process.env.ENABLE_REAL_TELEPHONY,
  ENABLE_REAL_NOTIFICATIONS: process.env.ENABLE_REAL_NOTIFICATIONS,
  ENABLE_DEMO_RESET: process.env.ENABLE_DEMO_RESET,
};

export const env: Env = schema.parse(
  Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value === "" ? undefined : value])),
);

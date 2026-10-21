import { z } from "zod";

/**
 * Structured LLM analysis for one patient utterance. Internal facts stay in
 * English canonical form; only replyText/followUpQuestion are patient-language.
 * The deterministic rules engine remains the decision authority.
 */

export const analysisSymptomSchema = z
  .object({
    code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
    severity: z.enum(["mild", "moderate", "severe", "unknown"]),
    sourceText: z.string().min(1).max(240),
  })
  .strict();

export const conversationAnalysisSchema = z
  .object({
    language: z.enum(["en", "hi", "mr"]),
    adherenceStatus: z.enum([
      "reported_taken",
      "reported_not_taken",
      "unknown",
      "not_applicable",
    ]),
    symptoms: z.array(analysisSymptomSchema).max(8),
    addressedSymptoms: z.array(z.string().min(1).max(64)).max(8),
    dosageQuestion: z.boolean(),
    emergency: z.boolean(),
    contradictions: z.array(z.string().min(1).max(240)).max(5),
    unansweredQuestions: z.array(z.string().min(1).max(240)).max(5),
    uncertainty: z.array(z.string().min(1).max(160)).max(5),
    recommendedNextStep: z.enum(["ask_followup", "reply_only", "close", "escalate"]),
    replyText: z.string().min(1).max(420),
    followUpQuestion: z.string().min(2).max(300).nullable(),
    summary: z.string().min(1).max(400),
  })
  .strict();

export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>;
export type AnalysisSymptom = z.infer<typeof analysisSymptomSchema>;

interface GroqChoice {
  message?: { content?: string };
}

export function parseAnalysisContent(content: string): ConversationAnalysis | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    const result = conversationAnalysisSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function analysisFromGroqBody(body: unknown): ConversationAnalysis | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: GroqChoice[] }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" ? parseAnalysisContent(content) : null;
}

/** Devanagari check prevents an English reply slipping into a hi/mr call. */
export function replyMatchesLanguage(text: string, language: "en" | "hi" | "mr"): boolean {
  if (language === "en") return !/[\u0900-\u097F]/.test(text);
  return /[\u0900-\u097F]/.test(text);
}

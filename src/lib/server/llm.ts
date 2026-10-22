import { z } from "zod";
import { env } from "@/lib/env";
import { analysisFromGroqBody, type ConversationAnalysis } from "@/modules/conversation/analysis";

/**
 * Optional LLM analysis layer (Groq, OpenAI-compatible). Server-only.
 * One structured call per patient utterance returns facts plus a localized
 * reply. The deterministic rules engine remains the authority: malformed,
 * unsafe, or missing output falls back to the scripted path.
 */

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

/**
 * Groq structured-output schema. Hand-written on purpose: no extra dependency.
 * Zod still validates the parsed object after the provider enforces this shape.
 */
const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "language",
    "adherenceStatus",
    "symptoms",
    "addressedSymptoms",
    "dosageQuestion",
    "emergency",
    "contradictions",
    "unansweredQuestions",
    "uncertainty",
    "recommendedNextStep",
    "replyText",
    "followUpQuestion",
    "summary",
  ],
  properties: {
    language: { type: "string", enum: ["en", "hi", "mr"] },
    adherenceStatus: {
      type: "string",
      enum: ["reported_taken", "reported_not_taken", "unknown", "not_applicable"],
    },
    symptoms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "sourceText"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["mild", "moderate", "severe", "unknown"] },
          sourceText: { type: "string" },
        },
      },
    },
    addressedSymptoms: { type: "array", items: { type: "string" } },
    dosageQuestion: { type: "boolean" },
    emergency: { type: "boolean" },
    contradictions: { type: "array", items: { type: "string" } },
    unansweredQuestions: { type: "array", items: { type: "string" } },
    uncertainty: { type: "array", items: { type: "string" } },
    recommendedNextStep: {
      type: "string",
      enum: ["ask_followup", "reply_only", "close", "escalate"],
    },
    replyText: { type: "string" },
    followUpQuestion: { type: ["string", "null"] },
    summary: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = [
  "You are the voice of a calm, warm nurse on a simulated VenLoop medication check-in with an older adult.",
  "Return only JSON matching the requested shape. No markdown.",
  "Understand the whole utterance: one sentence can contain several facts. Extract every fact separately and never drop one.",
  'Example: "I took the pills but I feel like having a fever. Should I take another pill?" => adherenceStatus reported_taken, symptoms [possible_fever], dosageQuestion true.',
  "List every distinct symptom. Never merge two symptoms into one code.",
  "Safety rules:",
  "- Never give medical, dosage, or diagnostic advice.",
  "- Never tell the person to take, skip, double, stop, or change any medicine.",
  "- Never suggest contacting a doctor or pharmacist. Only say you will pass the information to the caregiver.",
  "- Never say what condition they have or might have.",
  "- Use only the supplied conversation. Never invent facts, actions, results, or notifications.",
  "- Unknown is unknown. A question is not evidence of adherence.",
  "- Set emergency true for trouble breathing, chest pain, fainting, stroke signs, overdose, or a request for help.",
  '- If simulatedNotificationSent is false, never say a notification was sent. "I will let your caregiver know" is allowed.',
  "Conversation rules:",
  "- replyText: warm acknowledgement of what the patient just said, 1-2 short sentences, max 35 words, no question mark.",
  "- Acknowledge every fact in the utterance: adherence, each symptom, and any dosage question.",
  '- followUpQuestion: one short natural question only when a safety fact is missing; otherwise null.',
  "- addressedSymptoms: canonical codes of previously asked symptom questions this answer actually resolved (onset/severity given). \"I don't know\" resolves nothing.",
  '- recommendedNextStep: "ask_followup" only if your followUpQuestion is needed, "close" when no safety question remains, "escalate" only for emergency.',
  "- If language is hi or mr, replyText and followUpQuestion use natural Devanagari Hindi or Marathi. Codes and summary stay English.",
  "- Symptom codes are snake_case: nausea_or_vomiting, possible_fever, dizziness, headache, chest_pain, shortness_of_breath, blurred_vision, fainting, unsteadiness.",
].join("\n");

// ponytail: per-process concurrency cap; a shared queue belongs in infra later.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;

export function llmConfigured(): boolean {
  return env.LLM_PROVIDER === "groq" && Boolean(env.GROQ_API_KEY);
}

export interface AnalysisRequest {
  patientFirstName: string;
  language: "en" | "hi" | "mr";
  latestPatientUtterance: string;
  normalizedEnglish: string;
  history: { transcript: string; agentReply: string | null; followUpQuestion: string | null }[];
  state: {
    summary: string;
    medicationStatus: string;
    symptoms: string[];
    medicationQuestions: string[];
    activeConcerns: string[];
    openQuestions: string[];
  };
  deterministicSignals: {
    adherenceStatus: string;
    symptoms: string[];
    dosageQuestion: boolean;
    emergency: boolean;
  };
  simulatedNotificationSent: boolean;
}

export async function requestTurnAnalysis(
  input: AnalysisRequest,
): Promise<ConversationAnalysis | null> {
  const apiKey = env.GROQ_API_KEY;
  if (env.LLM_PROVIDER !== "groq" || !apiKey) return null;
  if (inFlight >= MAX_IN_FLIGHT) return null;
  inFlight += 1;

  const userContext = {
    patientFirstName: input.patientFirstName,
    selectedLanguage: input.language,
    patientSaid: input.latestPatientUtterance.slice(0, 500),
    englishText:
      input.normalizedEnglish.slice(0, 500) === input.latestPatientUtterance.slice(0, 500)
        ? undefined
        : input.normalizedEnglish.slice(0, 500),
    simulatedNotificationSent: input.simulatedNotificationSent,
    conversationState: input.state,
    deterministicSignals: input.deterministicSignals,
    recentTurns: input.history.slice(-3).map((turn) => ({
      patient: turn.transcript.slice(0, 200),
      asked: turn.followUpQuestion,
    })),
    requiredJsonShape: {
      language: "en | hi | mr",
      adherenceStatus: "reported_taken | reported_not_taken | unknown | not_applicable",
      symptoms: [{ code: "snake_case", severity: "mild | moderate | severe | unknown", sourceText: "short quote" }],
      addressedSymptoms: ["codes answered by this turn"],
      dosageQuestion: "boolean",
      emergency: "boolean",
      contradictions: ["short English description"],
      unansweredQuestions: ["short English description"],
      uncertainty: ["short English description"],
      recommendedNextStep: "ask_followup | reply_only | close | escalate",
      replyText: "localized acknowledgement, no question",
      followUpQuestion: "localized single question or null",
      summary: "short English summary of the conversation",
    },
  };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL,
          temperature: 0.3,
          max_tokens: 1024,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "venloop_turn_analysis",
              strict: true,
              schema: ANALYSIS_JSON_SCHEMA,
            },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(userContext) },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const parsedBody = responseSchema.safeParse(await response.json());
      if (!parsedBody.success) continue;
      const analysis = analysisFromGroqBody({ choices: parsedBody.data.choices });
      if (analysis) return analysis;
    }
    return null;
  } catch {
    return null;
  } finally {
    inFlight -= 1;
  }
}

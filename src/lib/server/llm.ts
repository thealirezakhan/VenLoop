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

const SYSTEM_PROMPT = [
  "You are the language and fact-analysis layer for VenLoop's simulated medication check-in with an older adult.",
  "Return only JSON matching the requested shape. No markdown.",
  "You may analyze and summarize what the patient said, including contradictions and uncertainty.",
  "You never decide medication adherence or escalation; a deterministic safety engine does that.",
  "Hard rules:",
  "- Never give medical, dosage, or diagnostic advice.",
  "- Never tell the person to change, skip, double, stop, or adjust a dose.",
  "- Never say what condition they have or might have.",
  "- Use only the supplied conversation. Do not invent actions, results, notifications, or facts.",
  "- Unknown is unknown. A question is not evidence of adherence.",
  "- If the patient describes trouble breathing, chest pain, fainting, stroke signs, overdose, or asks for help, set emergency true.",
  "- replyText must be warm, plain, 1-2 short sentences, at most 45 words, and must not ask a question.",
  "- followUpQuestion must be one short question in the patient's selected language, or null.",
  "- If the patient language is hi or mr, replyText and followUpQuestion must be natural Hindi or Marathi in Devanagari script.",
  "- Summaries and canonical fact codes stay in English. Symptom codes use snake_case (for example nausea_or_vomiting, possible_fever).",
  "- Never claim the call has ended, and never claim a notification was sent unless the facts say simulatedNotificationSent.",
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
    latestPatientUtterance: input.latestPatientUtterance,
    normalizedEnglish: input.normalizedEnglish,
    simulatedNotificationSent: input.simulatedNotificationSent,
    conversationState: input.state,
    deterministicSignals: input.deterministicSignals,
    recentTurns: input.history.slice(-4),
    requiredJsonShape: {
      language: "en | hi | mr",
      adherenceStatus: "reported_taken | reported_not_taken | unknown | not_applicable",
      symptoms: [{ code: "snake_case", severity: "mild | moderate | severe | unknown", sourceText: "short quote" }],
      addressedSymptoms: ["codes from existing open questions that this utterance answered"],
      dosageQuestion: "boolean",
      emergency: "boolean",
      contradictions: ["short English description"],
      unansweredQuestions: ["short English description"],
      uncertainty: ["short English description"],
      recommendedNextStep: "ask_followup | reply_only | close | escalate",
      replyText: "localized patient-facing acknowledgement, no question",
      followUpQuestion: "localized single question or null",
      summary: "short English summary of the whole conversation so far",
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
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(userContext) },
          ],
        }),
        signal: AbortSignal.timeout(12_000),
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

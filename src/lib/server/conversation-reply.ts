import { llmConfigured, requestTurnAnalysis } from "./llm";
import { checkAgentText } from "@/modules/conversation/reply-guard";
import {
  replyMatchesLanguage,
  type ConversationAnalysis,
} from "@/modules/conversation/analysis";
import { isClosingIntent, type ConversationState, type ReplySource } from "@/modules/conversation/state";
import type { ExtractedSignals } from "@/modules/rules-engine/extract";
import type { AdherenceStatus, DecisionType } from "@/modules/rules-engine/types";
import {
  clarificationQuestion,
  closingCopy,
  decisionCopy,
  notTakenCopy,
  type SupportedLanguage,
} from "@/modules/conversation/language";
import type { ConversationTurn } from "./conversation-store";

const ACTION_DECISIONS = new Set([
  "symptom_escalation",
  "dosage_safety_response",
  "emergency_guidance",
  "unreachable_escalation",
]);

/** These decisions keep the exact scripted safety wording; no model phrasing. */
const SCRIPTED_ONLY_DECISIONS = new Set([
  "dosage_safety_response",
  "emergency_guidance",
  "unreachable_escalation",
  "unresolved",
]);

export function actionTakenFor(decisionType: string): boolean {
  return ACTION_DECISIONS.has(decisionType);
}

export interface AnalyzeTurnInput {
  firstName: string;
  transcript: string;
  normalizedEnglish: string;
  language: SupportedLanguage;
  history: ConversationTurn[];
  previousState: ConversationState;
  signals: ExtractedSignals;
  inputSource: "speech" | "typed" | "synthetic_fixture";
  simulatedNotificationSent: boolean;
}

export interface AnalyzedTurn {
  analysis: ConversationAnalysis;
  source: "llm" | "deterministic";
}

function deterministicAnalysis(input: AnalyzeTurnInput): ConversationAnalysis {
  const symptoms = input.signals.symptoms.map((code) => ({
    code,
    severity: input.previousState.severeSymptoms.includes(code) ? ("severe" as const) : ("unknown" as const),
    sourceText: input.transcript.slice(0, 240),
  }));
  const stateParts = [
    input.previousState.medicationStatus === "unknown"
      ? "medication unknown"
      : input.previousState.medicationStatus.replaceAll("_", " "),
    input.signals.symptoms.length > 0
      ? `reported ${input.signals.symptoms.join(", ")}`
      : null,
    input.signals.dosageQuestion ? "asked about changing the dose" : null,
  ].filter(Boolean);
  return {
    language: input.language,
    adherenceStatus: input.signals.adherenceStatus,
    symptoms,
    addressedSymptoms: [],
    dosageQuestion: input.signals.dosageQuestion,
    emergency: input.signals.emergency,
    contradictions: [],
    unansweredQuestions: [],
    uncertainty: [],
    recommendedNextStep: "close",
    replyText: "",
    followUpQuestion: null,
    summary: stateParts.join("; ") || "No new facts reported.",
  };
}

export async function analyzeTurn(input: AnalyzeTurnInput): Promise<AnalyzedTurn> {
  const fallback = deterministicAnalysis(input);
  if (input.inputSource === "synthetic_fixture" || !llmConfigured()) {
    return { analysis: fallback, source: "deterministic" };
  }

  // One compact call per turn only when wording or multi-fact parsing helps.
  // Emergency copy is scripted and immediate; routine "yes I took it" and call
  // close-out add no facts, so they skip the provider and save tokens/latency.
  const needsLanguageModel =
    !input.signals.emergency &&
    !isClosingIntent(input.transcript, input.signals) &&
    (input.signals.symptoms.length > 0 ||
      input.signals.dosageQuestion ||
      input.signals.adherenceStatus === "unknown");
  if (!needsLanguageModel) return { analysis: fallback, source: "deterministic" };

  const predictedDecision = input.signals.dosageQuestion
    ? "dosage_safety_response"
    : input.signals.symptoms.length > 0
      ? "symptom_escalation"
      : "clarification_required";
  const actionTaken = actionTakenFor(predictedDecision);

  const analysis = await requestTurnAnalysis({
    patientFirstName: input.firstName,
    language: input.language,
    latestPatientUtterance: input.transcript,
    normalizedEnglish: input.normalizedEnglish,
    history: input.history,
    state: {
      summary: input.previousState.summary,
      medicationStatus: input.previousState.medicationStatus,
      symptoms: input.previousState.symptoms,
      medicationQuestions: input.previousState.medicationQuestions,
      activeConcerns: input.previousState.activeConcerns,
      openQuestions: input.previousState.openQuestions,
    },
    deterministicSignals: {
      adherenceStatus: input.signals.adherenceStatus,
      symptoms: input.signals.symptoms,
      dosageQuestion: input.signals.dosageQuestion,
      emergency: input.signals.emergency,
    },
    simulatedNotificationSent: input.simulatedNotificationSent,
  });

  if (!analysis) return { analysis: fallback, source: "deterministic" };

  const reply = analysis.replyText.trim();
  const replyUsable =
    reply.length > 0 &&
    replyMatchesLanguage(reply, input.language) &&
    checkAgentText({
      text: reply,
      decisionType: predictedDecision,
      actionTaken,
    }).ok;
  const question =
    analysis.followUpQuestion &&
    replyMatchesLanguage(analysis.followUpQuestion, input.language) &&
    checkAgentText({
      text: analysis.followUpQuestion,
      decisionType: predictedDecision,
      actionTaken,
      allowQuestion: true,
    }).ok
      ? analysis.followUpQuestion
      : null;

  return {
    analysis: {
      ...analysis,
      language: input.language,
      replyText: replyUsable ? reply : "",
      followUpQuestion: question,
    },
    source: replyUsable ? "llm" : "deterministic",
  };
}

export interface AgentTurnInput {
  firstName: string;
  decisionType: DecisionType;
  adherenceStatus: AdherenceStatus;
  state: ConversationState;
  analysis: ConversationAnalysis;
  analysisSource: "llm" | "deterministic";
  language: SupportedLanguage;
  actionTaken: boolean;
  isFollowUp: boolean;
  closing: boolean;
  emergency: boolean;
}

export interface AgentTurn {
  text: string;
  followUpQuestion: string | null;
  source: ReplySource;
}

export function buildAgentTurn(input: AgentTurnInput): AgentTurn {
  const severe = input.state.severeSymptoms.length > 0;

  let base =
    input.decisionType === "log_adherence" && input.adherenceStatus === "reported_not_taken"
      ? notTakenCopy(input.language)
      : decisionCopy(input.decisionType, input.language, {
          severe,
          followUp: input.isFollowUp,
        });

  if (input.decisionType === "clarification_required") {
    base = decisionCopy("clarification_required", input.language);
  }

  if (input.emergency) {
    return {
      text: decisionCopy("emergency_guidance", input.language),
      followUpQuestion: null,
      source: "scripted",
    };
  }

  if (input.closing) {
    const closing = closingCopy(input.language, {
      firstName: input.firstName,
      actionTaken: input.actionTaken,
      unanswered: input.state.unansweredQuestions.length > 0,
      emergency: false,
    });
    const text =
      input.decisionType === "log_adherence" || input.decisionType === "clarification_required"
        ? `${base} ${closing}`
        : closing;
    return {
      text: text.replace(/\s+/g, " ").trim(),
      followUpQuestion: null,
      source: "scripted",
    };
  }

  let source: ReplySource = "scripted";
  if (
    input.analysis.replyText &&
    input.analysisSource === "llm" &&
    !SCRIPTED_ONLY_DECISIONS.has(input.decisionType) &&
    replyMatchesLanguage(input.analysis.replyText, input.language)
  ) {
    base = input.analysis.replyText;
    source = "llm";
  }

  return {
    text: base,
    followUpQuestion:
      input.decisionType === "clarification_required" && input.closing === false
        ? clarificationQuestion(input.language)
        : null,
    source,
  };
}

/**
 * The deterministic gate decides whether a question is required. The model may
 * only rephrase that question; safety-critical questions keep exact wording.
 */
export function selectFollowUpQuestion(
  required: string | null,
  analysis: ConversationAnalysis,
  language: SupportedLanguage,
  decisionType: DecisionType,
  actionTaken: boolean,
): string | null {
  if (!required) return null;
  if (decisionType === "dosage_safety_response" || decisionType === "emergency_guidance") {
    return required;
  }
  const proposed = analysis.followUpQuestion?.trim() ?? "";
  if (!proposed || proposed.length > 220) return required;
  if ((proposed.match(/\?/g) ?? []).length !== 1) return required;
  if (!replyMatchesLanguage(proposed, language)) return required;
  if (
    !checkAgentText({
      text: proposed,
      decisionType,
      actionTaken,
      allowQuestion: true,
    }).ok
  ) {
    return required;
  }
  return proposed;
}

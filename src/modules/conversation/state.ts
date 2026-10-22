import { z } from "zod";
import type { AdherenceStatus, DecisionType } from "@/modules/rules-engine/types";
import type { ExtractedSignals } from "@/modules/rules-engine/extract";
import type { ConversationAnalysis, AnalysisSymptom } from "./analysis";
import { dosageSafetyCheck, symptomFollowUp, type SupportedLanguage } from "./language";
import {
  canonicalSymptomCode,
  isSevereSymptomReport,
  symptomMentioned,
  symptomRetracted,
} from "@/modules/rules-engine/symptoms";

/**
 * Conversation state for a single check-in. Pure data + pure transitions.
 * The deterministic rules engine stays the authority: this module tracks what
 * has been reported (with source turn), what still needs an answer, and when
 * the call may safely end. LLM analysis may add facts; it never overrides the
 * emergency, dosage, or close gates.
 */

export type EscalationState = "none" | "case_opened" | "emergency";
export type ReplySource = "llm" | "scripted";
export type EndReason = "completed" | "escalated" | "unresolved";
export type ActiveConcern =
  | "emergency"
  | "dosage_safety"
  | "symptom_assessment"
  | "adherence"
  | "unreachable";
export type NextStep = ConversationAnalysis["recommendedNextStep"];

export interface ConversationFact {
  kind:
    | "adherence"
    | "symptom"
    | "symptom_retracted"
    | "dosage_question"
    | "emergency"
    | "contradiction";
  value: string;
  severity?: "mild" | "moderate" | "severe" | "unknown";
  sourceTurnId: string;
  sourceText: string;
}

export interface ConversationState {
  medicationStatus: AdherenceStatus;
  symptoms: string[];
  severeSymptoms: string[];
  addressedSymptoms: string[];
  retractedSymptoms: string[];
  contradictions: string[];
  escalation: EscalationState;
  escalationDecision: DecisionType | null;
  openQuestions: string[];
  askedQuestions: string[];
  unansweredQuestions: string[];
  followUpAttempts: Record<string, number>;
  turnCount: number;
  closed: boolean;
  endReason: EndReason | null;
  activeConcerns: ActiveConcern[];
  medicationQuestions: string[];
  facts: ConversationFact[];
  summary: string;
  recommendedNextStep: NextStep | null;
  analysisSource: "llm" | "deterministic" | null;
}

const adherenceSchema = z.enum([
  "reported_taken",
  "reported_not_taken",
  "unknown",
  "not_applicable",
]);

const factSchema = z.object({
  kind: z.enum([
    "adherence",
    "symptom",
    "symptom_retracted",
    "dosage_question",
    "emergency",
    "contradiction",
  ]),
  value: z.string(),
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).optional(),
  sourceTurnId: z.string(),
  sourceText: z.string(),
});

export const conversationStateSchema = z.object({
  medicationStatus: adherenceSchema,
  symptoms: z.array(z.string()),
  severeSymptoms: z.array(z.string()),
  addressedSymptoms: z.array(z.string()),
  retractedSymptoms: z.array(z.string()).default([]),
  contradictions: z.array(z.string()),
  escalation: z.enum(["none", "case_opened", "emergency"]),
  escalationDecision: z
    .enum(["symptom_escalation", "dosage_safety_response", "emergency_guidance"])
    .nullable()
    .default(null),
  openQuestions: z.array(z.string()),
  askedQuestions: z.array(z.string()),
  unansweredQuestions: z.array(z.string()),
  followUpAttempts: z.record(z.string(), z.number().int().nonnegative()),
  turnCount: z.number().int().nonnegative(),
  closed: z.boolean(),
  endReason: z.enum(["completed", "escalated", "unresolved"]).nullable(),
  activeConcerns: z.array(z.enum(["emergency", "dosage_safety", "symptom_assessment", "adherence", "unreachable"])).default([]),
  medicationQuestions: z.array(z.string()).default([]),
  facts: z.array(factSchema).default([]),
  summary: z.string().default(""),
  recommendedNextStep: z.enum(["ask_followup", "reply_only", "close", "escalate"]).nullable().default(null),
  analysisSource: z.enum(["llm", "deterministic"]).nullable().default(null),
});

export function emptyConversationState(): ConversationState {
  return {
    medicationStatus: "unknown",
    symptoms: [],
    severeSymptoms: [],
    addressedSymptoms: [],
    retractedSymptoms: [],
    contradictions: [],
    escalation: "none",
    escalationDecision: null,
    openQuestions: [],
    askedQuestions: [],
    unansweredQuestions: [],
    followUpAttempts: {},
    turnCount: 0,
    closed: false,
    endReason: null,
    activeConcerns: [],
    medicationQuestions: [],
    facts: [],
    summary: "",
    recommendedNextStep: null,
    analysisSource: null,
  };
}

export function parseConversationState(value: unknown): ConversationState {
  const parsed = conversationStateSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyConversationState();
}

export interface AdvanceInput {
  transcript: string;
  signals: ExtractedSignals;
  /** Latest deterministic decision; the engine decides, not the LLM. */
  decision: DecisionType;
  escalated: boolean;
  analysis?: ConversationAnalysis | null;
  analysisSource?: "llm" | "deterministic" | null;
  sourceTurnId?: string | null;
  language?: SupportedLanguage;
}

export interface AdvanceResult {
  state: ConversationState;
  followUpQuestion: string | null;
  closing: boolean;
}

const CLOSING_INTENT =
  /\b(nothing else|nothing more|that'?s all|that is all|i'?m fine|i am fine|all good|no thanks|no thank you|no more questions|don'?t want to answer|do not want to answer|rather not|let'?s finish|end the call)\b/i;
const BARE_CLOSING = /^\s*(no|nope|thanks|thank you)[.!]?\s*$/i;
const DENIAL_PATTERN = /\b(no|not|never|without|don'?t|do not)\b/i;
const DETAIL_PATTERN =
  /\b(mild|moderate|severe|started|this morning|today|yesterday|last night|no vomiting|not vomiting|stopped)\b/i;

export const MAX_SYMPTOM_FOLLOW_UPS = 2;

export function isSevereReport(transcript: string, signals: ExtractedSignals): boolean {
  if (signals.emergency) return true;
  return isSevereSymptomReport(transcript);
}

export function isClosingIntent(
  transcript: string,
  signals: ExtractedSignals,
  hasAskedSymptomQuestion = false,
): boolean {
  if (signals.symptoms.length > 0) return false;
  if (BARE_CLOSING.test(transcript.trim())) return !hasAskedSymptomQuestion;
  return CLOSING_INTENT.test(transcript);
}

export function questionText(question: string, language: SupportedLanguage = "en"): string {
  if (question.startsWith("symptom_details:")) {
    return symptomFollowUp(question.slice("symptom_details:".length), language);
  }
  if (question === "dosage_safety_check") return dosageSafetyCheck(language);
  return question;
}

export function nextOpenQuestion(
  state: ConversationState,
  language: SupportedLanguage = "en",
): string | null {
  const question = state.openQuestions[0];
  return question ? questionText(question, language) : null;
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function addFact(state: ConversationState, fact: ConversationFact): void {
  const exists = state.facts.some(
    (item) =>
      item.kind === fact.kind &&
      item.value === fact.value &&
      item.sourceTurnId === fact.sourceTurnId,
  );
  if (!exists) state.facts.push(fact);
}

function mergeAdherence(
  state: ConversationState,
  input: AdvanceInput,
  sourceTurnId: string,
): void {
  const fromAnalysis = input.analysis?.adherenceStatus;
  const next =
    input.signals.adherenceStatus !== "unknown"
      ? input.signals.adherenceStatus
      : fromAnalysis && fromAnalysis !== "unknown"
        ? fromAnalysis
        : "unknown";
  if (next !== "reported_taken" && next !== "reported_not_taken") return;
  const previous = state.medicationStatus;
  if (
    (previous === "reported_taken" || previous === "reported_not_taken") &&
    previous !== next
  ) {
    const contradiction = `Medication report changed from ${previous.replaceAll("_", " ")} to ${next.replaceAll("_", " ")}.`;
    addUnique(state.contradictions, contradiction);
    addFact(state, {
      kind: "contradiction",
      value: contradiction,
      sourceTurnId,
      sourceText: input.transcript,
    });
  }
  state.medicationStatus = next;
  addFact(state, {
    kind: "adherence",
    value: next,
    sourceTurnId,
    sourceText: input.transcript,
  });
}

function analysisSymptomFor(
  analysis: ConversationAnalysis | null | undefined,
  symptom: string,
): AnalysisSymptom | undefined {
  return analysis?.symptoms.find((item) => canonicalSymptomCode(item.code) === symptom);
}

function mergeSymptoms(
  state: ConversationState,
  input: AdvanceInput,
  transcript: string,
  sourceTurnId: string,
  severe: boolean,
): void {
  for (const raw of input.signals.symptoms) {
    const symptom = canonicalSymptomCode(raw);
    if (!symptom) continue;
    const existed = state.symptoms.includes(symptom);
    const wasRetracted = state.retractedSymptoms.includes(symptom);
    if (wasRetracted) {
      state.retractedSymptoms = state.retractedSymptoms.filter((item) => item !== symptom);
    }
    addUnique(state.symptoms, symptom);
    const fromAnalysis = analysisSymptomFor(input.analysis, symptom);
    const severity = fromAnalysis?.severity ?? (severe ? "severe" : "unknown");
    if (severity === "severe") addUnique(state.severeSymptoms, symptom);
    addFact(state, {
      kind: "symptom",
      value: symptom,
      severity,
      sourceTurnId,
      sourceText: fromAnalysis?.sourceText ?? transcript,
    });
    if (!existed) addUnique(state.openQuestions, `symptom_details:${symptom}`);
  }

  if (DENIAL_PATTERN.test(transcript)) {
    for (const symptom of state.symptoms) {
      if (!symptomMentioned(transcript, symptom)) continue;
      if (symptomRetracted(transcript, symptom)) continue;
      const word = symptom.replaceAll("_", " ");
      const contradiction = `Patient later denied ${word} after reporting it.`;
      addUnique(state.contradictions, contradiction);
      addFact(state, {
        kind: "contradiction",
        value: contradiction,
        sourceTurnId,
        sourceText: transcript,
      });
    }
  }
}

function applyRetractions(
  state: ConversationState,
  transcript: string,
  sourceTurnId: string,
): void {
  for (const symptom of [...state.symptoms]) {
    if (!symptomRetracted(transcript, symptom)) continue;
    state.symptoms = state.symptoms.filter((item) => item !== symptom);
    state.severeSymptoms = state.severeSymptoms.filter((item) => item !== symptom);
    state.openQuestions = state.openQuestions.filter(
      (question) => question !== `symptom_details:${symptom}`,
    );
    addUnique(state.addressedSymptoms, symptom);
    addUnique(state.retractedSymptoms, symptom);
    addFact(state, {
      kind: "symptom_retracted",
      value: symptom,
      sourceTurnId,
      sourceText: transcript,
    });
  }
}

function mergeQuestions(
  state: ConversationState,
  input: AdvanceInput,
  sourceTurnId: string,
): void {
  if (input.signals.dosageQuestion || input.analysis?.dosageQuestion) {
    addUnique(state.medicationQuestions, "dosage_change_requested");
    addFact(state, {
      kind: "dosage_question",
      value: "dosage_change_requested",
      sourceTurnId,
      sourceText: input.transcript,
    });
  }
  if (input.signals.emergency || input.analysis?.emergency) {
    addFact(state, {
      kind: "emergency",
      value: "emergency_reported",
      sourceTurnId,
      sourceText: input.analysis?.emergency ? input.transcript : input.transcript,
    });
  }
  for (const contradiction of input.analysis?.contradictions ?? []) {
    addUnique(state.contradictions, contradiction);
    addFact(state, {
      kind: "contradiction",
      value: contradiction,
      sourceTurnId,
      sourceText: input.transcript,
    });
  }
}

function resolveSymptomQuestions(
  state: ConversationState,
  transcript: string,
  input: AdvanceInput,
  closingIntent: boolean,
  severe: boolean,
  language: SupportedLanguage,
  newSymptomThisTurn: boolean,
  previouslyReported: Set<string>,
): void {
  const addressedByModel = new Set(
    (input.analysis?.addressedSymptoms ?? [])
      .map((code) => canonicalSymptomCode(code))
      .filter(
        (code): code is string =>
          code !== null &&
          state.symptoms.includes(code) &&
          previouslyReported.has(code),
      ),
  );
  const hasModelAddresses = addressedByModel.size > 0;
  const details = closingIntent
    ? state.openQuestions.filter((q) => q.startsWith("symptom_details:"))
    : state.openQuestions.filter(
        (q) => q.startsWith("symptom_details:") && state.askedQuestions.includes(q),
      );
  const singlePending = details.length === 1;

  for (const question of details) {
    const symptom = question.slice("symptom_details:".length);
    const mentionsSymptom = symptomMentioned(transcript, symptom);
    const looksLikeAnswer =
      addressedByModel.has(symptom) ||
      mentionsSymptom ||
      (!hasModelAddresses &&
        !newSymptomThisTurn &&
        singlePending &&
        DETAIL_PATTERN.test(transcript));
    if (!closingIntent && !looksLikeAnswer) continue;

    if (closingIntent) {
      addUnique(state.unansweredQuestions, questionText(question, language));
      state.openQuestions = state.openQuestions.filter((q) => q !== question);
      continue;
    }
    addUnique(state.addressedSymptoms, symptom);
    if (severe) addUnique(state.severeSymptoms, symptom);
    state.openQuestions = state.openQuestions.filter((q) => q !== question);
  }

  if (!closingIntent) {
    for (const symptom of addressedByModel) {
      addUnique(state.addressedSymptoms, symptom);
      if (severe) addUnique(state.severeSymptoms, symptom);
      state.openQuestions = state.openQuestions.filter(
        (q) => q !== `symptom_details:${symptom}`,
      );
    }
  }
}

const ESCALATION_PRIORITY: Partial<Record<DecisionType, number>> = {
  dosage_safety_response: 1,
  symptom_escalation: 2,
  emergency_guidance: 3,
};

export function escalationPriority(decision: DecisionType | null): number {
  return decision ? (ESCALATION_PRIORITY[decision] ?? 0) : 0;
}

function higherConcern(
  current: DecisionType | null,
  next: DecisionType | null,
): DecisionType | null {
  return escalationPriority(next) > escalationPriority(current) ? next : current;
}

function refreshActiveConcerns(state: ConversationState): void {
  const next: ActiveConcern[] = [];
  if (state.escalation === "emergency") next.push("emergency");
  if (state.medicationQuestions.length > 0) next.push("dosage_safety");
  if (state.symptoms.length > 0) next.push("symptom_assessment");
  if (!state.closed && state.escalationDecision === "unreachable_escalation") next.push("unreachable");
  if (
    state.medicationStatus === "reported_taken" ||
    state.medicationStatus === "reported_not_taken"
  ) {
    next.push("adherence");
  }
  state.activeConcerns = next;
}

function buildSummary(state: ConversationState): string {
  const parts = [
    state.medicationStatus === "unknown"
      ? "Medication: unknown"
      : `Medication: ${state.medicationStatus.replaceAll("_", " ")}`,
    state.symptoms.length > 0
      ? `Active symptoms: ${state.symptoms.join(", ")}`
      : "Active symptoms: none",
    state.severeSymptoms.length > 0 ? `Severe: ${state.severeSymptoms.join(", ")}` : null,
    state.retractedSymptoms.length > 0
      ? `Retracted: ${state.retractedSymptoms.join(", ")}`
      : null,
    state.medicationQuestions.length > 0 ? "Dosage question recorded" : null,
    state.openQuestions.length > 0
      ? `Open questions: ${state.openQuestions
          .map((question) => question.replace("symptom_details:", ""))
          .join(", ")}`
      : null,
    state.unansweredQuestions.length > 0
      ? `Unanswered: ${state.unansweredQuestions.length}`
      : null,
  ].filter(Boolean);
  return parts.join(". ");
}

function finish(
  state: ConversationState,
  followUpQuestion: string | null,
  closing: boolean,
  nextStep: NextStep,
): AdvanceResult {
  state.summary = buildSummary(state);
  state.recommendedNextStep = nextStep;
  return { state, followUpQuestion, closing };
}

function close(state: ConversationState, reason: EndReason): AdvanceResult {
  state.closed = true;
  state.endReason = reason;
  state.openQuestions = [];
  refreshActiveConcerns(state);
  return finish(state, null, true, state.escalation === "none" ? "close" : "escalate");
}

/**
 * Fold one patient turn into the conversation state and decide the next agent
 * move. Never ends while a symptom question is open unless the patient declines
 * (recorded as unanswered) or a red flag requires immediate escalation.
 */
export function advanceConversation(
  previous: ConversationState,
  input: AdvanceInput,
): AdvanceResult {
  const language = input.language ?? "en";
  const sourceTurnId = input.sourceTurnId ?? `turn-${previous.turnCount + 1}`;
  const state: ConversationState = {
    ...previous,
    symptoms: [...previous.symptoms],
    severeSymptoms: [...previous.severeSymptoms],
    addressedSymptoms: [...previous.addressedSymptoms],
    retractedSymptoms: [...previous.retractedSymptoms],
    contradictions: [...previous.contradictions],
    openQuestions: [...previous.openQuestions],
    askedQuestions: [...previous.askedQuestions],
    unansweredQuestions: [...previous.unansweredQuestions],
    followUpAttempts: { ...previous.followUpAttempts },
    activeConcerns: [...previous.activeConcerns],
    medicationQuestions: [...previous.medicationQuestions],
    facts: [...previous.facts],
    turnCount: previous.turnCount + 1,
  };

  state.analysisSource = input.analysisSource ?? null;

  if (state.closed) return close(state, state.endReason ?? "completed");

  const hasAskedSymptomQuestion = state.openQuestions.some(
    (q) => q.startsWith("symptom_details:") && state.askedQuestions.includes(q),
  );
  const closingIntent = isClosingIntent(input.transcript, input.signals, hasAskedSymptomQuestion);
  const severe =
    isSevereReport(input.transcript, input.signals) ||
    (input.analysis?.symptoms.some(
      (item) =>
        item.severity === "severe" && canonicalSymptomCode(item.code) !== null,
    ) ?? false);
  const newSymptomThisTurn = input.signals.symptoms.some((symptom) => {
    const code = canonicalSymptomCode(symptom);
    return code !== null && !previous.symptoms.includes(code);
  });

  mergeAdherence(state, input, sourceTurnId);
  mergeSymptoms(state, input, input.transcript, sourceTurnId, severe);
  mergeQuestions(state, input, sourceTurnId);
  applyRetractions(state, input.transcript, sourceTurnId);
  resolveSymptomQuestions(
    state,
    input.transcript,
    input,
    closingIntent,
    severe,
    language,
    newSymptomThisTurn,
    new Set(previous.symptoms),
  );

  if (input.escalated && state.escalation === "none") state.escalation = "case_opened";
  state.escalationDecision = higherConcern(state.escalationDecision, input.decision);

  if (input.signals.emergency || input.analysis?.emergency || input.decision === "emergency_guidance") {
    state.escalation = "emergency";
    state.escalationDecision = "emergency_guidance";
    return close(state, "escalated");
  }

  if (input.decision === "unreachable_escalation" || input.decision === "unresolved") {
    return close(state, "escalated");
  }

  refreshActiveConcerns(state);

  if (input.decision === "clarification_required" && state.symptoms.length === 0) {
    return finish(state, null, false, "reply_only");
  }

  if (closingIntent) {
    for (const question of state.openQuestions) {
      if (question.startsWith("symptom_details:")) {
        addUnique(state.unansweredQuestions, questionText(question, language));
      }
    }
    return close(state, input.escalated ? "escalated" : "completed");
  }

  while (true) {
    const pendingSymptom = state.openQuestions.find((q) => q.startsWith("symptom_details:"));
    if (!pendingSymptom) break;
    const attempts = state.followUpAttempts[pendingSymptom] ?? 0;
    if (attempts >= MAX_SYMPTOM_FOLLOW_UPS) {
      addUnique(state.unansweredQuestions, questionText(pendingSymptom, language));
      state.openQuestions = state.openQuestions.filter((q) => q !== pendingSymptom);
      continue;
    }
    state.followUpAttempts[pendingSymptom] = attempts + 1;
    addUnique(state.askedQuestions, pendingSymptom);
    return finish(state, questionText(pendingSymptom, language), false, "ask_followup");
  }

  if (
    state.symptoms.length === 0 &&
    state.medicationQuestions.length > 0 &&
    !state.askedQuestions.includes("dosage_safety_check")
  ) {
    addUnique(state.askedQuestions, "dosage_safety_check");
    return finish(state, questionText("dosage_safety_check", language), false, "ask_followup");
  }

  return close(state, input.escalated ? "escalated" : "completed");
}

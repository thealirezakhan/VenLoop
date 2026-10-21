import { adminClient } from "./admin";
import { ApiFailure } from "./failures";
import { canViewPatient, type Role } from "@/lib/permissions";
import { evaluateDecision } from "@/modules/rules-engine/rules";
import { extractSignals, type ExtractedSignals } from "@/modules/rules-engine/extract";
import {
  RULE_SET_VERSION,
  type DecisionResult,
  type DecisionType,
} from "@/modules/rules-engine/types";
import { transitionCheckIn, transitionAction, type CheckInState, type ActionState } from "@/modules/workflow/state-machine";
import { isConsentValid, type ConsentSnapshot } from "@/modules/workflow/consent";
import { actionIdempotencyKey } from "@/modules/workflow/idempotency";
import { mockNotificationProvider } from "@/modules/providers/notification";
import { categoryForDecision, severityForDecision } from "@/modules/escalation/case-actions";
import type { AuditEventType } from "@/modules/workflow/audit-events";
import {
  advanceConversation,
  escalationPriority,
  type ConversationState,
  type ReplySource,
} from "@/modules/conversation/state";
import {
  loadConversationState,
  loadHistory,
  loadPatientConversationContext,
  recordAgentTurn,
  saveConversationState,
  type ConversationTurn,
  type PatientConversationContext,
} from "./conversation-store";
import { actionTakenFor, analyzeTurn, buildAgentTurn } from "./conversation-reply";
import { translateText, verbxConfigured } from "./speech";
import {
  alreadyEnded,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/modules/conversation/language";
import type { ConversationAnalysis } from "@/modules/conversation/analysis";

export interface Actor {
  id: string;
  role: Role;
}

export interface CheckInRow {
  id: string;
  patient_id: string;
  status: string;
  scenario_id: string | null;
  channel: string;
  execution_mode: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DecisionRow {
  id: string;
  check_in_id: string;
  decision_type: string;
  decision_reason: string;
  rule_set_version: string;
  response_key?: string;
}

const RESPONSE_KEY_BY_DECISION: Record<string, string> = {
  log_adherence: "ack.taken",
  unreachable_escalation: "unreachable.end",
  symptom_escalation: "symptom.general_guidance",
  dosage_safety_response: "safety.dosage_block",
  emergency_guidance: "safety.emergency",
  clarification_required: "clarify.ask_again",
  unresolved: "consent.unavailable",
};

async function audit(
  actorId: string | null,
  eventType: AuditEventType,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await adminClient().from("audit_events").insert({
    actor_type: actorId ? "user" : "system",
    actor_id: actorId,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
  if (error) throw new ApiFailure("INTERNAL", "Failed to record audit event.", 500);
}

async function assignedPatientIds(actor: Actor): Promise<string[]> {
  if (actor.role === "super_admin") return [];
  const { data, error } = await adminClient()
    .from("caregiver_patient_assignments")
    .select("patient_id")
    .eq("caregiver_id", actor.id)
    .eq("is_active", true);
  if (error) throw new ApiFailure("INTERNAL", "Failed to load assignments.", 500);
  return (data ?? []).map((row) => row.patient_id as string);
}

export async function assertPatientAccess(actor: Actor, patientId: string): Promise<void> {
  const ids = await assignedPatientIds(actor);
  if (!canViewPatient({ role: actor.role, assignedPatientIds: ids, patientId })) {
    throw new ApiFailure("FORBIDDEN", "You are not authorized for this patient.", 403);
  }
}

async function loadCheckIn(actor: Actor, checkInId: string): Promise<CheckInRow> {
  const { data, error } = await adminClient()
    .from("check_ins")
    .select("id, patient_id, status, scenario_id, channel, execution_mode, started_at, completed_at, created_by, created_at")
    .eq("id", checkInId)
    .single();
  if (error || !data) throw new ApiFailure("NOT_FOUND", "Check-in not found.", 404);
  await assertPatientAccess(actor, data.patient_id);
  return data as CheckInRow;
}

async function currentConsent(patientId: string): Promise<ConsentSnapshot | null> {
  const { data } = await adminClient()
    .from("consents")
    .select("status, expires_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { status: data.status as ConsentSnapshot["status"], expiresAt: data.expires_at };
}

async function applyCheckInTransition<T extends CheckInRow>(
  row: T,
  to: CheckInState,
  patch: Record<string, unknown> = {},
): Promise<T> {
  const result = transitionCheckIn(row.status as CheckInState, to);
  if (!result.ok) {
    throw new ApiFailure("INVALID_STATE", `Cannot transition check-in from ${result.from} to ${result.to}.`, 409);
  }
  const { data, error } = await adminClient()
    .from("check_ins")
    .update({ status: to, ...patch })
    .eq("id", row.id)
    .select("id, patient_id, status, scenario_id, channel, execution_mode, started_at, completed_at, created_by, created_at")
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to update check-in.", 500);
  return data as T;
}

async function applyActionTransition(
  actionId: string,
  from: ActionState,
  to: ActionState,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const result = transitionAction(from, to);
  if (!result.ok) {
    throw new ApiFailure("INVALID_STATE", `Cannot transition action from ${result.from} to ${result.to}.`, 409);
  }
  const { data, error } = await adminClient()
    .from("actions")
    .update({ status: to, ...patch })
    .eq("id", actionId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiFailure("INTERNAL", "Failed to update action.", 500);
  if (!data) throw new ApiFailure("CONFLICT", "Action state changed concurrently.", 409);
}

export async function createCheckIn(
  actor: Actor,
  input: { patientId: string; scheduleId?: string; scenarioId?: string; channel: string },
): Promise<CheckInRow> {
  await assertPatientAccess(actor, input.patientId);

  const { data: patient } = await adminClient()
    .from("patients")
    .select("id, status")
    .eq("id", input.patientId)
    .single();
  if (!patient || patient.status !== "active") {
    throw new ApiFailure("INVALID_STATE", "Patient is not active.", 409);
  }

  const consent = await currentConsent(input.patientId);
  if (!isConsentValid(consent, new Date())) {
    throw new ApiFailure("CONSENT_INVALID", "Valid consent is required before a check-in.", 409);
  }

  const { data, error } = await adminClient()
    .from("check_ins")
    .insert({
      patient_id: input.patientId,
      schedule_id: input.scheduleId ?? null,
      scenario_id: input.scenarioId ?? null,
      channel: input.channel,
      execution_mode: "simulated",
      status: "ready",
      created_by: actor.id,
    })
    .select("id, patient_id, status, scenario_id, channel, execution_mode, started_at, completed_at, created_by, created_at")
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to create check-in.", 500);
  await audit(actor.id, "check_in.created", "check_in", data.id, { channel: input.channel });
  return data as CheckInRow;
}

export async function startCheckIn(actor: Actor, checkInId: string): Promise<CheckInRow> {
  const row = await loadCheckIn(actor, checkInId);
  if (row.status === "in_progress") return row;
  const updated = await applyCheckInTransition(row, "in_progress", { started_at: new Date().toISOString() });
  await audit(actor.id, "check_in.started", "check_in", row.id);
  return updated;
}

export interface SubmitInputResult {
  checkIn: CheckInRow;
  decision: {
    id: string;
    type: DecisionType;
    reasonCode: string;
    explanation: string;
    responseKey: string;
  };
  actionId: string | null;
  /** Agent reply for this turn (LLM-phrased or deterministic scripted). */
  replyText: string;
  /** One follow-up question before the call ends; null = close. */
  followUpQuestion: string | null;
  /** True when the deterministic conversation gate allows the call to end. */
  closing: boolean;
  /** Structured state after this turn; absent on no-answer decisions. */
  conversation?: { state: ConversationState; replySource: ReplySource };
}

export async function submitInput(
  actor: Actor,
  checkInId: string,
  input: {
    transcript: string;
    inputSource: "speech" | "typed" | "synthetic_fixture";
    language?: string;
  },
): Promise<SubmitInputResult> {
  let row = await loadCheckIn(actor, checkInId);
  if (row.status === "awaiting_clarification") {
    row = await applyCheckInTransition(row, "in_progress");
  }
  // Post-decision turns keep the safety conversation alive until every symptom
  // question is answered (or declined) and the gate allows closing.
  if (row.status === "escalated" || row.status === "awaiting_approval") {
    return continueConversation(actor, row, input);
  }
  if (row.status !== "in_progress") {
    throw new ApiFailure("INVALID_STATE", "Check-in must be in progress before input.", 409);
  }

  const previousState = await loadConversationState(row.id);
  const history = await loadHistory(row.id);
  const language = normalizeLanguage(input.language?.trim() || (await patientLanguage(row.patient_id)));
  const normalized = await normalizeTranscript(input.transcript, language, input.inputSource);
  const patientContext = await loadPatientConversationContext(row.patient_id, normalized.text);
  const deterministic = extractSignals(normalized.text);
  const analyzed = await analyzeTurn({
    firstName: patientContext.firstName,
    transcript: input.transcript,
    normalizedEnglish: normalized.text,
    language,
    history,
    previousState,
    signals: deterministic,
    inputSource: input.inputSource,
    simulatedNotificationSent: false,
  });
  const signals = mergeSignals(deterministic, analyzed.analysis);
  const conversationId = await storeConversationTurn(
    actor,
    row,
    input,
    language,
    normalized.text,
    normalized.translated,
    analyzed,
  );
  await storeSignals(actor, row, conversationId, signals, analyzed);

  return decideAndRoute(actor, row, signals, {
    conversationId,
    history,
    previousState,
    inputSource: input.inputSource,
    transcript: normalized.text,
    language,
    patientContext,
    analysis: analyzed.analysis,
    analysisSource: analyzed.source,
  });
}

interface ConversationContext {
  conversationId: string;
  history: ConversationTurn[];
  previousState: ConversationState;
  inputSource: "speech" | "typed" | "synthetic_fixture";
  transcript: string;
  language: SupportedLanguage;
  patientContext: PatientConversationContext;
  analysis: ConversationAnalysis;
  analysisSource: "llm" | "deterministic";
}

async function continueConversation(
  actor: Actor,
  row: CheckInRow,
  input: {
    transcript: string;
    inputSource: "speech" | "typed" | "synthetic_fixture";
    language?: string;
  },
): Promise<SubmitInputResult> {
  const previousState = await loadConversationState(row.id);
  const latest = await latestDecisionBrief(row.id);
  const language = normalizeLanguage(input.language?.trim() || (await patientLanguage(row.patient_id)));
  if (previousState.closed) {
    return {
      checkIn: row,
      decision: latest,
      actionId: null,
      replyText: alreadyEnded(language),
      followUpQuestion: null,
      closing: true,
      conversation: { state: previousState, replySource: "scripted" },
    };
  }

  const history = await loadHistory(row.id);
  const normalized = await normalizeTranscript(input.transcript, language, input.inputSource);
  const patientContext = await loadPatientConversationContext(row.patient_id, normalized.text);
  const deterministic = extractSignals(normalized.text);
  const analyzed = await analyzeTurn({
    firstName: patientContext.firstName,
    transcript: input.transcript,
    normalizedEnglish: normalized.text,
    language,
    history,
    previousState,
    signals: deterministic,
    inputSource: input.inputSource,
    simulatedNotificationSent: true,
  });
  const signals = mergeSignals(deterministic, analyzed.analysis);
  const conversationId = await storeConversationTurn(
    actor,
    row,
    input,
    language,
    normalized.text,
    normalized.translated,
    analyzed,
  );
  await storeSignals(actor, row, conversationId, signals, analyzed);

  // Reassess the whole conversation on every turn. The latest utterance must
  // never downgrade an earlier emergency, and a new red flag must upgrade a
  // routine/dosage/symptom call immediately.
  const cumulative = evaluateDecision({
    adherenceStatus:
      signals.adherenceStatus !== "unknown" ? signals.adherenceStatus : previousState.medicationStatus,
    symptoms: [...new Set([...previousState.symptoms, ...signals.symptoms])],
    dosageQuestion: signals.dosageQuestion || previousState.medicationQuestions.length > 0,
    needsClarification: false,
    noAnswerAttempts: 0,
    consentValid: true,
    emergency: signals.emergency || previousState.escalation === "emergency",
    notificationDestinationKey: `patient:${row.patient_id}`,
  });
  let decisionId = latest.id;
  let actionId: string | null = null;
  if (escalationPriority(cumulative.type) > escalationPriority(latest.type)) {
    actionId = await openEscalationUpgrade(actor, row, cumulative);
    const stored = await recordDecision(actor, row, cumulative);
    decisionId = stored.id;
  }
  await ensureConcernCoverage(actor, row, cumulative, signals);

  const next = advanceConversation(previousState, {
    transcript: normalized.text,
    signals,
    decision: cumulative.type,
    escalated: true,
    analysis: analyzed.analysis,
    analysisSource: analyzed.source,
    sourceTurnId: conversationId,
    language,
  });
  const agent = buildAgentTurn({
    firstName: patientContext.firstName,
    decisionType: cumulative.type,
    adherenceStatus: cumulative.type === "log_adherence" ? (signals.adherenceStatus !== "unknown" ? signals.adherenceStatus : previousState.medicationStatus) : signals.adherenceStatus,
    state: next.state,
    analysis: analyzed.analysis,
    analysisSource: analyzed.source,
    language,
    actionTaken: actionTakenFor(cumulative.type),
    isFollowUp: true,
    closing: next.closing,
    emergency: next.state.escalation === "emergency",
  });
  const followUpQuestion = next.followUpQuestion ?? agent.followUpQuestion;

  await recordAgentTurn(conversationId, agent.text, followUpQuestion);
  await saveConversationState(row.id, next.state, agent.source);
  await audit(actor.id, "conversation.state_updated", "check_in", row.id, {
    turn: next.state.turnCount,
    closing: next.closing,
    replySource: agent.source,
    analysisSource: analyzed.source,
    openQuestionCount: next.state.openQuestions.length,
    activeConcern: cumulative.type,
    activeConcerns: next.state.activeConcerns,
  });

  return {
    checkIn: row,
    decision: {
      id: decisionId,
      type: cumulative.type,
      reasonCode: cumulative.reasonCode,
      explanation: cumulative.explanation,
      responseKey: RESPONSE_KEY_BY_DECISION[cumulative.type] ?? cumulative.responseKey,
    },
    actionId,
    replyText: agent.text,
    followUpQuestion,
    closing: next.closing,
    conversation: { state: next.state, replySource: agent.source },
  };
}

async function recordDecision(
  actor: Actor,
  row: CheckInRow,
  decision: DecisionResult,
): Promise<{ id: string }> {
  const { data, error } = await adminClient()
    .from("decisions")
    .insert({
      check_in_id: row.id,
      rule_set_version: RULE_SET_VERSION,
      input_evidence_reference: `check_in:${row.id}`,
      decision_type: decision.type,
      decision_reason: `${decision.reasonCode}: ${decision.explanation}`,
      expected_outcome: decision.responseKey,
      decision_status: "recorded",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new ApiFailure("INTERNAL", "Failed to store decision.", 500);
  }
  await audit(actor.id, "decision.evaluated", "check_in", row.id, {
    decisionType: decision.type,
    reasonCode: decision.reasonCode,
    ruleSetVersion: decision.ruleSetVersion,
  });
  return data;
}

async function decideAndRoute(
  actor: Actor,
  row: CheckInRow,
  signals: ExtractedSignals,
  conversation?: ConversationContext,
): Promise<SubmitInputResult> {
  const consent = await currentConsent(row.patient_id);
  const consentValid = isConsentValid(consent, new Date());
  const noAnswerAttempts = await countNoAnswerAttempts(row.id);

  const decision = evaluateDecision({
    adherenceStatus: signals.adherenceStatus,
    symptoms: signals.symptoms,
    dosageQuestion: signals.dosageQuestion,
    needsClarification: signals.needsClarification,
    noAnswerAttempts,
    consentValid,
    emergency: signals.emergency,
    notificationDestinationKey: `patient:${row.patient_id}`,
  });

  const decisionRow = await recordDecision(actor, row, decision);

  let actionId: string | null = null;
  let checkIn = row;

  switch (decision.type) {
    case "clarification_required": {
      if (row.status === "in_progress") {
        checkIn = await applyCheckInTransition(row, "awaiting_clarification");
      }
      break;
    }
    case "log_adherence": {
      checkIn = await applyCheckInTransition(row, "completed", {
        completed_at: new Date().toISOString(),
      });
      await verifyReadBack(actor.id, checkIn.id, false);
      await audit(actor.id, "check_in.completed", "check_in", checkIn.id);
      break;
    }
    case "unresolved": {
      checkIn = await applyCheckInTransition(row, "unresolved");
      await audit(actor.id, "check_in.unresolved", "check_in", checkIn.id, { reason: decision.reasonCode });
      break;
    }
    // Escalation decisions: mock notification runs immediately (labelled
    // simulated) and an escalation case opens for human follow-up — no
    // approve-before-notify gate.
    case "dosage_safety_response":
    case "symptom_escalation":
    case "emergency_guidance":
    case "unreachable_escalation": {
      const actionType =
        decision.type === "dosage_safety_response" ? "request_human_review" : "notify_family";
      actionId = await createPendingAction(row, actionType, "pending", decision.responseKey);
      checkIn = await applyCheckInTransition(row, "processing_action");
      checkIn = await executeActionAndVerify(actionId, checkIn, decision.type);
      await createEscalationCase(actor, checkIn, actionId, decision.type, decision.explanation);
      break;
    }
    default: {
      const exhaustive: never = decision.type;
      throw new ApiFailure("INTERNAL", `Unhandled decision type: ${String(exhaustive)}`, 500);
    }
  }

  if (conversation) {
    await ensureConcernCoverage(actor, checkIn, decision, signals);
  }

  if (!conversation) {
    return {
      checkIn,
      decision: {
        id: decisionRow.id,
        type: decision.type,
        reasonCode: decision.reasonCode,
        explanation: decision.explanation,
        responseKey: RESPONSE_KEY_BY_DECISION[decision.type] ?? decision.responseKey,
      },
      actionId,
      replyText: decision.replyText,
      followUpQuestion: decision.followUpQuestion,
      closing: false,
    };
  }

  const next = advanceConversation(conversation.previousState, {
    transcript: conversation.transcript,
    signals,
    decision: decision.type,
    escalated: checkIn.status === "escalated" || checkIn.status === "awaiting_approval",
    analysis: conversation.analysis,
    analysisSource: conversation.analysisSource,
    sourceTurnId: conversation.conversationId,
    language: conversation.language,
  });
  const agent = buildAgentTurn({
    firstName: conversation.patientContext.firstName,
    decisionType: decision.type,
    adherenceStatus:
      signals.adherenceStatus !== "unknown"
        ? signals.adherenceStatus
        : conversation.previousState.medicationStatus,
    state: next.state,
    analysis: conversation.analysis,
    analysisSource: conversation.analysisSource,
    language: conversation.language,
    actionTaken: actionTakenFor(decision.type),
    isFollowUp: conversation.previousState.turnCount > 0,
    closing: next.closing,
    emergency: next.state.escalation === "emergency",
  });
  const followUpQuestion = next.followUpQuestion ?? agent.followUpQuestion;

  await recordAgentTurn(conversation.conversationId, agent.text, followUpQuestion);
  await saveConversationState(row.id, next.state, agent.source);
  await audit(actor.id, "conversation.state_updated", "check_in", row.id, {
    turn: next.state.turnCount,
    closing: next.closing,
    replySource: agent.source,
    analysisSource: conversation.analysisSource,
    openQuestionCount: next.state.openQuestions.length,
    activeConcerns: next.state.activeConcerns,
  });

  return {
    checkIn,
    decision: {
      id: decisionRow.id,
      type: decision.type,
      reasonCode: decision.reasonCode,
      explanation: decision.explanation,
      responseKey: RESPONSE_KEY_BY_DECISION[decision.type] ?? decision.responseKey,
    },
    actionId,
    replyText: agent.text,
    followUpQuestion,
    closing: next.closing,
    conversation: { state: next.state, replySource: agent.source },
  };
}

async function normalizeTranscript(
  transcript: string,
  language: SupportedLanguage,
  inputSource: "speech" | "typed" | "synthetic_fixture",
): Promise<{ text: string; translated: boolean }> {
  if (language === "en" || inputSource === "synthetic_fixture" || !verbxConfigured()) {
    return { text: transcript, translated: false };
  }
  const result = await translateText({ text: transcript, sourceLang: language, targetLang: "en" });
  return result.ok ? { text: result.value.text, translated: true } : { text: transcript, translated: false };
}

async function patientLanguage(patientId: string): Promise<string> {
  const { data } = await adminClient()
    .from("patients")
    .select("preferred_language")
    .eq("id", patientId)
    .single();
  return (data?.preferred_language as string | null) ?? "en";
}

async function storeConversationTurn(
  actor: Actor,
  row: CheckInRow,
  input: { transcript: string; inputSource: "speech" | "typed" | "synthetic_fixture" },
  language: SupportedLanguage,
  normalizedTranscript: string,
  translated: boolean,
  analyzed: { analysis: ConversationAnalysis; source: "llm" | "deterministic" },
): Promise<string> {
  const devanagari = /[\u0900-\u097F]/.test(input.transcript);
  const { data, error } = await adminClient()
    .from("conversation_records")
    .insert({
      check_in_id: row.id,
      input_source: input.inputSource,
      original_transcript: input.transcript,
      normalized_transcript: normalizedTranscript.trim().toLowerCase().replace(/\s+/g, " "),
      language_configured: language,
      language_detected: translated || devanagari ? language : language === "en" ? "en" : "unknown",
      extraction_status: "extracted",
      analysis: analyzed.analysis,
      analysis_source: analyzed.source,
    })
    .select("id")
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to store transcript.", 500);
  await audit(actor.id, "conversation.input_received", "check_in", row.id, {
    inputSource: input.inputSource,
    analysisSource: analyzed.source,
  });
  return data.id as string;
}

function mergeSignals(
  deterministic: ExtractedSignals,
  analysis: ConversationAnalysis,
): ExtractedSignals {
  const symptoms = [
    ...new Set([...deterministic.symptoms, ...analysis.symptoms.map((item) => item.code)]),
  ];
  const adherenceStatus =
    deterministic.adherenceStatus !== "unknown"
      ? deterministic.adherenceStatus
      : analysis.adherenceStatus;
  return {
    adherenceStatus,
    symptoms,
    dosageQuestion: deterministic.dosageQuestion || analysis.dosageQuestion,
    needsClarification:
      adherenceStatus === "unknown" && symptoms.length === 0 && deterministic.needsClarification,
    emergency: deterministic.emergency || analysis.emergency,
  };
}

async function storeSignals(
  actor: Actor,
  row: CheckInRow,
  conversationId: string,
  signals: ExtractedSignals,
  analyzed: { analysis: ConversationAnalysis; source: "llm" | "deterministic" },
): Promise<void> {
  const facts = [
    ...(signals.adherenceStatus !== "unknown"
      ? [{ kind: "adherence", value: signals.adherenceStatus }]
      : []),
    ...signals.symptoms.map((value) => ({
      kind: "symptom",
      value,
      severity: analyzed.analysis.symptoms.find((item) => item.code === value)?.severity ?? "unknown",
    })),
    ...(signals.dosageQuestion ? [{ kind: "dosage_question", value: "dosage_change_requested" }] : []),
    ...(signals.emergency ? [{ kind: "emergency", value: "emergency_reported" }] : []),
    ...analyzed.analysis.contradictions.map((value) => ({ kind: "contradiction", value })),
  ];
  const { error } = await adminClient().from("extracted_signals").insert({
    conversation_record_id: conversationId,
    adherence_status: signals.adherenceStatus,
    symptoms: signals.symptoms,
    dosage_question: signals.dosageQuestion,
    needs_clarification: signals.needsClarification,
    emergency: signals.emergency,
    extraction_source: analyzed.source === "llm" ? "llm_assisted" : "keyword_en_v1",
    facts,
  });
  if (error) throw new ApiFailure("INTERNAL", "Failed to store signals.", 500);
  await audit(actor.id, "signals.extracted", "check_in", row.id, {
    adherenceStatus: signals.adherenceStatus,
    symptomCount: signals.symptoms.length,
    dosageQuestion: signals.dosageQuestion,
    analysisSource: analyzed.source,
  });
}

async function latestDecisionBrief(checkInId: string): Promise<SubmitInputResult["decision"]> {
  const { data } = await adminClient()
    .from("decisions")
    .select("id, decision_type, decision_reason, expected_outcome")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    id: (data?.id as string) ?? "",
    type: (data?.decision_type as DecisionType) ?? "unresolved",
    reasonCode: "",
    explanation: (data?.decision_reason as string) ?? "",
    responseKey: (data?.expected_outcome as string) ?? "",
  };
}

async function createEscalationCase(
  actor: Actor,
  checkIn: CheckInRow,
  actionId: string,
  decisionType: string,
  reason: string,
): Promise<void> {
  const category = categoryForDecision(decisionType);
  if (!category) return;
  const { data: existing } = await adminClient()
    .from("escalation_cases")
    .select("id")
    .eq("check_in_id", checkIn.id)
    .eq("category", category)
    .maybeSingle();
  if (existing) return;
  const { data: event } = await adminClient()
    .from("notification_events")
    .select("status")
    .eq("action_id", actionId)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await adminClient()
    .from("escalation_cases")
    .insert({
      patient_id: checkIn.patient_id,
      check_in_id: checkIn.id,
      action_id: actionId,
      category,
      severity: severityForDecision(decisionType),
      reason,
      evidence_reference: `check_in:${checkIn.id}`,
      notification_status: event?.status === "simulated" ? "notified" : "notification_unknown",
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to create escalation case.", 500);
  await audit(actor.id, "case.created", "case", data.id, { category, decisionType });
}

async function countNoAnswerAttempts(checkInId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from("call_attempts")
    .select("id", { count: "exact", head: true })
    .eq("check_in_id", checkInId)
    .eq("outcome", "simulated_no_answer");
  if (error) throw new ApiFailure("INTERNAL", "Failed to count call attempts.", 500);
  return count ?? 0;
}

async function createPendingAction(
  row: CheckInRow,
  actionType: "notify_family" | "request_human_review",
  status: "pending" | "approval_required",
  messageKey: string,
  purpose?: string,
): Promise<string> {
  const idempotencyKey = actionIdempotencyKey({
    checkInId: row.id,
    actionType,
    destinationKey: `patient:${row.patient_id}`,
    purpose,
  });
  const { data: existing } = await adminClient()
    .from("actions")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data, error } = await adminClient()
    .from("actions")
    .insert({
      check_in_id: row.id,
      action_type: actionType,
      execution_mode: "simulated",
      status,
      idempotency_key: idempotencyKey,
      destination_reference: `patient:${row.patient_id}`,
      payload_reference: messageKey,
    })
    .select("id")
    .single();
  if (error || !data) throw new ApiFailure("INTERNAL", "Failed to create action.", 500);
  return data.id as string;
}

export async function recordNoAnswer(actor: Actor, checkInId: string): Promise<SubmitInputResult> {
  const row = await loadCheckIn(actor, checkInId);
  if (row.status !== "in_progress") {
    throw new ApiFailure("INVALID_STATE", "Check-in must be in progress to record a call attempt.", 409);
  }

  const attempts = await countNoAnswerAttempts(row.id);
  const { error } = await adminClient().from("call_attempts").insert({
    check_in_id: row.id,
    attempt_number: attempts + 1,
    provider_name: "mock",
    outcome: "simulated_no_answer",
    execution_mode: "simulated",
  });
  if (error) throw new ApiFailure("INTERNAL", "Failed to record call attempt.", 500);

  const total = attempts + 1;
  if (total < 2) {
    return {
      checkIn: row,
      decision: {
        id: "",
        type: "clarification_required",
        reasonCode: "NO_ANSWER_RETRY",
        explanation: `Attempt ${total} of 2 recorded. Not yet unreachable.`,
        responseKey: "clarify.ask_again",
      },
      actionId: null,
      replyText: "We could not reach you just now. We will try once more.",
      followUpQuestion: null,
      closing: false,
    };
  }

  const signals: ExtractedSignals = {
    adherenceStatus: "unknown",
    symptoms: [],
    dosageQuestion: false,
    // Attempts are already counted inside decideAndRoute; let the threshold branch fire.
    needsClarification: false,
    emergency: false,
  };
  return decideAndRoute(actor, { ...row, status: "in_progress" }, signals);
}

async function deliverAction(actionId: string, decisionType: DecisionType): Promise<void> {
  const { data: action } = await adminClient()
    .from("actions")
    .select("id, status, check_in_id, destination_reference, payload_reference")
    .eq("id", actionId)
    .single();
  if (!action) throw new ApiFailure("NOT_FOUND", "Action not found.", 404);

  await applyActionTransition(actionId, action.status as ActionState, "executing", {
    attempt_count: 1,
  });
  await audit(null, "action.started", "action", actionId, { executionMode: "simulated" });

  const result = await mockNotificationProvider.send({
    actionId,
    destinationKey: (action.destination_reference as string) ?? "unassigned",
    messageKey: (action.payload_reference as string) ?? "notice.generic",
    explanation: "",
    priority: decisionType === "log_adherence" ? "routine" : "urgent",
  });

  const { error: eventError } = await adminClient().from("notification_events").insert({
    action_id: actionId,
    provider_name: result.providerName,
    provider_message_id: result.providerMessageId,
    status: result.status,
    confirmed_at: null,
  });
  if (eventError) throw new ApiFailure("INTERNAL", "Failed to record notification event.", 500);

  await applyActionTransition(actionId, "executing", "succeeded", {
    provider_reference: result.providerMessageId,
  });
  await audit(null, "action.succeeded", "action", actionId, { providerStatus: result.status });
}

/**
 * A dosage question and a symptom can coexist. Keep a separate
 * action/case for each concern so neither is hidden by the other.
 */
async function ensureConcernCoverage(
  actor: Actor,
  row: CheckInRow,
  decision: DecisionResult,
  signals: ExtractedSignals,
): Promise<void> {
  if (decision.type === "emergency_guidance") return;
  const targets: Array<"symptom_escalation" | "dosage_safety_response"> = [];
  if (signals.symptoms.length > 0) targets.push("symptom_escalation");
  if (signals.dosageQuestion) targets.push("dosage_safety_response");

  for (const target of targets) {
    if (target === decision.type) continue;
    const category = categoryForDecision(target);
    if (!category) continue;
    const { data: existing } = await adminClient()
      .from("escalation_cases")
      .select("id")
      .eq("check_in_id", row.id)
      .eq("category", category)
      .maybeSingle();
    if (existing) continue;
    const concern = evaluateDecision({
      adherenceStatus: "unknown",
      symptoms: target === "symptom_escalation" ? signals.symptoms : [],
      dosageQuestion: target === "dosage_safety_response",
      needsClarification: false,
      noAnswerAttempts: 0,
      consentValid: true,
      emergency: false,
      notificationDestinationKey: `patient:${row.patient_id}`,
    });
    await openEscalationUpgrade(actor, row, concern);
  }
}

/**
 * A higher-priority concern surfaced after the call had already escalated.
 * Open a new action/case for the new severity without reopening the check-in.
 */
async function openEscalationUpgrade(
  actor: Actor,
  row: CheckInRow,
  decision: DecisionResult,
): Promise<string> {
  const actionType =
    decision.type === "dosage_safety_response" ? "request_human_review" : "notify_family";
  const actionId = await createPendingAction(
    row,
    actionType,
    "pending",
    decision.responseKey,
    decision.type,
  );
  await deliverAction(actionId, decision.type);
  await createEscalationCase(actor, row, actionId, decision.type, decision.explanation);
  await audit(actor.id, "escalation.upgraded", "check_in", row.id, {
    decisionType: decision.type,
    reasonCode: decision.reasonCode,
  });
  return actionId;
}

export async function executeActionAndVerify(
  actionId: string,
  checkIn: CheckInRow,
  decisionType: DecisionType,
): Promise<CheckInRow> {
  await deliverAction(actionId, decisionType);
  let updated = await applyCheckInTransition(checkIn, "verifying");
  updated = await verifyReadBack(null, updated.id, true, decisionType);
  return updated;
}

export async function verifyReadBack(
  actorId: string | null,
  checkInId: string,
  expectAction: boolean,
  decisionType?: DecisionType,
): Promise<CheckInRow> {
  const admin = adminClient();
  const { data: decision } = await admin
    .from("decisions")
    .select("id, decision_type")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: action } = await admin
    .from("actions")
    .select("id, status")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let notificationStatus: string | null = null;
  if (action) {
    const { data: event } = await admin
      .from("notification_events")
      .select("status")
      .eq("action_id", action.id)
      .order("attempted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    notificationStatus = (event?.status as string | null) ?? null;
  }

  const observed = {
    decisionExists: Boolean(decision),
    decisionType: (decision?.decision_type as string | null) ?? null,
    actionStatus: (action?.status as string | null) ?? null,
    notificationStatus,
  };
  const expected = {
    decisionExists: true,
    actionStatus: expectAction ? "succeeded" : null,
    notificationStatus: expectAction ? "simulated" : null,
  };
  const passed =
    observed.decisionExists &&
    (!expectAction || (observed.actionStatus === "succeeded" && observed.notificationStatus === "simulated"));

  const { error } = await admin.from("verification_records").insert({
    check_in_id: checkInId,
    action_id: (action?.id as string | null) ?? null,
    verification_type: "db_read_back",
    expected_state: expected,
    observed_state: observed,
    result: passed ? "passed" : "failed",
    evidence_reference: `check_in:${checkInId}`,
  });
  if (error) throw new ApiFailure("INTERNAL", "Failed to record verification.", 500);
  await audit(actorId, passed ? "verification.passed" : "verification.failed", "check_in", checkInId, {
    observed,
  });

  const { data: checkIn } = await admin
    .from("check_ins")
    .select("id, patient_id, status, scenario_id, channel, execution_mode, started_at, completed_at, created_by, created_at")
    .eq("id", checkInId)
    .single();
  if (!checkIn) throw new ApiFailure("NOT_FOUND", "Check-in not found.", 404);

  const finalState: CheckInState = passed
    ? decisionType && decisionType !== "log_adherence"
      ? "escalated"
      : "completed"
    : "failed";

  if ((checkIn.status as CheckInState) !== finalState) {
    const patch =
      finalState === "completed" ? { completed_at: new Date().toISOString() } : {};
    return applyCheckInTransition(checkIn as CheckInRow, finalState, patch);
  }
  return checkIn as CheckInRow;
}

export { loadCheckIn, applyActionTransition, applyCheckInTransition, audit };

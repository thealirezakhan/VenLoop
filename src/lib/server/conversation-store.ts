import { adminClient } from "./admin";
import { ApiFailure } from "./failures";
import {
  emptyConversationState,
  parseConversationState,
  type ConversationState,
  type ReplySource,
} from "@/modules/conversation/state";
import {
  rankGuidance,
  type GuidanceSnippet,
} from "@/modules/conversation/guidance";

export interface ConversationTurn {
  transcript: string;
  agentReply: string | null;
  followUpQuestion: string | null;
}

export interface PatientConversationContext {
  firstName: string;
  medications: string[];
  guidance: GuidanceSnippet[];
}

export async function loadConversationState(checkInId: string): Promise<ConversationState> {
  const { data, error } = await adminClient()
    .from("conversation_states")
    .select("state")
    .eq("check_in_id", checkInId)
    .maybeSingle();
  if (error) throw new ApiFailure("INTERNAL", "Failed to load conversation state.", 500);
  return data ? parseConversationState(data.state) : emptyConversationState();
}

export async function saveConversationState(
  checkInId: string,
  state: ConversationState,
  replySource: ReplySource,
): Promise<void> {
  const { error } = await adminClient().from("conversation_states").upsert(
    {
      check_in_id: checkInId,
      state,
      turn_count: state.turnCount,
      reply_source: replySource,
    },
    { onConflict: "check_in_id" },
  );
  if (error) throw new ApiFailure("INTERNAL", "Failed to store conversation state.", 500);
}

export async function loadHistory(checkInId: string, limit = 6): Promise<ConversationTurn[]> {
  const { data, error } = await adminClient()
    .from("conversation_records")
    .select("original_transcript, agent_reply, follow_up_question, created_at")
    .eq("check_in_id", checkInId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ApiFailure("INTERNAL", "Failed to load conversation history.", 500);
  return (data ?? [])
    .reverse()
    .map((row) => ({
      transcript: (row.original_transcript as string | null) ?? "",
      agentReply: (row.agent_reply as string | null) ?? null,
      followUpQuestion: (row.follow_up_question as string | null) ?? null,
    }));
}

export async function recordAgentTurn(
  conversationRecordId: string,
  replyText: string,
  followUpQuestion: string | null,
): Promise<void> {
  const { error } = await adminClient()
    .from("conversation_records")
    .update({ agent_reply: replyText, follow_up_question: followUpQuestion })
    .eq("id", conversationRecordId);
  if (error) throw new ApiFailure("INTERNAL", "Failed to store agent reply.", 500);
}

export async function loadPatientConversationContext(
  patientId: string,
  query: string,
): Promise<PatientConversationContext> {
  const admin = adminClient();
  const [{ data: patient, error: patientError }, { data: medications, error: medError }] =
    await Promise.all([
      admin.from("patients").select("display_name").eq("id", patientId).single(),
      admin
        .from("medications")
        .select("name")
        .eq("patient_id", patientId)
        .eq("status", "active"),
    ]);
  if (patientError || !patient) {
    throw new ApiFailure("INTERNAL", "Failed to load patient context.", 500);
  }
  if (medError) throw new ApiFailure("INTERNAL", "Failed to load medications.", 500);

  const names = (medications ?? []).map((row) => row.name as string);
  const { data: guidanceRows, error: guidanceError } = await admin
    .from("medication_guidance")
    .select("medication_name, title, guidance, source_label")
    .eq("approved", true);
  if (guidanceError) {
    throw new ApiFailure("INTERNAL", "Failed to load approved guidance.", 500);
  }

  const snippets: GuidanceSnippet[] = (guidanceRows ?? []).map((row) => ({
    medicationName: row.medication_name as string,
    title: row.title as string,
    guidance: row.guidance as string,
    sourceLabel: row.source_label as string,
  }));

  const fullName = (patient.display_name as string).trim();
  return {
    firstName: fullName.split(/\s+/)[0] ?? fullName,
    medications: names,
    guidance: rankGuidance(snippets, query, names),
  };
}

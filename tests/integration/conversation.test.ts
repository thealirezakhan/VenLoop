import { describe, expect, it } from "vitest";
import { adminClient } from "@/lib/server/admin";
import {
  createCheckIn,
  startCheckIn,
  submitInput,
  type Actor,
} from "@/lib/server/check-ins";

const adminActor: Actor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "super_admin",
};

const dbConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

async function patientId(name: string): Promise<string> {
  const { data } = await adminClient().from("patients").select("id").eq("display_name", name).single();
  expect(data?.id).toBeTruthy();
  return data!.id as string;
}

describe.skipIf(!dbConfigured)("multi-turn conversation pipeline", () => {
  it("keeps the call open for nausea details, then closes naturally", async () => {
    const checkIn = await createCheckIn(adminActor, {
      patientId: await patientId("Eleanor Davis"),
      channel: "manual_test",
    });
    await startCheckIn(adminActor, checkIn.id);

    const first = await submitInput(adminActor, checkIn.id, {
      transcript: "I feel a bit nauseous today.",
      inputSource: "synthetic_fixture",
    });
    expect(first.decision.type).toBe("symptom_escalation");
    expect(first.closing).toBe(false);
    expect(first.followUpQuestion).toMatch(/when did the nausea start/i);
    expect(first.conversation?.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(first.conversation?.replySource).toBe("scripted");

    const second = await submitInput(adminActor, checkIn.id, {
      transcript: "It started this morning and I am not vomiting.",
      inputSource: "synthetic_fixture",
    });
    expect(second.closing).toBe(true);
    expect(second.followUpQuestion).toBeNull();
    expect(second.replyText).toMatch(/goodbye/i);
    expect(second.conversation?.state.addressedSymptoms).toEqual(["nausea_or_vomiting"]);
    expect(second.conversation?.state.severeSymptoms).toEqual([]);
    expect(second.conversation?.state.endReason).toBe("escalated");
    expect(second.conversation?.state.facts.some((fact) => fact.kind === "symptom")).toBe(true);

    const { data: turns } = await adminClient()
      .from("conversation_records")
      .select("agent_reply, follow_up_question, analysis, analysis_source, language_configured")
      .eq("check_in_id", checkIn.id)
      .order("created_at");
    expect(turns).toHaveLength(2);
    expect(turns?.every((row) => Boolean(row.agent_reply))).toBe(true);
    expect(turns?.[0]?.analysis_source).toBe("deterministic");
    expect(turns?.[0]?.language_configured).toBe("en");
    expect(turns?.[0]?.analysis).toBeTruthy();

    const { data: stored } = await adminClient()
      .from("conversation_states")
      .select("turn_count, state")
      .eq("check_in_id", checkIn.id)
      .single();
    expect(stored?.turn_count).toBe(2);
    expect((stored?.state as { closed?: boolean }).closed).toBe(true);
    const state = stored?.state as {
      activeConcerns?: string[];
      facts?: { sourceTurnId?: string }[];
      analysisSource?: string;
    };
    expect(state.activeConcerns).toEqual(expect.arrayContaining(["symptom_assessment"]));
    expect(state.analysisSource).toBe("deterministic");
    expect(state.facts?.every((fact) => Boolean(fact.sourceTurnId))).toBe(true);

    const { data: cases } = await adminClient()
      .from("escalation_cases")
      .select("category")
      .eq("check_in_id", checkIn.id);
    expect(cases?.[0]?.category).toBe("symptom");
  });

  it("keeps dosage and symptom concerns separate and merges fever from a later turn", async () => {
    const checkIn = await createCheckIn(adminActor, {
      patientId: await patientId("Eleanor Davis"),
      channel: "manual_test",
    });
    await startCheckIn(adminActor, checkIn.id);

    const first = await submitInput(adminActor, checkIn.id, {
      transcript: "I took my pill but I feel like vomiting. Should I take another pill?",
      inputSource: "synthetic_fixture",
    });
    expect(first.decision.type).toBe("dosage_safety_response");
    expect(first.closing).toBe(false);
    expect(first.followUpQuestion).toMatch(/nausea/i);
    expect(first.conversation?.state.symptoms).toEqual(["nausea_or_vomiting"]);
    expect(first.conversation?.state.medicationStatus).toBe("reported_taken");
    expect(first.conversation?.state.medicationQuestions).toEqual(["dosage_change_requested"]);
    expect(first.conversation?.state.activeConcerns).toEqual(
      expect.arrayContaining(["dosage_safety", "symptom_assessment"]),
    );

    const { data: cases } = await adminClient()
      .from("escalation_cases")
      .select("category")
      .eq("check_in_id", checkIn.id)
      .order("created_at");
    expect(cases?.map((row) => row.category)).toEqual(["dosage_question", "symptom"]);

    const second = await submitInput(adminActor, checkIn.id, {
      transcript: "I think I have mild fever too.",
      inputSource: "synthetic_fixture",
    });
    expect(second.closing).toBe(false);
    expect(second.conversation?.state.symptoms).toEqual([
      "nausea_or_vomiting",
      "possible_fever",
    ]);
    expect(second.conversation?.state.addressedSymptoms).toEqual([]);
    expect(second.conversation?.state.medicationStatus).toBe("reported_taken");
    expect(second.conversation?.state.medicationQuestions).toEqual(["dosage_change_requested"]);
    expect(second.followUpQuestion).toMatch(/nausea/i);
  });

  it("returns localized safety replies and persists the selected language", async () => {
    const checkIn = await createCheckIn(adminActor, {
      patientId: await patientId("Ramesh Patel"),
      channel: "manual_test",
    });
    await startCheckIn(adminActor, checkIn.id);

    const result = await submitInput(adminActor, checkIn.id, {
      transcript: "Should I take two pills instead?",
      inputSource: "synthetic_fixture",
      language: "hi-IN",
    });
    expect(result.decision.type).toBe("dosage_safety_response");
    expect(result.replyText).toMatch(/[\u0900-\u097F]/);
    expect(result.followUpQuestion).toMatch(/[\u0900-\u097F]/);

    const { data: stored } = await adminClient()
      .from("conversation_records")
      .select("language_configured, language_detected, agent_reply")
      .eq("check_in_id", checkIn.id)
      .single();
    expect(stored?.language_configured).toBe("hi");
    expect(stored?.agent_reply).toBe(result.replyText);
  });

  it("reassesses every turn and upgrades a symptom call to emergency", async () => {
    const checkIn = await createCheckIn(adminActor, {
      patientId: await patientId("Eleanor Davis"),
      channel: "manual_test",
    });
    await startCheckIn(adminActor, checkIn.id);

    const first = await submitInput(adminActor, checkIn.id, {
      transcript: "I feel dizzy today.",
      inputSource: "synthetic_fixture",
    });
    expect(first.decision.type).toBe("symptom_escalation");
    expect(first.checkIn.status).toBe("escalated");

    const second = await submitInput(adminActor, checkIn.id, {
      transcript: "It is worse and I have trouble breathing. Should I take another dose?",
      inputSource: "synthetic_fixture",
    });
    expect(second.decision.type).toBe("emergency_guidance");
    expect(second.closing).toBe(true);
    expect(second.replyText).toMatch(/emergency services/i);
    expect(second.conversation?.state.escalation).toBe("emergency");
    expect(second.actionId).toBeTruthy();

    const { data: cases } = await adminClient()
      .from("escalation_cases")
      .select("category, severity")
      .eq("check_in_id", checkIn.id)
      .order("created_at");
    expect(cases?.map((row) => row.category)).toEqual(["symptom", "emergency"]);
    expect(cases?.[1]?.severity).toBe(3);

    const { data: actions } = await adminClient()
      .from("actions")
      .select("id, idempotency_key")
      .eq("check_in_id", checkIn.id);
    expect(actions).toHaveLength(2);
    expect(actions?.filter((row) => row.idempotency_key.endsWith(":emergency_guidance"))).toHaveLength(1);
  });
});

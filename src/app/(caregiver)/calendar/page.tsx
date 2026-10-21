import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CalendarView, type CalendarCheckIn } from "@/components/calendar-view";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const since = new Date();
  since.setDate(since.getDate() - 120);

  const [patients, schedules, checkIns] = await Promise.all([
    supabase
      .from("patients")
      .select("id, display_name, conditions, risk_level, date_of_birth, timezone")
      .order("display_name"),
    supabase
      .from("medication_schedules")
      .select("id, patient_id, display_name, scheduled_local_time, timezone")
      .eq("is_active", true)
      .order("scheduled_local_time"),
    supabase
      .from("check_ins")
      .select(
        "id, patient_id, schedule_id, status, channel, created_at, decisions(decision_type, decision_reason), conversation_records(original_transcript), escalation_cases(category, severity, acknowledgement_status, resolution_status)",
      )
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }),
  ]);

  return (
    <CalendarView
      patients={patients.data ?? []}
      schedules={schedules.data ?? []}
      checkIns={(checkIns.data ?? []) as unknown as CalendarCheckIn[]}
    />
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, EmptyState, PageHeader, SectionCard, StatusBadge } from "@/components/ui/kit";
import { ageFrom, formatTime, humanAgo } from "@/lib/format";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { q } = await searchParams;
  const term = (q ?? "").trim().slice(0, 80);

  let query = supabase
    .from("patients")
    .select("id, display_name, timezone, preferred_language, status, date_of_birth, phone, mrn, conditions, primary_provider, risk_level")
    .order("display_name");
  if (term) query = query.ilike("display_name", `%${term}%`);

  const [patients, schedules, checkIns, cases] = await Promise.all([
    query,
    supabase
      .from("medication_schedules")
      .select("id, patient_id, display_name, scheduled_local_time")
      .eq("is_active", true)
      .order("scheduled_local_time"),
    supabase
      .from("check_ins")
      .select("id, patient_id, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("escalation_cases")
      .select("id, patient_id, resolution_status"),
  ]);

  const rows = patients.data ?? [];
  const openCases = (cases.data ?? []).filter((c) => c.resolution_status !== "resolved_reported");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Care cohort"
        title="Patients"
        subtitle={`${rows.length} ${rows.length === 1 ? "patient" : "patients"} assigned to your care loop${term ? ` · filtered by “${term}”` : ""}.`}
        actions={
          <Link href="/calendar" className="neo-btn h-9">
            <Icon name="calendar" size={14} />
            Care calendar
          </Link>
        }
      />

      {rows.length === 0 ? (
        <SectionCard>
          <EmptyState>
            {term ? `No patients match “${term}”.` : "No patients assigned to you."}{" "}
            {term ? (
              <Link href="/patients" className="font-bold underline">
                Clear search
              </Link>
            ) : null}
          </EmptyState>
        </SectionCard>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((patient) => {
            const latest = (checkIns.data ?? []).find((c) => c.patient_id === patient.id);
            const open = openCases.filter((c) => c.patient_id === patient.id).length;
            const next = (schedules.data ?? []).find((s) => s.patient_id === patient.id);
            const tone = patient.risk_level === "high" ? "rose" : patient.risk_level === "medium" ? "butter" : "sage";
            return (
              <SectionCard key={patient.id} className="shadow-tactile-sm" bodyClassName="p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={patient.display_name} size={44} tone={tone} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/patients/${patient.id}`} className="block truncate font-display text-[15px] font-bold hover:underline">
                      {patient.display_name}
                    </Link>
                    <div className="text-[10px] text-ink-muted">
                      {patient.mrn ?? "no MRN"} · {ageFrom(patient.date_of_birth) ?? "?"} yrs · {patient.timezone}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone={tone}>{patient.risk_level ?? "low"} risk</Badge>
                      <StatusBadge status={latest?.status ?? "no record"} />
                      {open > 0 ? <Badge tone="rose">{open} open</Badge> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-[10.5px] text-ink-soft">
                  <div className="flex items-center gap-1.5">
                    <Icon name="stethoscope" size={12} />
                    <span className="truncate">{(patient.conditions ?? []).join(" / ") || "No conditions recorded"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Icon name="phone" size={12} />
                    <span>{patient.phone ?? "No phone recorded"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Icon name="clock" size={12} />
                    <span>
                      {next ? `Next window ${formatTime(`2026-01-01T${next.scheduled_local_time}`)} · ${next.display_name}` : "No active schedule"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2">
                  <span
                    suppressHydrationWarning
                    className="text-[9.5px] font-semibold text-ink-muted uppercase"
                  >
                    {latest ? `Last call ${humanAgo(latest.created_at)}` : "No calls recorded"}
                  </span>
                  <Link href={`/patients/${patient.id}`} className="flex items-center gap-1 text-[10px] font-bold uppercase">
                    Open record <Icon name="arrowRight" size={11} />
                  </Link>
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

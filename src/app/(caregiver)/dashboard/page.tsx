import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, Bar, EmptyState, PageHeader, SectionCard, StatCard, StatusBadge, statusTone } from "@/components/ui/kit";
import { ageFrom, dayKey, formatDate, formatTime, humanAgo } from "@/lib/format";

interface PatientLite {
  id: string;
  display_name: string;
  date_of_birth: string | null;
  conditions: string[] | null;
  risk_level: string | null;
}

interface CheckInRow {
  id: string;
  status: string;
  channel: string;
  created_at: string;
  patient_id: string;
  patients: PatientLite | null;
  decisions: { decision_type: string; decision_reason: string }[] | null;
  escalation_cases: {
    id: string;
    category: string;
    severity: number;
    status: string;
    reason: string;
    acknowledgement_status: string;
    resolution_status: string;
  }[] | null;
  conversation_records: { original_transcript: string | null }[] | null;
}

interface CaseRow {
  id: string;
  patient_id: string;
  category: string;
  severity: number;
  reason: string;
  status: string;
  acknowledgement_status: string;
  resolution_status: string;
  created_at: string;
  patient: { display_name: string } | null;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [profile, patients, checkIns, cases, schedules, verifications] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", auth.user.id).single(),
    supabase.from("patients").select("id, display_name, date_of_birth, conditions, risk_level").order("display_name"),
    supabase
      .from("check_ins")
      .select(
        "id, status, channel, created_at, patient_id, patients(id, display_name, date_of_birth, conditions, risk_level), decisions(decision_type, decision_reason), escalation_cases(id, category, severity, status, reason, acknowledgement_status, resolution_status), conversation_records(original_transcript)",
      )
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("escalation_cases")
      .select("id, patient_id, category, severity, reason, status, acknowledgement_status, resolution_status, created_at, patient:patients(display_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("medication_schedules")
      .select("id, patient_id, display_name, scheduled_local_time, timezone, patients(display_name)")
      .eq("is_active", true)
      .order("scheduled_local_time"),
    supabase.from("verification_records").select("id, result"),
  ]);

  const rows = (checkIns.data ?? []) as unknown as CheckInRow[];
  const allCases = (cases.data ?? []) as unknown as CaseRow[];
  const openCases = allCases.filter((c) => c.resolution_status !== "resolved_reported");
  const unacknowledged = openCases.filter((c) => c.acknowledgement_status === "pending");
  const patientRows = patients.data ?? [];
  const highRisk = patientRows.filter((p) => p.risk_level === "high").length;
  const today = dayKey(new Date());
  const todayRows = rows.filter((row) => dayKey(row.created_at) === today);
  const completed = rows.filter((row) => row.status === "completed").length;
  const escalated = rows.filter((row) => row.status === "escalated").length;
  const unresolved = rows.filter((row) => row.status === "unresolved").length;
  const failedVerifications = (verifications.data ?? []).filter((v) => v.result === "failed").length;
  const first = profile.data?.display_name?.split(" ")[0] ?? "there";

  const watchlist = patientRows
    .map((patient) => {
      const latest = rows.find((row) => row.patient_id === patient.id);
      const open = openCases.filter((c) => c.patient_id === patient.id);
      return { patient, latest, openCount: open.length };
    })
    .sort((a, b) => {
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (rank[a.patient.risk_level ?? "low"] ?? 3) - (rank[b.patient.risk_level ?? "low"] ?? 3);
    })
    .slice(0, 6);

  const schedulesByPatient = new Map<string, typeof schedules.data>();
  for (const schedule of schedules.data ?? []) {
    const list = schedulesByPatient.get(schedule.patient_id) ?? [];
    list.push(schedule);
    schedulesByPatient.set(schedule.patient_id, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Caregiver overview dashboard"
        title="Overview"
        subtitle={
          <>
            Good morning, {first}. {patientRows.length} people in the care loop ·{" "}
            {todayRows.length} check-ins recorded today. All numbers come from persisted records.
          </>
        }
        actions={
          <>
            <Link href="/calendar" className="neo-btn h-9">
              <Icon name="calendar" size={14} />
              Care calendar
            </Link>
            <Link href="/cases" className="neo-btn neo-btn-dark h-9">
              <Icon name="alert" size={14} />
              Review {openCases.length} open
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard
          label="Assigned patients"
          value={patientRows.length}
          hint={`${highRisk} high-risk · ${patientRows.length - highRisk} routine`}
          icon="users"
          tone="sage"
        />
        <StatCard
          label="Check-ins recorded"
          value={rows.length}
          hint={`${completed} completed · ${todayRows.length} today`}
          icon="phone"
          tone="sky"
        />
        <StatCard
          label="Open escalations"
          value={openCases.length}
          hint={`${unacknowledged.length} awaiting acknowledgement`}
          icon="alert"
          tone="rose"
        />
        <StatCard
          label="Unresolved / no answer"
          value={unresolved}
          hint={`${escalated} escalated · ${failedVerifications} failed verification`}
          icon="phoneOff"
          tone="butter"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard
            title="Live care activity & call stream"
            eyebrow="Newest first"
            action={
              <span suppressHydrationWarning className="text-[10px] font-semibold text-ink-muted">
                {rows.length === 0 ? "no calls yet" : `updated ${humanAgo(rows[0].created_at)}`}
              </span>
            }
            bodyClassName="p-3"
          >
            {rows.length === 0 ? (
              <EmptyState>
                No calls recorded yet. Run a scenario from the call simulator to populate the care stream.
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-2.5">
                {rows.slice(0, 6).map((row) => (
                  <ActivityCard key={row.id} row={row} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Priority patient watchlist"
            eyebrow="Risk first"
            action={
              <Link href="/patients" className="flex items-center gap-1 text-[10px] font-bold uppercase">
                All patients <Icon name="arrowRight" size={12} />
              </Link>
            }
            bodyClassName="p-0 overflow-x-auto"
          >
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Condition</th>
                  <th>Last reported</th>
                  <th>Open alert</th>
                  <th>Next contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {watchlist.map(({ patient, latest, openCount }) => {
                  const next = schedulesByPatient.get(patient.id)?.[0];
                  return (
                    <tr key={patient.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={patient.display_name} size={28} tone={patient.risk_level === "high" ? "rose" : "sage"} />
                          <div>
                            <Link href={`/patients/${patient.id}`} className="font-bold hover:underline">
                              {patient.display_name}
                            </Link>
                            <div className="text-[10px] text-ink-muted">
                              {ageFrom(patient.date_of_birth) ? `${ageFrom(patient.date_of_birth)} yrs` : "age unknown"} ·{" "}
                              {patient.risk_level ?? "low"} risk
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[180px] text-[11px] text-ink-soft">
                        {(patient.conditions ?? []).join(" / ") || "Not recorded"}
                      </td>
                      <td>
                        {latest ? (
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={latest.status} />
                            <span className="text-[10px] text-ink-muted">{formatDate(latest.created_at)}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-ink-muted">No record</span>
                        )}
                      </td>
                      <td>
                        {openCount > 0 ? (
                          <Badge tone="rose">{openCount} open</Badge>
                        ) : (
                          <span className="text-[10px] text-ink-muted">None</span>
                        )}
                      </td>
                      <td className="font-display text-[11px] font-semibold">
                        {next ? `${formatTime(`2026-01-01T${next.scheduled_local_time}`)} · ${next.display_name}` : "—"}
                      </td>
                      <td>
                        <Link href={`/patients/${patient.id}`} className="neo-btn h-7 px-2 text-[10px]">
                          Manage
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <SectionCard
            title="Escalation inbox"
            eyebrow={`${openCases.length} open`}
            action={
              <Link href="/cases" className="text-[10px] font-bold uppercase underline">
                Triage
              </Link>
            }
            bodyClassName="p-3"
          >
            {openCases.length === 0 ? (
              <EmptyState>No open escalation cases.</EmptyState>
            ) : (
              <div className="flex flex-col gap-2">
                {openCases.slice(0, 3).map((c) => (
                  <Link
                    key={c.id}
                    href={`/cases?case=${c.id}`}
                    className={`rounded-xl border-[1.5px] border-ink p-3 ${
                      c.severity >= 3 ? "bg-rose" : "bg-butter"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="neo-eyebrow">{c.category.replaceAll("_", " ")}</span>
                      <Badge tone={statusTone(c.acknowledgement_status)}>{c.acknowledgement_status}</Badge>
                    </div>
                    <div className="mt-1 text-[12px] font-bold">{c.patient?.display_name ?? "Patient"}</div>
                    <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-ink-soft">{c.reason}</p>
                    <div
                      suppressHydrationWarning
                      className="mt-2 text-[9px] font-semibold tracking-wide text-ink-muted uppercase"
                    >
                      SEV-{c.severity} · {humanAgo(c.created_at)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Check-in outcomes" eyebrow="Outcome mix" bodyClassName="p-4">
            {rows.length === 0 ? (
              <EmptyState>No check-in outcomes recorded.</EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                {[
                  { label: "Completed", value: completed, tone: "sage" as const },
                  { label: "Escalated", value: escalated, tone: "rose" as const },
                  { label: "Unresolved", value: unresolved, tone: "butter" as const },
                  {
                    label: "Other statuses",
                    value: rows.length - completed - escalated - unresolved,
                    tone: "sky" as const,
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                      <span>{item.label}</span>
                      <span className="font-display">{item.value}</span>
                    </div>
                    <Bar value={item.value} max={rows.length} tone={item.tone} />
                  </div>
                ))}
                <p className="text-[10px] leading-snug text-ink-muted">
                  Self-reported adherence is never labeled as verified ingestion. Unanswered calls are not missed doses.
                </p>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Care schedule" eyebrow="Active windows" bodyClassName="p-3">
            {(schedules.data ?? []).length === 0 ? (
              <EmptyState>No active medication schedules.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {(schedules.data ?? []).slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-ink/20 bg-white">
                      <Icon name="pill" size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold">
                        {(s.patients as unknown as { display_name?: string } | null)?.display_name ?? "Patient"}
                      </span>
                      <span className="block truncate text-[10px] text-ink-muted">{s.display_name}</span>
                    </span>
                    <span className="font-display text-[10px] font-semibold">
                      {formatTime(`2026-01-01T${s.scheduled_local_time}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div className="rounded-2xl border-[1.5px] border-ink bg-sand p-4">
            <div className="flex items-center gap-2">
              <Icon name="shield" size={15} />
              <h2 className="font-display text-[12px] font-bold">Safety & compliance protocols</h2>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-sand-ink">
              Deterministic rule evaluation. Emergency guidance is never gated. Dosage changes are always refused and
              routed to a clinician. Every provider effect is simulated and audited.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="white">No dosage advice</Badge>
              <Badge tone="white">Synthetic data</Badge>
              <Badge tone="white">Simulated SMS</Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityCard({ row }: { row: CheckInRow }) {
  const patient = row.patients;
  const tone = statusTone(row.status);
  const border = {
    sage: "border-l-sage-ink",
    rose: "border-l-rose-ink",
    butter: "border-l-butter-ink",
    sky: "border-l-sky-ink",
    lilac: "border-l-lilac-ink",
    sand: "border-l-sand-ink",
    white: "border-l-ink",
    dark: "border-l-ink",
  }[tone];
  const decision = row.decisions?.[0];
  const caseRow = row.escalation_cases?.[0];
  const transcript = row.conversation_records?.[0]?.original_transcript;
  const surface = {
    sage: "bg-white",
    rose: "bg-rose/40",
    butter: "bg-butter/40",
    sky: "bg-sky/30",
    lilac: "bg-lilac/30",
    sand: "bg-sand/40",
    white: "bg-white",
    dark: "bg-white",
  }[tone];

  return (
    <article className={`rounded-xl border border-line-soft border-l-4 bg-white px-3 py-2.5 ${surface} ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={patient?.display_name ?? "Patient"} size={30} tone={tone} />
        <span className="text-[12.5px] font-bold">{patient?.display_name ?? "Patient"}</span>
        {patient?.date_of_birth ? (
          <span className="text-[10px] text-ink-muted">{ageFrom(patient.date_of_birth)} yrs</span>
        ) : null}
        <span
          suppressHydrationWarning
          className="ml-auto font-display text-[10px] font-semibold text-ink-muted"
        >
          {formatTime(row.created_at)} · {humanAgo(row.created_at)}
        </span>
        <StatusBadge status={row.status} />
      </div>

      {decision ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
          <span className="font-bold text-ink">{decision.decision_type.replaceAll("_", " ")}</span> ·{" "}
          {decision.decision_reason}
        </p>
      ) : transcript ? (
        <p className="mt-2 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft italic">“{transcript}”</p>
      ) : (
        <p className="mt-2 text-[11px] text-ink-muted">No conversation recorded.</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone="white">{row.channel.replaceAll("_", " ")}</Badge>
        {caseRow ? <Badge tone="rose">{caseRow.category.replaceAll("_", " ")} · SEV-{caseRow.severity}</Badge> : null}
        <Link href={`/check-ins/${row.id}`} className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase">
          Evidence <Icon name="arrowRight" size={11} />
        </Link>
        {caseRow ? (
          <Link href="/cases" className="text-[10px] font-bold uppercase underline">
            Review case
          </Link>
        ) : null}
      </div>
    </article>
  );
}


import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, EmptyState, SectionCard, StatusBadge, statusTone } from "@/components/ui/kit";
import { PatientTabs } from "@/components/patient-tabs";
import { CareNoteForm } from "@/components/care-note-form";
import { ageFrom, dayKey, formatDate, formatDateTime, formatTime, humanAgo } from "@/lib/format";

type Params = { params: Promise<{ id: string }> };

interface CheckInRow {
  id: string;
  status: string;
  channel: string;
  execution_mode: string;
  created_at: string;
  decisions: { decision_type: string; decision_reason: string }[] | null;
  conversation_records: { original_transcript: string | null }[] | null;
  escalation_cases: {
    id: string;
    category: string;
    severity: number;
    reason: string;
    acknowledgement_status: string;
    resolution_status: string;
  }[] | null;
}

interface MedicationRow {
  id: string;
  name: string;
  dosage: string;
  route: string;
  frequency_label: string;
  prescriber: string | null;
  status: string;
  notes: string | null;
  scheduled_times: string[];
}

interface ContactRow {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  priority: number;
  channels: string[];
  notes: string | null;
}

interface NoteRow {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export default async function PatientDetailPage({ params }: Params) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { id } = await params;

  const { data: patient } = await supabase
    .from("patients")
    .select(
      "id, display_name, timezone, preferred_language, status, date_of_birth, phone, mrn, conditions, primary_provider, risk_level",
    )
    .eq("id", id)
    .single();
  if (!patient) notFound();

  const [medications, contacts, schedules, consents, checkIns, notes, cases, assignments] = await Promise.all([
    supabase
      .from("medications")
      .select("id, name, dosage, route, frequency_label, prescriber, status, notes, scheduled_times")
      .eq("patient_id", id)
      .order("status")
      .order("name"),
    supabase
      .from("emergency_contacts")
      .select("id, name, relationship, phone, priority, channels, notes")
      .eq("patient_id", id)
      .order("priority"),
    supabase
      .from("medication_schedules")
      .select("id, display_name, scheduled_local_time, timezone, is_active")
      .eq("patient_id", id)
      .eq("is_active", true)
      .order("scheduled_local_time"),
    supabase
      .from("consents")
      .select("id, consent_type, status, scope, recorded_at, expires_at")
      .eq("patient_id", id)
      .order("recorded_at", { ascending: false })
      .limit(5),
    supabase
      .from("check_ins")
      .select(
        "id, status, channel, execution_mode, created_at, decisions(decision_type, decision_reason), conversation_records(original_transcript), escalation_cases(id, category, severity, reason, acknowledgement_status, resolution_status)",
      )
      .eq("patient_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("care_notes")
      .select("id, author_id, body, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("escalation_cases")
      .select("id, category, severity, reason, acknowledgement_status, resolution_status, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("caregiver_patient_assignments")
      .select("caregiver_id, relationship_label, is_active, created_at")
      .eq("patient_id", id)
      .eq("is_active", true),
  ]);

  const meds = (medications.data ?? []) as MedicationRow[];
  const contactRows = (contacts.data ?? []) as ContactRow[];
  const scheduleRows = schedules.data ?? [];
  const consentRows = consents.data ?? [];
  const callRows = (checkIns.data ?? []) as unknown as CheckInRow[];
  const noteRows = (notes.data ?? []) as NoteRow[];
  const caseRows = cases.data ?? [];
  const assignmentRows = assignments.data ?? [];

  const openCases = caseRows.filter((c) => c.resolution_status !== "resolved_reported");
  const latest = callRows[0];
  const nextWindow = scheduleRows[0];
  const age = ageFrom(patient.date_of_birth);
  const consent = consentRows[0];

  const recordedDays = new Map<string, string>();
  for (const call of callRows) {
    const key = dayKey(call.created_at);
    if (!recordedDays.has(key) || call.status === "completed") recordedDays.set(key, call.status);
  }

  const adherenceDays = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - index));
    const key = dayKey(date);
    return { key, date, status: recordedDays.get(key) };
  });
  const takenDays = adherenceDays.filter((d) => d.status === "completed").length;
  const recordedCount = adherenceDays.filter((d) => d.status).length;
  const adherencePct = recordedCount === 0 ? null : Math.round((takenDays / recordedCount) * 100);

  const overview = (
    <div className="flex flex-col gap-3">
      <SectionCard
        title="Active prescribed medications"
        eyebrow="Dose modification restricted to licensed prescribers"
        action={<Badge tone="sage">{meds.filter((m) => m.status === "active").length} active</Badge>}
        bodyClassName="p-0 overflow-x-auto"
      >
        {meds.length === 0 ? (
          <div className="p-4">
            <EmptyState>No medications recorded for this patient.</EmptyState>
          </div>
        ) : (
          <table className="neo-table">
            <thead>
              <tr>
                <th>Medication</th>
                <th>Frequency</th>
                <th>Prescriber</th>
                <th>Status</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {meds.map((med) => {
                const matchedCall = callRows.find((c) => c.decisions?.[0]?.decision_reason.includes(med.name));
                return (
                  <tr key={med.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-ink/20 bg-sage">
                          <Icon name="pill" size={13} />
                        </span>
                        <div>
                          <div className="text-[11.5px] font-bold">
                            {med.name} {med.dosage}
                          </div>
                          <div className="text-[9.5px] text-ink-muted">
                            {med.route} · {med.status}
                          </div>
                        </div>
                      </div>
                      {med.notes ? <p className="mt-1 max-w-[260px] text-[9.5px] text-butter-ink">{med.notes}</p> : null}
                    </td>
                    <td className="max-w-[200px] text-[10.5px] text-ink-soft">{med.frequency_label}</td>
                    <td className="text-[10.5px] text-ink-soft">{med.prescriber ?? "—"}</td>
                    <td>
                      <StatusBadge status={med.status} />
                    </td>
                    <td>
                      {matchedCall ? (
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={matchedCall.status} />
                          <span suppressHydrationWarning className="text-[9px] text-ink-muted">
                            {humanAgo(matchedCall.created_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9.5px] text-ink-muted">No record</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard
        title="Recent check-in calls & transcripts"
        eyebrow="Original statements preserved"
        action={
          <Link href="/check-ins" className="text-[10px] font-bold uppercase underline">
            All calls
          </Link>
        }
        bodyClassName="p-4"
      >
        {callRows.length === 0 ? (
          <EmptyState>No check-in calls recorded for this patient yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {callRows.slice(0, 4).map((call) => {
              const decision = call.decisions?.[0];
              const transcript = call.conversation_records?.[0]?.original_transcript;
              const tone = statusTone(call.status);
              return (
                <div key={call.id} className="rounded-xl border border-line-soft p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[11px] font-bold">{formatDateTime(call.created_at)}</span>
                    <StatusBadge status={call.status} />
                    <Badge tone="white">{call.channel.replaceAll("_", " ")}</Badge>
                    <Link href={`/check-ins/${call.id}`} className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase">
                      Evidence <Icon name="arrowRight" size={11} />
                    </Link>
                  </div>
                  {decision ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
                      <strong className="text-ink">{decision.decision_type.replaceAll("_", " ")}</strong> ·{" "}
                      {decision.decision_reason}
                    </p>
                  ) : null}
                  {transcript ? (
                    <details className="mt-1.5">
                      <summary className={`cursor-pointer text-[10px] font-bold uppercase ${tone === "rose" ? "text-rose-ink" : "text-ink-soft"}`}>
                        Original transcript
                      </summary>
                      <blockquote className="mt-1 border-l-2 border-ink/20 pl-2 text-[11px] leading-relaxed text-ink-soft italic">
                        “{transcript}”
                      </blockquote>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );

  const carePlan = (
    <div className="grid gap-3 lg:grid-cols-2">
      <SectionCard title="Medication regimen" eyebrow="Active prescriptions" bodyClassName="p-4">
        <div className="flex flex-col gap-2">
          {meds.map((med) => (
            <div key={med.id} className="rounded-xl border border-line-soft bg-canvas/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold">
                  {med.name} {med.dosage}
                </span>
                <StatusBadge status={med.status} />
              </div>
              <p className="mt-0.5 text-[10.5px] text-ink-soft">{med.frequency_label}</p>
              <p className="mt-0.5 text-[9.5px] text-ink-muted">
                {med.route} · {med.prescriber ?? "prescriber not recorded"}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
      <div className="flex flex-col gap-3">
        <SectionCard title="Call windows" eyebrow="Daily schedule" bodyClassName="p-4">
          {scheduleRows.length === 0 ? (
            <EmptyState>No active medication schedules.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {scheduleRows.map((schedule) => (
                <li key={schedule.id} className="flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2">
                  <Icon name="clock" size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-bold">{schedule.display_name}</span>
                    <span className="block text-[9.5px] text-ink-muted">
                      {formatTime(`2026-01-01T${schedule.scheduled_local_time}`)} · {schedule.timezone}
                    </span>
                  </span>
                  <Badge tone="sky">daily</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <div className="rounded-xl border-[1.5px] border-ink bg-butter p-4 text-[10.5px] leading-relaxed text-butter-ink">
          <strong className="flex items-center gap-1.5 text-[11px] uppercase">
            <Icon name="lock" size={13} /> Safety constraint
          </strong>
          The AI agent never advises dose changes, never confirms ingestion, and never gates emergency guidance. This care
          plan is informational only.
        </div>
      </div>
    </div>
  );

  const calendarTab = (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <SectionCard title="Next care windows" eyebrow="Recurring schedule" bodyClassName="p-4">
        {scheduleRows.length === 0 ? (
          <EmptyState>No active schedule.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {scheduleRows.map((schedule) => (
              <div key={schedule.id} className="flex items-center gap-3 rounded-xl border border-line-soft p-3">
                <span className="flex h-10 w-10 flex-col items-center justify-center rounded-lg border border-ink bg-sky">
                  <span className="font-display text-[11px] leading-none font-bold">
                    {formatTime(`2026-01-01T${schedule.scheduled_local_time}`).split(" ")[0]}
                  </span>
                  <span className="text-[8px] font-bold">
                    {formatTime(`2026-01-01T${schedule.scheduled_local_time}`).split(" ")[1]}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold">{schedule.display_name}</div>
                  <div className="text-[10px] text-ink-muted">Daily · {schedule.timezone}</div>
                </div>
                <Link href="/calendar" className="neo-btn h-7 px-2 text-[9.5px]">
                  Open calendar
                </Link>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title="Recorded calls" eyebrow="Last 30 days" bodyClassName="p-4">
        <div className="flex flex-col gap-2">
          {callRows.slice(0, 8).map((call) => (
            <Link key={call.id} href={`/check-ins/${call.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line-soft px-2.5 py-2">
              <span className="text-[10px] font-semibold">{formatDate(call.created_at)}</span>
              <StatusBadge status={call.status} />
            </Link>
          ))}
          {callRows.length === 0 ? <EmptyState>No recorded calls in the last 30 days.</EmptyState> : null}
        </div>
      </SectionCard>
    </div>
  );

  const careLogs = (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard title="Coordinator care log" eyebrow="Audited notes" bodyClassName="p-4">
        <div className="flex flex-col gap-2.5">
          {noteRows.length === 0 ? <EmptyState>No care notes recorded yet.</EmptyState> : null}
          {noteRows.map((note) => (
            <div key={note.id} className="rounded-xl border border-line-soft bg-canvas/50 p-3">
              <div className="flex items-center justify-between text-[9.5px] font-semibold text-ink-muted uppercase">
                <span>{note.author_id === auth.user?.id ? "You (care coordinator)" : "Care coordinator"}</span>
                <span>{formatDateTime(note.created_at)}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{note.body}</p>
            </div>
          ))}
        </div>
      </SectionCard>
      <div className="flex flex-col gap-3">
        <SectionCard title="Add note" eyebrow="Visible to assigned team" bodyClassName="p-4">
          <CareNoteForm patientId={patient.id} />
        </SectionCard>
        <SectionCard title="Call history" eyebrow="Persisted evidence" bodyClassName="p-3">
          {callRows.length === 0 ? (
            <EmptyState>No calls recorded.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {callRows.map((call) => (
                <li key={call.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                  <span className="font-display text-[9.5px] font-bold text-ink-muted">{formatDate(call.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-ink-soft">
                    {call.decisions?.[0]?.decision_type.replaceAll("_", " ") ?? call.channel}
                  </span>
                  <StatusBadge status={call.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );

  const contactsTab = (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <SectionCard title="Care contacts & family" eyebrow="Escalation order" bodyClassName="p-0 overflow-x-auto">
        {contactRows.length === 0 ? (
          <div className="p-4">
            <EmptyState>No emergency contacts recorded.</EmptyState>
          </div>
        ) : (
          <table className="neo-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Contact</th>
                <th>Relationship</th>
                <th>Channels</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {contactRows.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <Badge tone="white">#{contact.priority}</Badge>
                  </td>
                  <td className="font-bold">{contact.name}</td>
                  <td className="text-ink-soft">{contact.relationship}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {contact.channels.map((channel) => (
                        <Badge key={channel} tone={channel === "sms" ? "sky" : "sage"}>
                          {channel} · simulated
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="font-display text-[10.5px]">{contact.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
      <SectionCard title="Consent & safety preferences" eyebrow="Latest records" bodyClassName="p-4">
        {consentRows.length === 0 ? (
          <EmptyState>No consent records.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {consentRows.map((row) => (
              <li key={row.id} className="rounded-xl border border-line-soft p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold">{row.consent_type.replaceAll("_", " ")}</span>
                  <StatusBadge status={row.status} />
                </div>
                <div className="mt-1 text-[9.5px] text-ink-muted">
                  scope {row.scope} · recorded {formatDate(row.recorded_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-ink-muted">
          Language: {patient.preferred_language} · timezone {patient.timezone}. Consent gates all automated check-ins.
        </p>
      </SectionCard>
    </div>
  );

  const management = (
    <div className="grid gap-3 lg:grid-cols-2">
      <SectionCard title="Care management" eyebrow="Coverage & risk" bodyClassName="p-4">
        <dl className="grid grid-cols-2 gap-2 text-[11px]">
          {[
            ["Risk level", patient.risk_level ?? "low"],
            ["Primary provider", patient.primary_provider ?? "Not recorded"],
            ["Caregiver coverage", assignmentRows.length > 0 ? "Active assignment" : "Unassigned"],
            ["Patient status", patient.status],
            ["MRN", patient.mrn ?? "Not recorded"],
            ["Consent", consent?.status ?? "none"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-canvas px-2.5 py-2">
              <dt className="text-[9px] font-bold tracking-wide text-ink-muted uppercase">{label}</dt>
              <dd className="mt-0.5 font-semibold capitalize">{value}</dd>
            </div>
          ))}
        </dl>
        {assignmentRows.map((row) => (
          <div key={row.caregiver_id} className="mt-2 rounded-lg border border-line-soft px-3 py-2 text-[10.5px] text-ink-soft">
            {row.caregiver_id === auth.user?.id ? "You are" : "A caregiver is"} assigned
            {row.relationship_label ? ` · ${row.relationship_label}` : ""} · since {formatDate(row.created_at)}
          </div>
        ))}
      </SectionCard>
      <SectionCard title="Escalation history" eyebrow={`${openCases.length} open`} bodyClassName="p-4">
        {caseRows.length === 0 ? (
          <EmptyState>No escalation cases recorded.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {caseRows.map((row) => (
              <Link key={row.id} href="/cases" className="block rounded-xl border border-line-soft p-3 hover:bg-canvas">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold capitalize">{row.category.replaceAll("_", " ")}</span>
                  <Badge tone={row.resolution_status === "resolved_reported" ? "sage" : "rose"}>
                    SEV-{row.severity}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] text-ink-soft">{row.reason}</p>
                <div className="mt-1 text-[9px] font-semibold text-ink-muted uppercase">
                  {row.resolution_status.replaceAll("_", " ")} · {formatDate(row.created_at)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-ink-muted">
        <Link href="/patients" className="hover:underline">
          Patients
        </Link>
        <Icon name="chevronRight" size={11} />
        <span className="text-ink">{patient.display_name}</span>
      </div>

      <header className="neo-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Avatar name={patient.display_name} size={52} tone={patient.risk_level === "high" ? "rose" : "sage"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[24px] leading-tight font-bold">{patient.display_name}</h1>
              <Badge tone={patient.risk_level === "high" ? "rose" : patient.risk_level === "medium" ? "butter" : "sage"}>
                {patient.risk_level ?? "low"} risk
              </Badge>
              <StatusBadge status={patient.status} />
            </div>
            <p className="mt-0.5 text-[10.5px] text-ink-muted">
              {patient.mrn ?? "no MRN"} · {age ?? "?"} yrs · {patient.timezone} · {patient.phone ?? "no phone recorded"}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(patient.conditions as string[] | null ?? []).map((condition: string) => (
                <Badge key={condition} tone="white">
                  {condition}
                </Badge>
              ))}
              {consent ? <Badge tone="sage">consent {consent.status}</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/demo/call-simulator?patient=${patient.id}`} className="neo-btn neo-btn-dark h-8 text-[10px]">
              <Icon name="phone" size={12} />
              Simulate check-in
            </Link>
            <Link href="/calendar" className="neo-btn h-8 text-[10px]">
              <Icon name="calendar" size={12} />
              Care calendar
            </Link>
            <Link href="/cases" className="neo-btn neo-btn-rose h-8 text-[10px]">
              <Icon name="alert" size={12} />
              Escalations
            </Link>
          </div>
        </div>

        <div className="grid gap-px border-t-[1.5px] border-ink bg-ink/10 sm:grid-cols-3">
          {[
            { icon: "clock" as const, label: "Next scheduled call", value: nextWindow ? `${formatTime(`2026-01-01T${nextWindow.scheduled_local_time}`)} · ${nextWindow.display_name}` : "No window" },
            { icon: "stethoscope" as const, label: "Primary provider", value: patient.primary_provider ?? "Not recorded" },
            { icon: "phone" as const, label: "Last call", value: latest ? `${formatDateTime(latest.created_at)} · ${latest.status}` : "No calls recorded" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2 bg-white px-3 py-2.5">
              <Icon name={item.icon} size={14} className="shrink-0 text-ink-soft" />
              <span className="min-w-0">
                <span className="block text-[8.5px] font-bold tracking-wider text-ink-muted uppercase">{item.label}</span>
                <span className="block truncate text-[10.5px] font-semibold">{item.value}</span>
              </span>
            </div>
          ))}
        </div>

        {openCases.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t-[1.5px] border-rose-ink/30 bg-rose px-4 py-2.5">
            <Icon name="alert" size={15} className="text-rose-ink" />
            <p className="min-w-0 flex-1 text-[10.5px] font-medium text-rose-ink">
              <strong>{openCases.length} open escalation</strong> · {openCases[0].reason}
            </p>
            <Link href="/cases" className="neo-btn h-7 bg-white px-2 text-[9.5px] text-rose-ink">
              Open triage
            </Link>
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <PatientTabs
            tabs={[
              { id: "overview", label: "Overview & medications", icon: "pill", content: overview },
              { id: "plan", label: "Care plan", icon: "clipboard", content: carePlan },
              { id: "calendar", label: "Calendar", icon: "calendar", content: calendarTab },
              { id: "logs", label: "Care logs", icon: "file", content: careLogs },
              { id: "contacts", label: "Care contacts & family", icon: "users", content: contactsTab },
              { id: "management", label: "Care management", icon: "settings", content: management },
            ]}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-2xl border-[1.5px] border-rose-ink bg-rose p-4">
            <div className="flex items-center gap-2 text-rose-ink">
              <Icon name="alert" size={15} />
              <h2 className="font-display text-[12px] font-bold uppercase">Emergency protocol</h2>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-rose-ink">
              If the patient reports chest pain, severe breathlessness, or fainting: instruct them to call{" "}
              <strong>911</strong> immediately. Emergency guidance is never blocked by this workflow.
            </p>
            <div className="mt-2 rounded-lg bg-white/60 px-2.5 py-1.5 text-[9.5px] font-semibold text-rose-ink">
              Demo environment · no real emergency dispatch
            </div>
          </div>

          <SectionCard title="Escalation chain" eyebrow="Family first" bodyClassName="p-3">
            {contactRows.length === 0 ? (
              <EmptyState>No contacts recorded.</EmptyState>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {contactRows.map((contact) => (
                  <li key={contact.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-ink bg-white font-display text-[9px] font-bold">
                      {contact.priority}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10.5px] font-bold">{contact.name}</span>
                      <span className="block truncate text-[9px] text-ink-muted">
                        {contact.relationship} · {contact.channels.map((c) => c).join("/")}
                      </span>
                    </span>
                    <span className="font-display text-[9px] text-ink-muted">{contact.phone}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[9px] text-ink-muted">Delivery channels are simulated in this demo.</p>
          </SectionCard>

          <SectionCard title="30-day reported adherence" eyebrow="Of recorded calls" bodyClassName="p-4">
            <div className="flex items-end justify-between">
              <span className="font-display text-[30px] leading-none font-bold">
                {adherencePct === null ? "—" : `${adherencePct}%`}
              </span>
              <span className="text-right text-[9.5px] font-semibold text-ink-muted">
                {takenDays} taken / {recordedCount} recorded
              </span>
            </div>
            <div className="mt-3 grid grid-cols-10 gap-1">
              {adherenceDays.map((day) => {
                const tone = day.status ? statusTone(day.status) : "white";
                const cls =
                  tone === "sage"
                    ? "bg-sage border-sage-ink"
                    : tone === "rose"
                      ? "bg-rose border-rose-ink"
                      : tone === "butter"
                        ? "bg-butter border-butter-ink"
                        : "bg-canvas border-line-soft";
                return (
                  <span
                    key={day.key}
                    title={`${day.key}: ${day.status ?? "no record"}`}
                    className={`aspect-square rounded-[3px] border ${cls}`}
                  />
                );
              })}
            </div>
            <p className="mt-2 text-[9px] leading-snug text-ink-muted">
              Self-reported. Days without a recorded call are not counted as missed doses.
            </p>
          </SectionCard>

          <SectionCard title="Caregiver coverage" eyebrow="Active assignment" bodyClassName="p-4">
            <div className="flex items-center gap-2">
              <Icon name="shield" size={15} />
              <div className="text-[11px] font-semibold">
                {assignmentRows.some((row) => row.caregiver_id === auth.user?.id)
                  ? "You are the assigned coordinator"
                  : assignmentRows.length > 0
                    ? "Assigned coordinator on file"
                    : "No active assignment"}
              </div>
            </div>
            <p className="mt-1 text-[9.5px] leading-snug text-ink-muted">
              Escalations are visible only to assigned caregivers and super-admins (row-level security).
            </p>
          </SectionCard>

          {noteRows[0] ? (
            <div className="rounded-2xl border-[1.5px] border-ink bg-sand p-4">
              <div className="neo-eyebrow">Latest care note</div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-sand-ink">{noteRows[0].body}</p>
              <div
                suppressHydrationWarning
                className="mt-1.5 text-[9px] font-semibold text-sand-ink/70"
              >
                {humanAgo(noteRows[0].created_at)}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}


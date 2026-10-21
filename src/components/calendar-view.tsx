"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, PageHeader, StatusBadge, statusTone, type Tone } from "@/components/ui/kit";
import { ageFrom, dayKey, formatTime, monthLabel, weekday } from "@/lib/format";

export interface CalendarCheckIn {
  id: string;
  patient_id: string;
  schedule_id: string | null;
  status: string;
  channel: string;
  created_at: string;
  decisions: { decision_type: string; decision_reason: string }[] | null;
  conversation_records: { original_transcript: string | null }[] | null;
  escalation_cases: {
    category: string;
    severity: number;
    acknowledgement_status: string;
    resolution_status: string;
  }[] | null;
}

interface CalendarPatient {
  id: string;
  display_name: string;
  conditions: string[] | null;
  risk_level: string | null;
  date_of_birth: string | null;
  timezone: string;
}

interface CalendarSchedule {
  id: string;
  patient_id: string;
  display_name: string;
  scheduled_local_time: string;
  timezone: string;
}

interface CalEvent {
  key: string;
  day: string;
  time: string;
  patientId: string;
  patientName: string;
  label: string;
  status: string;
  kind: "dose" | "call";
  checkIn?: CalendarCheckIn;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function eventTone(status: string): Tone {
  return statusTone(status);
}

const TONE_SURFACE: Record<Tone, string> = {
  sage: "bg-sage border-sage-ink text-sage-ink",
  rose: "bg-rose border-rose-ink text-rose-ink",
  butter: "bg-butter border-butter-ink text-butter-ink",
  sky: "bg-sky border-sky-ink text-sky-ink",
  lilac: "bg-lilac border-lilac-ink text-lilac-ink",
  sand: "bg-sand border-sand-ink text-sand-ink",
  white: "bg-white border-ink/25 text-ink-soft",
  dark: "bg-ink border-ink text-white",
};

export function CalendarView({
  patients,
  schedules,
  checkIns,
}: {
  patients: CalendarPatient[];
  schedules: CalendarSchedule[];
  checkIns: CalendarCheckIn[];
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => dayKey(new Date()));
  const [patientFilter, setPatientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const todayKey = dayKey(new Date());

  const gridStart = useMemo(() => {
    const offset = (cursor.getDay() + 6) % 7;
    return addDays(cursor, -offset);
  }, [cursor]);

  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const events = useMemo(() => {
    const byPatientDay = new Map<string, CalendarCheckIn[]>();
    for (const row of checkIns) {
      const key = `${row.patient_id}|${dayKey(row.created_at)}`;
      const list = byPatientDay.get(key) ?? [];
      list.push(row);
      byPatientDay.set(key, list);
    }

    const built: CalEvent[] = [];
    for (const schedule of schedules) {
      const patient = patients.find((p) => p.id === schedule.patient_id);
      if (!patient) continue;
      for (const day of days) {
        const key = dayKey(day);
        const candidates = byPatientDay.get(`${schedule.patient_id}|${key}`) ?? [];
        const match =
          candidates.find((c) => c.schedule_id === schedule.id) ??
          (schedules.filter((s) => s.patient_id === schedule.patient_id).length === 1 ? candidates[0] : undefined);
        const status = match ? match.status : key < todayKey ? "no_record" : "scheduled";
        built.push({
          key: `${schedule.id}-${key}`,
          day: key,
          time: schedule.scheduled_local_time,
          patientId: patient.id,
          patientName: patient.display_name,
          label: schedule.display_name,
          status,
          kind: "dose",
          checkIn: match,
        });
      }
    }

    // Calls that do not map to a schedule still belong on the calendar.
    for (const row of checkIns) {
      const day = dayKey(row.created_at);
      const patient = patients.find((p) => p.id === row.patient_id);
      if (!patient) continue;
      const already = built.some(
        (e) => e.day === day && e.checkIn?.id === row.id && e.patientId === row.patient_id,
      );
      if (already) continue;
      built.push({
        key: `call-${row.id}`,
        day,
        time: new Date(row.created_at).toTimeString().slice(0, 8),
        patientId: patient.id,
        patientName: patient.display_name,
        label: "Care check-in call",
        status: row.status,
        kind: "call",
        checkIn: row,
      });
    }

    return built
      .filter((e) => patientFilter === "all" || e.patientId === patientFilter)
      .filter((e) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "no_record") return e.status === "no_record" || e.status === "scheduled";
        return e.status === statusFilter;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
  }, [checkIns, days, patientFilter, patients, schedules, statusFilter, todayKey]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const event of events) {
      const list = map.get(event.day) ?? [];
      list.push(event);
      map.set(event.day, list);
    }
    return map;
  }, [events]);

  const dayEvents = eventsByDay.get(selectedDay) ?? [];
  const selected = dayEvents.find((e) => e.key === selectedKey) ?? dayEvents[0] ?? null;
  const monthEvents = events.filter((e) => {
    const d = new Date(`${e.day}T12:00:00`);
    return d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
  });
  const recorded = monthEvents.filter((e) => e.checkIn).length;
  const escalations = monthEvents.filter((e) =>
    e.checkIn?.escalation_cases?.some((c) => c.resolution_status !== "resolved_reported"),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Care calendar & event inspector"
        title="Care calendar"
        subtitle="Recurring medication windows, recorded calls, and open escalations in one timeline. Days without a recorded call are marked “no record” — never assumed missed."
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setCursor(addMonths(cursor, -1))} className="neo-btn h-9 w-9 p-0" aria-label="Previous month">
              <Icon name="chevronLeft" size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCursor(startOfMonth(now));
                setSelectedDay(dayKey(now));
                setSelectedKey(null);
              }}
              className="neo-btn h-9"
            >
              Today
            </button>
            <button type="button" onClick={() => setCursor(addMonths(cursor, 1))} className="neo-btn h-9 w-9 p-0" aria-label="Next month">
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[20px] font-bold">{monthLabel(cursor)}</span>
        <Badge tone="sage">{recorded} recorded calls</Badge>
        <Badge tone="rose">{escalations} open escalations</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase">
            <Icon name="users" size={13} />
            <select value={patientFilter} onChange={(e) => { setPatientFilter(e.target.value); setSelectedKey(null); }} className="neo-input h-8 py-0 text-[11px]">
              <option value="all">All patients</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase">
            <Icon name="filter" size={13} />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSelectedKey(null); }} className="neo-input h-8 py-0 text-[11px]">
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="escalated">Escalated</option>
              <option value="unresolved">Unresolved</option>
              <option value="in_progress">In progress</option>
              <option value="no_record">No record / scheduled</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] font-semibold">
        <Legend tone="sage" label="Completed / taken" />
        <Legend tone="rose" label="Urgent escalation" />
        <Legend tone="butter" label="No record / unresolved" />
        <Legend tone="sky" label="Scheduled" />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="neo-card overflow-hidden">
          <div className="grid grid-cols-7 border-b-[1.5px] border-ink bg-white">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-[9px] font-bold tracking-[0.12em] text-ink-soft uppercase">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, index) => {
              const key = dayKey(day);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              const list = eventsByDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedDay(key);
                    setSelectedKey(null);
                  }}
                  className={`min-h-[118px] border-r border-b border-line-soft p-1.5 text-left align-top transition-colors hover:bg-canvas ${
                    isSelected ? "bg-butter/60" : inMonth ? "bg-white" : "bg-canvas/60"
                  } ${index % 7 === 6 ? "border-r-0" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-display text-[10px] font-bold ${
                        isToday ? "bg-ink text-white" : inMonth ? "text-ink" : "text-ink-muted"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {list.length > 0 ? <span className="text-[8px] font-bold text-ink-muted">{list.length}</span> : null}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {list.slice(0, 3).map((event) => {
                      const tone = eventTone(event.status);
                      return (
                        <span
                          key={event.key}
                          className={`block truncate rounded border-l-2 px-1 py-0.5 text-[8.5px] font-semibold ${TONE_SURFACE[tone]}`}
                        >
                          {formatTime(`${key}T${event.time}`)} {event.patientName.split(" ")[0]} · {event.label}
                        </span>
                      );
                    })}
                    {list.length > 3 ? (
                      <span className="text-[8px] font-bold text-ink-muted">+{list.length - 3} more</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="neo-card p-4">
            <div className="neo-eyebrow">Event inspector</div>
            <h2 className="font-display text-[16px] font-bold">
              {weekday(`${selectedDay}T12:00:00`)}, {selectedDay}
            </h2>
            <div className="mt-1 text-[11px] text-ink-soft">
              {dayEvents.length === 0 ? "No care events on this day." : `${dayEvents.length} care events`}
            </div>

            {dayEvents.length > 0 ? (
              <div className="mt-3 flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
                {dayEvents.map((event) => {
                  const active = selected?.key === event.key;
                  return (
                    <button
                      key={event.key}
                      type="button"
                      onClick={() => setSelectedKey(event.key)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${
                        active ? "border-ink bg-butter shadow-tactile-sm" : "border-line-soft bg-white"
                      }`}
                    >
                      <span className="font-display text-[10px] font-bold">{formatTime(`${event.day}T${event.time}`)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold">{event.patientName}</span>
                        <span className="block truncate text-[9.5px] text-ink-muted">{event.label}</span>
                      </span>
                      <StatusBadge status={event.status} />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {selected ? <Inspector event={selected} patient={patients.find((p) => p.id === selected.patientId)} /> : null}
        </div>
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded border border-ink/30 ${TONE_SURFACE[tone].split(" ")[0]}`} />
      {label}
    </span>
  );
}

function Inspector({ event, patient }: { event: CalEvent; patient?: CalendarPatient }) {
  const checkIn = event.checkIn;
  const decision = checkIn?.decisions?.[0];
  const transcript = checkIn?.conversation_records?.[0]?.original_transcript;
  const caseRow = checkIn?.escalation_cases?.find((c) => c.resolution_status !== "resolved_reported") ?? checkIn?.escalation_cases?.[0];

  return (
    <div className="neo-card overflow-hidden">
      <div className="border-b-[1.5px] border-ink bg-sand px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="neo-eyebrow">{event.kind === "dose" ? "Medication window" : "Care call"}</span>
          <StatusBadge status={event.status} />
        </div>
        <div className="mt-1 font-display text-[14px] font-bold">{event.label}</div>
        <div className="text-[10px] font-semibold text-sand-ink">
          {weekday(`${event.day}T12:00:00`)} {formatTime(`${event.day}T${event.time}`)}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Avatar name={event.patientName} size={34} tone={patient?.risk_level === "high" ? "rose" : "sage"} />
          <div className="min-w-0 flex-1">
            <Link href={`/patients/${event.patientId}`} className="block truncate text-[12px] font-bold hover:underline">
              {event.patientName}
            </Link>
            <div className="truncate text-[9.5px] text-ink-muted">
              {patient?.date_of_birth ? `${ageFrom(patient.date_of_birth)} yrs · ` : ""}
              {(patient?.conditions ?? []).join(" / ") || "No conditions recorded"}
            </div>
          </div>
          <Badge tone="white">{patient?.timezone ?? "—"}</Badge>
        </div>

        {caseRow ? (
          <div className="rounded-lg border border-rose-ink/30 bg-rose px-3 py-2 text-[10.5px] text-rose-ink">
            <strong className="uppercase">{caseRow.category.replaceAll("_", " ")} · SEV-{caseRow.severity}</strong>
            <div className="mt-0.5">Acknowledgement: {caseRow.acknowledgement_status.replaceAll("_", " ")}</div>
          </div>
        ) : null}

        {decision ? (
          <div>
            <div className="neo-eyebrow mb-1">Rule decision</div>
            <div className="text-[11px] font-bold">{decision.decision_type.replaceAll("_", " ")}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{decision.decision_reason}</p>
          </div>
        ) : (
          <div className="rounded-lg bg-canvas px-3 py-2 text-[10.5px] text-ink-soft">
            {checkIn ? "No decision recorded for this call." : "No call record exists for this scheduled window. This is not evidence of a missed dose."}
          </div>
        )}

        {transcript ? (
          <div>
            <div className="neo-eyebrow mb-1">Patient utterance</div>
            <blockquote className="border-l-2 border-ink/30 pl-2 text-[11px] leading-relaxed text-ink-soft italic">
              “{transcript}”
            </blockquote>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {checkIn ? (
            <Link href={`/check-ins/${checkIn.id}`} className="neo-btn h-8 text-[10px]">
              <Icon name="file" size={12} />
              Evidence record
            </Link>
          ) : null}
          <Link href={`/patients/${event.patientId}`} className="neo-btn h-8 text-[10px]">
            <Icon name="user" size={12} />
            Patient record
          </Link>
        </div>
      </div>
    </div>
  );
}

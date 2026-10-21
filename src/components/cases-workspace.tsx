import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Badge, Bar, EmptyState, PageHeader, SectionCard, StatCard } from "@/components/ui/kit";
import { CaseCard, type CaseCardData } from "@/components/case-card";

export interface CaseContact {
  id: string;
  patient_id: string;
  name: string;
  relationship: string;
  phone: string;
  priority: number;
  channels: string[];
}

export interface CasesWorkspaceProps {
  cases: CaseCardData[];
  contacts: CaseContact[];
  filter: string;
  baseHref: string;
}

const FILTERS = [
  { id: "all", label: "All cases" },
  { id: "critical", label: "Critical" },
  { id: "follow-up", label: "Follow-up" },
  { id: "resolved", label: "Resolved" },
];

export function CasesWorkspace({ cases, contacts, filter, baseHref }: CasesWorkspaceProps) {
  const open = cases.filter((c) => c.resolution_status !== "resolved_reported");
  const critical = open.filter((c) => c.severity >= 3);
  const awaiting = open.filter((c) => c.acknowledgement_status === "pending");
  const followUp = open.filter((c) => c.acknowledgement_status === "acknowledged");
  const today = new Date().toDateString();
  const resolvedToday = cases.filter(
    (c) => c.resolution_status === "resolved_reported" && new Date(c.created_at).toDateString() === today,
  );

  const visible = cases.filter((c) => {
    if (filter === "critical") return c.severity >= 3 && c.resolution_status !== "resolved_reported";
    if (filter === "follow-up") return c.acknowledgement_status === "acknowledged" && c.resolution_status !== "resolved_reported";
    if (filter === "resolved") return c.resolution_status === "resolved_reported";
    return true;
  });

  const counts: Record<string, number> = {
    all: cases.length,
    critical: critical.length,
    "follow-up": followUp.length,
    resolved: cases.filter((c) => c.resolution_status === "resolved_reported").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Escalation operations & alert triage"
        title="Escalation cases"
        subtitle="Risk-based follow-up opened by the deterministic safety engine. Acknowledge, contact (simulated), and record a documented outcome. Emergency guidance is never gated."
        actions={
          <Link href={`${baseHref === "/admin/cases" ? "/admin/runs" : "/demo/call-simulator"}`} className="neo-btn h-9">
            <Icon name="sparkles" size={14} />
            Run a scenario
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard label="Open alerts" value={open.length} hint={`${critical.length} critical severity`} icon="alert" tone="rose" />
        <StatCard label="Awaiting acknowledgement" value={awaiting.length} hint="No approve-before-notify gate" icon="bell" tone="butter" />
        <StatCard label="Follow-up in progress" value={followUp.length} hint="Acknowledged, not closed" icon="activity" tone="sky" />
        <StatCard label="Resolved today" value={resolvedToday.length} hint="Documented dispositions only" icon="checkCircle" tone="sage" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <Link
                  key={item.id}
                  href={item.id === "all" ? baseHref : `${baseHref}?filter=${item.id}`}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-bold ${
                    active ? "border-ink bg-ink text-white shadow-tactile-sm" : "border-line-soft bg-white text-ink-soft"
                  }`}
                >
                  {item.label}
                  <span className={`rounded-full px-1.5 text-[9px] ${active ? "bg-white/20" : "bg-canvas"}`}>
                    {counts[item.id] ?? 0}
                  </span>
                </Link>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <SectionCard>
              <EmptyState>
                No cases in this view. Run a symptom, dosage, emergency, or no-answer scenario to exercise the escalation
                pipeline.
              </EmptyState>
            </SectionCard>
          ) : (
            visible.map((row) => <CaseCard key={row.id} caseRow={row} />)
          )}
        </div>

        <aside className="flex flex-col gap-3 xl:sticky xl:top-16 xl:self-start">
          <div className="rounded-2xl border-[1.5px] border-ink bg-sand p-4">
            <div className="flex items-center gap-2">
              <Icon name="shield" size={15} />
              <h2 className="font-display text-[12px] font-bold uppercase">Safety-first protocol</h2>
            </div>
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4 text-[10.5px] leading-relaxed text-sand-ink">
              <li>Emergency guidance and 911 instruction are never gated behind approval.</li>
              <li>Dosage questions get a fixed refusal and a clinical routing action.</li>
              <li>Every resolution requires a written disposition and an audit event.</li>
            </ol>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone="white">Deterministic rules</Badge>
              <Badge tone="white">Simulated delivery</Badge>
            </div>
          </div>

          <SectionCard title="Queue lifecycle" eyebrow="Current snapshot" bodyClassName="p-4">
            <div className="flex flex-col gap-2.5">
              {[
                { label: "Awaiting acknowledgement", value: awaiting.length, tone: "butter" as const },
                { label: "Follow-up in progress", value: followUp.length, tone: "sky" as const },
                { label: "Resolved", value: counts.resolved, tone: "sage" as const },
              ].map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-[10.5px] font-semibold">
                    <span>{item.label}</span>
                    <span className="font-display">{item.value}</span>
                  </div>
                  <Bar value={item.value} max={Math.max(1, cases.length)} tone={item.tone} />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Escalation contacts" eyebrow="Family & clinicians" bodyClassName="p-3">
            {contacts.length === 0 ? (
              <EmptyState>No contacts recorded for open cases.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {contacts.slice(0, 6).map((contact) => (
                  <li key={contact.id} className="flex items-center gap-2 rounded-lg bg-canvas px-2.5 py-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-ink bg-white font-display text-[9px] font-bold">
                      {contact.priority}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10.5px] font-bold">{contact.name}</span>
                      <span className="block truncate text-[9px] text-ink-muted">
                        {contact.relationship} · {contact.channels.join("/")}
                      </span>
                    </span>
                    <span className="font-display text-[9px] text-ink-muted">{contact.phone}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[9px] leading-snug text-ink-muted">
              Calls and SMS are simulated. No real contact is made by this demo.
            </p>
          </SectionCard>

          <div className="rounded-2xl border border-line-soft bg-white p-3">
            <div className="neo-eyebrow mb-1">On-call clinician</div>
            <p className="text-[10.5px] text-ink-soft">
              Case disposition requires an authenticated caregiver. Escalate urgent findings through the patient’s
              recorded clinical contact.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Bar, Badge, PageHeader, SectionCard, StatCard, statusTone } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/format";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [patients, caregivers, checkIns, openCases, verifications, runs] = await Promise.all([
    supabase.from("patients").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "caregiver"),
    supabase.from("check_ins").select("status"),
    supabase
      .from("escalation_cases")
      .select("id", { count: "exact", head: true })
      .neq("resolution_status", "resolved_reported"),
    supabase.from("verification_records").select("result"),
    supabase.from("test_runs").select("id, scenario_id, status, started_at").order("started_at", { ascending: false }).limit(8),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of checkIns.data ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  const statusRows = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...statusRows.map(([, n]) => n));

  const metrics = [
    { label: "Patients", value: patients.count ?? 0, tone: "sage" as const },
    { label: "Caregivers", value: caregivers.count ?? 0, tone: "sky" as const },
    { label: "Open cases", value: openCases.count ?? 0, tone: "rose" as const },
    {
      label: "Failed verifications",
      value: (verifications.data ?? []).filter((v) => v.result === "failed").length,
      tone: "sand" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Platform overview"
        subtitle="Operational configuration, caregiver coverage, scenario runs, and system guardrails. All counts come from persisted records."
        actions={
          <>
            <Link href="/admin/runs" className="neo-btn h-8 text-[10px]">
              Scenario runs
            </Link>
            <Link href="/admin/audit" className="neo-btn neo-btn-dark h-8 text-[10px]">
              Audit trail
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} tone={m.tone} />
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SectionCard title="Check-ins by status" eyebrow="Persisted check-in rows" bodyClassName="p-4">
          {statusRows.length === 0 ? (
            <p className="text-[10.5px] text-ink-muted">No check-ins recorded yet. Run a scenario to generate evidence.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {statusRows.map(([status, count]) => (
                <div key={status}>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold">{status.replaceAll("_", " ")}</span>
                    <span className="text-ink-muted">{count}</span>
                  </div>
                  <Bar value={count} max={maxStatus} tone={statusTone(status)} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent test runs"
          eyebrow="Official scenario evidence"
          action={
            <Link href="/admin/runs" className="text-[10px] font-bold underline">
              View all
            </Link>
          }
          bodyClassName="p-0"
        >
          {(runs.data ?? []).length === 0 ? (
            <p className="p-4 text-[10.5px] text-ink-muted">No test runs yet.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {(runs.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div>
                    <div className="text-[10.5px] font-bold">{r.scenario_id}</div>
                    <div className="text-[9px] text-ink-muted">{formatDateTime(r.started_at)}</div>
                  </div>
                  <Badge tone={r.status === "passed" ? "sage" : "rose"}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { href: "/admin/caregivers", label: "Caregivers", blurb: "Accounts, roles, active status", tone: "bg-sky" },
          { href: "/admin/assignments", label: "Assignments", blurb: "Caregiver ↔ patient coverage", tone: "bg-sage" },
          { href: "/admin/config", label: "Configuration", blurb: "Providers and demo reset", tone: "bg-sand" },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`rounded-2xl border-[1.5px] border-ink p-4 transition hover:-translate-y-0.5 ${card.tone}`}
          >
            <div className="text-[12px] font-bold">{card.label}</div>
            <div className="mt-0.5 text-[10px] text-ink-soft">{card.blurb}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}


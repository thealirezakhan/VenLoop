import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, EmptyState, PageHeader, SectionCard, StatusBadge, statusTone } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/format";

export default async function AlertsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: alerts } = await supabase
    .from("check_ins")
    .select("id, status, created_at, patient_id, patients(display_name, risk_level)")
    .in("status", ["escalated", "unresolved", "failed"])
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (alerts ?? []) as unknown as {
    id: string;
    status: string;
    created_at: string;
    patient_id: string;
    patients: { display_name: string; risk_level: string | null } | null;
  }[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Signal inbox"
        title="All alerts"
        subtitle="Escalated, unresolved, or failed check-ins. Unanswered calls are never treated as missed doses."
        actions={
          <Link href="/cases" className="neo-btn neo-btn-dark h-9">
            <Icon name="alert" size={14} />
            Escalation triage
          </Link>
        }
      />

      <SectionCard title="Check-ins needing review" eyebrow={`${rows.length} records`} bodyClassName="p-3">
        {rows.length === 0 ? (
          <EmptyState>No active alerts.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((alert) => (
              <li
                key={alert.id}
                className={`flex flex-wrap items-center gap-2.5 rounded-xl border border-line-soft border-l-4 bg-white px-3 py-2.5 ${
                  alert.status === "escalated" ? "border-l-rose-ink" : "border-l-butter-ink"
                }`}
              >
                <Avatar name={alert.patients?.display_name ?? "Patient"} size={30} tone={statusTone(alert.status)} />
                <div className="min-w-0 flex-1">
                  <Link href={`/patients/${alert.patient_id}`} className="text-[12px] font-bold hover:underline">
                    {alert.patients?.display_name ?? "Patient"}
                  </Link>
                  <div className="text-[9.5px] text-ink-muted">{formatDateTime(alert.created_at)}</div>
                </div>
                <Badge tone="white">{alert.patients?.risk_level ?? "low"} risk</Badge>
                <StatusBadge status={alert.status} />
                <Link href={`/check-ins/${alert.id}`} className="neo-btn h-7 px-2 text-[9.5px]">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

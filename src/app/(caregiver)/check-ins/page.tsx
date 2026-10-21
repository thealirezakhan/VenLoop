import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, EmptyState, PageHeader, SectionCard, StatusBadge, statusTone } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/format";

export default async function CheckInsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: checkIns } = await supabase
    .from("check_ins")
    .select("id, status, channel, execution_mode, created_at, patient_id, patients(display_name), decisions(decision_type), escalation_cases(category, severity)")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (checkIns ?? []) as unknown as {
    id: string;
    status: string;
    channel: string;
    execution_mode: string;
    created_at: string;
    patient_id: string;
    patients: { display_name: string } | null;
    decisions: { decision_type: string }[] | null;
    escalation_cases: { category: string; severity: number }[] | null;
  }[];

  const completed = rows.filter((row) => row.status === "completed").length;
  const escalated = rows.filter((row) => row.status === "escalated").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Call log"
        title="Calls & check-ins"
        subtitle={`${rows.length} recorded calls · ${completed} completed · ${escalated} escalated. Every row opens the decision and evidence trail.`}
        actions={
          <Link href="/demo/call-simulator" className="neo-btn neo-btn-dark h-9">
            <Icon name="sparkles" size={14} />
            Open simulator
          </Link>
        }
      />

      <SectionCard title="Recorded calls" eyebrow="Newest first" bodyClassName="p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState>No check-ins recorded yet. Run a scenario from the call simulator.</EmptyState>
          </div>
        ) : (
          <table className="neo-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Status</th>
                <th>Decision</th>
                <th>Channel</th>
                <th>Mode</th>
                <th>Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Avatar name={row.patients?.display_name ?? "Patient"} size={26} tone={statusTone(row.status)} />
                      <div>
                        <Link href={`/patients/${row.patient_id}`} className="text-[11px] font-bold hover:underline">
                          {row.patients?.display_name ?? "Patient"}
                        </Link>
                        {row.escalation_cases?.[0] ? (
                          <div className="text-[9px] text-rose-ink">
                            {row.escalation_cases[0].category.replaceAll("_", " ")} · SEV-{row.escalation_cases[0].severity}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="text-[10.5px] text-ink-soft">
                    {row.decisions?.[0]?.decision_type.replaceAll("_", " ") ?? "—"}
                  </td>
                  <td>
                    <Badge tone="white">{row.channel.replaceAll("_", " ")}</Badge>
                  </td>
                  <td>
                    <Badge tone={row.execution_mode === "simulated" ? "sky" : "rose"}>{row.execution_mode}</Badge>
                  </td>
                  <td className="font-display text-[10px] text-ink-soft">{formatDateTime(row.created_at)}</td>
                  <td>
                    <Link href={`/check-ins/${row.id}`} className="flex items-center justify-end gap-1 text-[10px] font-bold uppercase">
                      Evidence <Icon name="arrowRight" size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

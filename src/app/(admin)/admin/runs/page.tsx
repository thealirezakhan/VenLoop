import Link from "next/link";
import { redirect } from "next/navigation";
import { SCENARIOS } from "@/lib/server/test-runs";
import { createClient } from "@/lib/supabase/server";
import { RetryRunButton, RunScenarioButtons } from "@/components/admin-forms";
import { Badge, PageHeader, SectionCard } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/format";

export default async function AdminRunsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: runs } = await supabase
    .from("test_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(50);

  const passed = (runs ?? []).filter((r) => r.status === "passed").length;
  const failed = (runs ?? []).filter((r) => r.status === "failed").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Official scenario runs"
        subtitle="Runs TC1–TC5 through the real pipeline against persisted data (PRD 9.3; TC5 covers the emergency pathway). Every run records expected vs actual results as evidence."
        actions={
          <>
            <Badge tone="sage">{passed} passed</Badge>
            <Badge tone="rose">{failed} failed</Badge>
          </>
        }
      />

      <SectionCard title="Run a scenario" eyebrow="Writes a persisted test run" bodyClassName="p-4">
        <RunScenarioButtons scenarios={Object.values(SCENARIOS).map((s) => ({ id: s.id, label: s.label }))} />
      </SectionCard>

      <SectionCard title="History" eyebrow="Newest first · last 50 runs" bodyClassName="p-0">
        {(runs ?? []).length === 0 ? (
          <p className="p-4 text-[10.5px] text-ink-muted">No runs yet.</p>
        ) : (
          <div className="neo-table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Detail</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => {
                  const checkInId = (r.evidence_reference ?? "").replace(/^check_in:/, "");
                  return (
                    <tr key={r.id}>
                      <td className="font-bold">{r.scenario_id}</td>
                      <td>
                        <Badge tone={r.status === "passed" ? "sage" : "rose"}>{r.status}</Badge>
                      </td>
                      <td className="text-[10px] text-ink-muted">{formatDateTime(r.started_at)}</td>
                      <td className="max-w-[380px] truncate text-[10px] text-ink-soft" title={
                        r.failure_summary ??
                        (typeof r.actual_result === "object" ? JSON.stringify(r.actual_result) : String(r.actual_result ?? ""))
                      }>
                        {r.failure_summary ??
                          (typeof r.actual_result === "object" ? JSON.stringify(r.actual_result) : String(r.actual_result ?? ""))}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {checkInId ? (
                            <Link href={`/check-ins/${checkInId}`} className="neo-btn h-7 px-2 text-[9.5px]">
                              Evidence
                            </Link>
                          ) : null}
                          <RetryRunButton runId={r.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}


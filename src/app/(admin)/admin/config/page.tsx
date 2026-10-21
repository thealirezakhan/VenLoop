import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetDemoButton } from "@/components/admin-forms";
import { Badge, PageHeader, SectionCard } from "@/components/ui/kit";

export default async function AdminConfigPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const config = [
    { key: "NEXT_PUBLIC_SUPABASE_URL", value: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(unset)" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", value: process.env.SUPABASE_SERVICE_ROLE_KEY ? "(set, server-only)" : "(unset)" },
    { key: "NOTIFICATION_PROVIDER", value: process.env.NOTIFICATION_PROVIDER ?? "mock" },
    { key: "PHONE_PROVIDER", value: process.env.PHONE_PROVIDER ?? "mock" },
    { key: "LLM_PROVIDER", value: process.env.LLM_PROVIDER ?? "none" },
    { key: "execution_mode", value: "simulated — no real calls, SMS, or emails" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Configuration"
        subtitle="Read-only view of server configuration. Secrets are never printed — only presence."
        actions={<Badge tone="butter">execution mode: simulated</Badge>}
      />

      <SectionCard title="Environment" eyebrow="server-side" bodyClassName="p-0">
        <div className="neo-table-wrap">
          <table className="neo-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {config.map((row) => (
                <tr key={row.key}>
                  <td>
                    <code className="text-[10px] font-bold">{row.key}</code>
                  </td>
                  <td className="text-[10px] text-ink-soft">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="rounded-2xl border-[1.5px] border-rose-ink bg-rose p-4">
        <div className="neo-eyebrow text-rose-ink">Danger zone</div>
        <h2 className="font-display text-[15px] font-bold text-rose-ink">Demo data reset</h2>
        <p className="mt-1 max-w-2xl text-[10.5px] leading-relaxed text-rose-ink">
          Deletes operational rows (check-ins, actions, runs, audit trail, assignments) and re-creates the seeded demo
          dataset. Patients and demo accounts are preserved.
        </p>
        <div className="mt-3">
          <ResetDemoButton />
        </div>
      </div>
    </div>
  );
}


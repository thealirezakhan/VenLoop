import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge, PageHeader, SectionCard } from "@/components/ui/kit";
import { formatDateTime } from "@/lib/format";

export default async function AdminAuditPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: events } = await supabase
    .from("audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = events ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Audit events"
        subtitle="Last 100 events, newest first. Append-only: no update or delete policies exist."
        actions={<Badge tone="white">{rows.length} events</Badge>}
      />

      <SectionCard title="Event stream" eyebrow="server-recorded" bodyClassName="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-[10.5px] text-ink-muted">No audit events yet.</p>
        ) : (
          <div className="neo-table-wrap">
            <table className="neo-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-[10px] text-ink-muted">{formatDateTime(e.created_at)}</td>
                    <td>
                      <Badge tone="lilac">{e.event_type}</Badge>
                    </td>
                    <td className="text-[10px]">
                      {e.actor_type}
                      {e.actor_id ? <span className="text-ink-muted"> · {String(e.actor_id).slice(0, 8)}</span> : null}
                    </td>
                    <td className="text-[10px]">
                      {e.entity_type}
                      <span className="text-ink-muted"> · {String(e.entity_id).slice(0, 8)}</span>
                    </td>
                    <td className="max-w-[360px] truncate text-[9.5px] text-ink-soft" title={JSON.stringify(e.details)}>
                      {JSON.stringify(e.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}


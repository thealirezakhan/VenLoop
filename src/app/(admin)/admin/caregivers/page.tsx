import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateCaregiverForm } from "@/components/admin-forms";
import { Avatar, Badge, PageHeader, SectionCard } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

export default async function AdminCaregiversPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: caregivers } = await supabase
    .from("profiles")
    .select("id, display_name, email, is_active, created_at")
    .eq("role", "caregiver")
    .order("created_at");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Caregivers"
        subtitle="Caregiver accounts can only see patients assigned to them. Accounts are deactivated, never deleted."
        actions={<Badge tone="sky">{(caregivers ?? []).length} accounts</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="Create caregiver" eyebrow="Admin only" bodyClassName="p-4">
          <CreateCaregiverForm />
        </SectionCard>

        <SectionCard title="Existing caregivers" eyebrow="Profiles with role caregiver" bodyClassName="p-0">
          {(caregivers ?? []).length === 0 ? (
            <p className="p-4 text-[10.5px] text-ink-muted">No caregivers yet.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {(caregivers ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Avatar name={c.display_name} size={32} tone="lilac" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold">{c.display_name}</div>
                    <div className="truncate text-[9.5px] text-ink-muted">{c.email}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Badge tone={c.is_active ? "sage" : "rose"}>{c.is_active ? "active" : "inactive"}</Badge>
                    <span className="text-[9px] text-ink-muted">since {formatDate(c.created_at)}</span>
                    <code className="text-[9px] text-ink-muted">{c.id.slice(0, 8)}</code>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}


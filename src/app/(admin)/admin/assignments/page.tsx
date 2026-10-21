import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateAssignmentForm, DeactivateButton } from "@/components/admin-forms";
import { Badge, PageHeader, SectionCard } from "@/components/ui/kit";
import { formatDate } from "@/lib/format";

type Join = { display_name?: string } | null;

export default async function AdminAssignmentsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [assignments, caregivers, patients] = await Promise.all([
    supabase
      .from("caregiver_patient_assignments")
      .select("id, is_active, relationship_label, created_at, patients(display_name), profiles:caregiver_id(display_name)")
      .order("created_at"),
    supabase.from("profiles").select("id, display_name").eq("role", "caregiver"),
    supabase.from("patients").select("id, display_name").order("display_name"),
  ]);

  const rows = assignments.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Assignments"
        subtitle="Coverage links between caregivers and patients. Deactivation soft-closes a link and preserves history."
        actions={
          <>
            <Badge tone="sage">{rows.filter((a) => a.is_active).length} active</Badge>
            <Badge tone="white">{rows.filter((a) => !a.is_active).length} inactive</Badge>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="Assign caregiver to patient" eyebrow="Admin only" bodyClassName="p-4">
          <CreateAssignmentForm
            caregivers={(caregivers.data ?? []).map((c) => ({ id: c.id, label: c.display_name }))}
            patients={(patients.data ?? []).map((p) => ({ id: p.id, label: p.display_name }))}
          />
        </SectionCard>

        <SectionCard title="Current coverage" eyebrow="All assignment records" bodyClassName="p-0">
          {rows.length === 0 ? (
            <p className="p-4 text-[10.5px] text-ink-muted">No assignments yet.</p>
          ) : (
            <div className="neo-table-wrap">
              <table className="neo-table">
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Patient</th>
                    <th>Relationship</th>
                    <th>Status</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className={a.is_active ? "" : "opacity-60"}>
                      <td className="font-semibold">{(a.profiles as unknown as Join)?.display_name ?? "?"}</td>
                      <td>{(a.patients as unknown as Join)?.display_name ?? "?"}</td>
                      <td className="text-[10px] text-ink-muted">{a.relationship_label ?? "—"}</td>
                      <td>
                        <Badge tone={a.is_active ? "sage" : "white"}>{a.is_active ? "active" : "inactive"}</Badge>
                      </td>
                      <td className="text-[10px] text-ink-muted">{formatDate(a.created_at)}</td>
                      <td>
                        <div className="flex justify-end">{a.is_active ? <DeactivateButton assignmentId={a.id} /> : null}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}


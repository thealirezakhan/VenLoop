import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreatePatientForm } from "@/components/admin-forms";
import { Avatar, Badge, PageHeader, SectionCard } from "@/components/ui/kit";

export default async function AdminPatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  let query = supabase
    .from("patients")
    .select("id, display_name, timezone, preferred_language, status, mrn, risk_level")
    .order("display_name");
  if (q) query = query.ilike("display_name", `%${q}%`);
  const { data: patients } = await query;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Super admin console"
        title="Patients"
        subtitle="Synthetic demo roster. Caregivers only see their assigned patients; super admins see every record."
        actions={
          <>
            <form action="/admin/patients" className="flex items-center gap-1.5">
              <input name="q" defaultValue={q ?? ""} placeholder="Search patients…" className="neo-input h-8 w-44 py-0 text-[10.5px]" />
              <button type="submit" className="neo-btn h-8 px-2 text-[10px]">
                Search
              </button>
            </form>
            <Link href="/admin/cases" className="neo-btn neo-btn-dark h-8 text-[10px]">
              Escalation queue
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard title="Create patient" eyebrow="Admin only" bodyClassName="p-4">
          <CreatePatientForm />
        </SectionCard>

        <SectionCard title="Existing patients" eyebrow={q ? `Filtered by “${q}”` : "Full roster"} bodyClassName="p-0">
          {(patients ?? []).length === 0 ? (
            <p className="p-4 text-[10.5px] text-ink-muted">No patients match this search.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {(patients ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Avatar name={p.display_name} size={32} tone="sage" />
                  <div className="min-w-0">
                    <Link href={`/patients/${p.id}`} className="text-[11px] font-bold hover:underline">
                      {p.display_name}
                    </Link>
                    <div className="text-[9.5px] text-ink-muted">
                      {p.mrn ?? "no MRN"} · {p.timezone} · {p.preferred_language}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {p.risk_level ? <Badge tone={p.risk_level === "high" ? "rose" : p.risk_level === "medium" ? "butter" : "sage"}>{p.risk_level} risk</Badge> : null}
                    <Badge tone={p.status === "active" ? "sage" : "white"}>{p.status}</Badge>
                    <code className="text-[9px] text-ink-muted">{p.id.slice(0, 8)}</code>
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


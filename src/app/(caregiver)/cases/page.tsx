import { listCases } from "@/lib/server/cases";
import { requireActor } from "@/lib/server/actor";
import { createClient } from "@/lib/supabase/server";
import { CasesWorkspace, type CaseContact } from "@/components/cases-workspace";

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const actor = await requireActor().catch(() => null);
  if (!actor) {
    return <p className="text-sm text-ink-soft">Sign in required.</p>;
  }
  const { filter } = await searchParams;
  const cases = await listCases(actor);
  const openPatientIds = [...new Set(cases.filter((c) => c.resolution_status !== "resolved_reported").map((c) => c.patient_id))];

  const supabase = await createClient();
  const { data: contacts } = openPatientIds.length
    ? await supabase
        .from("emergency_contacts")
        .select("id, patient_id, name, relationship, phone, priority, channels")
        .in("patient_id", openPatientIds)
        .order("priority")
    : { data: [] };

  return (
    <CasesWorkspace
      cases={cases}
      contacts={(contacts ?? []) as CaseContact[]}
      filter={filter ?? "all"}
      baseHref="/cases"
    />
  );
}

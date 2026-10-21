import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";

export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", auth.user.id)
    .single();
  if (!profile) redirect("/login");

  const { count } = await supabase
    .from("escalation_cases")
    .select("id", { count: "exact", head: true })
    .neq("resolution_status", "resolved_reported");

  const isAdmin = profile.role === "super_admin";

  return (
    <AppShell
      shell={isAdmin ? "admin" : "caregiver"}
      displayName={profile.display_name}
      roleLabel={isAdmin ? "Super admin" : "Care coordinator"}
      openCases={count ?? 0}
    >
      {children}
    </AppShell>
  );
}

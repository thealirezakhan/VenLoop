import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role")
    .eq("id", auth.user.id)
    .single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const { count } = await supabase
    .from("escalation_cases")
    .select("id", { count: "exact", head: true })
    .neq("resolution_status", "resolved_reported");

  return (
    <AppShell
      shell="admin"
      displayName={profile.display_name}
      roleLabel="Super admin"
      openCases={count ?? 0}
    >
      {children}
    </AppShell>
  );
}


import { handle } from "@/lib/server/handle";
import { requireSuperAdminActor } from "@/lib/server/actor";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  return handle(async () => {
    await requireSuperAdminActor();
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  });
}

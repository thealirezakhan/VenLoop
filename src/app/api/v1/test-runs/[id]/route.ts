import { handle } from "@/lib/server/handle";
import { requireSuperAdminActor } from "@/lib/server/actor";
import { createClient } from "@/lib/supabase/server";
import { ApiFailure } from "@/lib/server/failures";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    await requireSuperAdminActor();
    const { id } = await params;
    const supabase = await createClient();
    const { data, error } = await supabase.from("test_runs").select("*").eq("id", id).single();
    if (error || !data) throw new ApiFailure("NOT_FOUND", "Test run not found.", 404);
    return data;
  });
}

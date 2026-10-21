import { handle } from "@/lib/server/handle";
import { requireActor } from "@/lib/server/actor";
import { createClient } from "@/lib/supabase/server";
import { ApiFailure } from "@/lib/server/failures";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    await requireActor();
    const { id } = await params;
    const supabase = await createClient();
    const { data, error } = await supabase.from("verification_records").select("*").eq("id", id).single();
    if (error || !data) throw new ApiFailure("NOT_FOUND", "Verification record not found.", 404);
    return data;
  });
}

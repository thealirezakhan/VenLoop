import { handle } from "@/lib/server/handle";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  return handle(async () => {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return { signedOut: true };
  });
}

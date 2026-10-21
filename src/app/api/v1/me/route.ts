import { createClient } from "@/lib/supabase/server";
import { apiData, apiError } from "@/lib/http";

export async function GET() {
  const supabase = await createClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return apiError("UNAUTHENTICATED", "Sign in required.", 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, email, is_active")
    .eq("id", auth.user.id)
    .single();

  if (!profile || !profile.is_active) {
    return apiError("PROFILE_UNAVAILABLE", "No active profile for this account.", 403);
  }

  return apiData({
    id: auth.user.id,
    role: profile.role,
    displayName: profile.display_name,
    email: profile.email,
  });
}

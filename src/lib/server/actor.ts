import { createClient } from "@/lib/supabase/server";
import { ApiFailure } from "./failures";
import type { Actor } from "./check-ins";
import type { Role } from "@/lib/permissions";

/** Resolve the authenticated actor from the session cookie. Never trusts client-supplied ids. */
export async function requireActor(): Promise<Actor> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new ApiFailure("UNAUTHENTICATED", "Sign in required.", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", auth.user.id)
    .single();
  if (!profile || !profile.is_active) {
    throw new ApiFailure("FORBIDDEN", "No active profile for this account.", 403);
  }
  return { id: auth.user.id, role: profile.role as Role };
}

export async function requireSuperAdminActor(): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== "super_admin") {
    throw new ApiFailure("FORBIDDEN", "Super-admin role required.", 403);
  }
  return actor;
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Server-only service-role client. Bypasses RLS — every call site must have
 * already authorized the actor in application code (PRD 3.4, 14).
 */
export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server writes");
  }
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

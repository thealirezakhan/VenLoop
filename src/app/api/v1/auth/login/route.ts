import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { apiData, apiError } from "@/lib/http";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "The request could not be validated.", 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return apiError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
  }

  return apiData({ userId: data.user.id });
}

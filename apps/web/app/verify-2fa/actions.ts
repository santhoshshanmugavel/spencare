"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyTwoFactorChallenge, type AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { safeRedirectTarget } from "@/lib/supabase/middleware";

export interface VerifyTwoFactorResult {
  ok: boolean;
  error?: string;
}

export async function verifyTwoFactorAction(
  code: string,
  redirectParam: string | null,
): Promise<VerifyTwoFactorResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
  const result = await verifyTwoFactorChallenge.execute(ctx, { code });
  if (!result.ok) return { ok: false, error: result.error.message };

  const cookieStore = await cookies();
  cookieStore.delete("spencare_mfa_pending");
  redirect(safeRedirectTarget(redirectParam) ?? "/home");
}

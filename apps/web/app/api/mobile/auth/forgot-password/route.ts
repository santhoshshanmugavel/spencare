import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  email: z.string().email("Invalid email address."),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const serviceClient = createServiceRoleSupabaseClient();
  const allowed = await checkRateLimit(
    serviceClient,
    `password-reset:${parsed.data.email.toLowerCase()}`,
    RATE_LIMITS.PASSWORD_RESET,
  );
  // Enumeration avoidance: always return success, never reveal rate limit or account existence.
  if (!allowed) return Response.json({ ok: true });

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  await anonClient.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: "https://spencare.vercel.app/auth/callback?next=/reset-password",
  });

  // Always return success — enumeration avoidance.
  return Response.json({ ok: true });
}

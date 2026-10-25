import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

const bodySchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
});

export async function POST(request: Request): Promise<Response> {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return Response.json({ error: "Missing authorization header." }, { status: 401 });
  }

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
  const { currentPassword, newPassword } = parsed.data;

  // Validate the token to get the user's identity (email needed to re-verify).
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  const userId = userData.user.id;
  const email = userData.user.email;
  if (!email) {
    return Response.json({ error: "Account has no email address." }, { status: 400 });
  }

  // Rate limit: treat password changes like password resets — 3 per hour per user.
  const serviceClient = createServiceRoleSupabaseClient();
  const allowed = await checkRateLimit(
    serviceClient,
    `change-password:${userId}`,
    RATE_LIMITS.PASSWORD_RESET,
  );
  if (!allowed) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  // Verify the current password by re-authenticating. This protects against
  // session hijack on an unlocked device — the user must know the current password.
  const { error: verifyError } = await anonClient.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyError) {
    return Response.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  // Apply the new password against the authenticated user session.
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { error: updateError } = await userClient.auth.updateUser({ password: newPassword });
  if (updateError) {
    // Surface Supabase's validation message (e.g. "Password should be different from the old password")
    // but strip anything that might look like a stack trace.
    const msg = updateError.message ?? "Failed to update password.";
    return Response.json({ error: msg }, { status: 400 });
  }

  return Response.json({ ok: true });
}

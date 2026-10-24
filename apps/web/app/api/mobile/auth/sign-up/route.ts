import { createClient } from "@supabase/supabase-js";
import { mobileSignUpSchema } from "@spencare/validation";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function clientIpKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? "unknown-ip";
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = mobileSignUpSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const serviceClient = createServiceRoleSupabaseClient();

  const emailKey = `mobile_signup:email:${email}`;
  const ipKey = `mobile_signup:ip:${clientIpKey(request)}`;
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimit(serviceClient, emailKey, RATE_LIMITS.SIGNUP ?? RATE_LIMITS.LOGIN),
    checkRateLimit(serviceClient, ipKey, RATE_LIMITS.SIGNUP ?? RATE_LIMITS.LOGIN),
  ]);
  if (!emailOk || !ipOk) {
    return Response.json({ error: "Too many sign-up attempts. Try again later." }, { status: 429 });
  }

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: authData, error: authError } = await anonClient.auth.signUp({ email, password });

  if (authError) {
    if (authError.message?.toLowerCase().includes("already registered")) {
      return Response.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    return Response.json({ error: authError.message ?? "Sign-up failed." }, { status: 400 });
  }

  if (!authData.session || !authData.user) {
    // Should not happen when enable_confirmations = false, but guard defensively.
    return Response.json(
      { error: "Account created. Please confirm your email before signing in." },
      { status: 202 },
    );
  }

  const { session, user } = authData;

  return Response.json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: { id: user.id, email: user.email },
  });
}

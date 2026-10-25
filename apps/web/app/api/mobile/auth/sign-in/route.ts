import { createHash, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { mobileSignInSchema } from "@spencare/validation";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { encryptSecret } from "@spencare/domain-infra";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function clientIpKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? "unknown-ip";
}

const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = mobileSignInSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const serviceClient = createServiceRoleSupabaseClient();

  const emailKey = `mobile_signin:email:${email}`;
  const ipKey = `mobile_signin:ip:${clientIpKey(request)}`;
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimit(serviceClient, emailKey, RATE_LIMITS.LOGIN),
    checkRateLimit(serviceClient, ipKey, RATE_LIMITS.LOGIN),
  ]);
  if (!emailOk || !ipOk) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  // Use anon client so signInWithPassword creates a real user session.
  // The service-role client bypasses auth entirely and must not be used here.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.session || !authData.user) {
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const { session, user } = authData;

  // Check whether this user has two_factor_enabled.
  const { data: secSettings } = await serviceClient
    .from("security_settings")
    .select("two_factor_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  const requiresMfa = secSettings?.two_factor_enabled === true;

  if (!requiresMfa) {
    return Response.json({
      requires_2fa: false,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user: { id: user.id, email: user.email },
    });
  }

  // Encrypt the session so it can be safely stored server-side until MFA passes.
  const sessionPayload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
  let encryptedSession: string;
  try {
    const buf = encryptSecret(sessionPayload, process.env.CHANNEL_ENCRYPTION_KEY);
    encryptedSession = buf.toString("base64");
  } catch {
    return Response.json({ error: "Internal error. Try again." }, { status: 500 });
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS).toISOString();

  const { error: insertError } = await serviceClient.from("mobile_mfa_challenges").insert({
    token_hash: tokenHash,
    user_id: user.id,
    encrypted_session: encryptedSession,
    expires_at: expiresAt,
  });

  if (insertError) {
    return Response.json({ error: "Internal error. Try again." }, { status: 500 });
  }

  return Response.json({
    requires_2fa: true,
    challenge_token: rawToken,
    expires_at: expiresAt,
  });
}

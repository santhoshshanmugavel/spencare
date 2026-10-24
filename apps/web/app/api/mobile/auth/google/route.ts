import { createHash, randomBytes } from "crypto";
import { mobileGoogleAuthSchema } from "@spencare/validation";
import { checkRateLimit, RATE_LIMITS } from "@spencare/domain-application";
import { encryptSecret } from "@spencare/domain-infra";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function clientIpKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? "unknown-ip";
}

const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Raw shape of the Supabase PKCE token endpoint response.
interface SupabasePkceTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { id?: string; email?: string };
  // Error fields
  error?: string;
  error_description?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = mobileGoogleAuthSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { code, code_verifier } = parsed.data;

  const serviceClient = createServiceRoleSupabaseClient();

  const ipKey = `mobile_google_auth:ip:${clientIpKey(request)}`;
  const ipOk = await checkRateLimit(serviceClient, ipKey, RATE_LIMITS.LOGIN);
  if (!ipOk) {
    return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  // Exchange the PKCE authorization code with Supabase's token endpoint.
  // We do this server-side so we can check MFA before releasing tokens to the client.
  // This mirrors the pattern used in /api/mobile/auth/sign-in — never release tokens
  // to the client until MFA is confirmed.
  const tokenUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=pkce`;
  let tokenData: SupabasePkceTokenResponse;
  try {
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ auth_code: code, code_verifier }),
    });
    tokenData = (await tokenRes.json()) as SupabasePkceTokenResponse;
    if (tokenData.error || !tokenRes.ok) {
      // OAuth code is invalid, expired, or already used.
      return Response.json(
        { error: "Authentication failed. Please try signing in again." },
        { status: 401 },
      );
    }
  } catch {
    return Response.json({ error: "Internal error. Try again." }, { status: 500 });
  }

  const { access_token, refresh_token, expires_at, expires_in, user } = tokenData;
  if (!access_token || !refresh_token || !user?.id) {
    return Response.json({ error: "Authentication failed. Please try signing in again." }, { status: 401 });
  }

  // Normalise expires_at (Supabase may return it directly or as expires_in).
  const sessionExpiresAt = expires_at ?? Math.floor(Date.now() / 1000) + (expires_in ?? 3600);

  // Check whether this user has two-factor authentication enabled.
  const { data: secSettings } = await serviceClient
    .from("security_settings")
    .select("two_factor_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  const requiresMfa = secSettings?.two_factor_enabled === true;

  if (!requiresMfa) {
    return Response.json({
      requires_2fa: false,
      access_token,
      refresh_token,
      expires_at: sessionExpiresAt,
      user: { id: user.id, email: user.email },
    });
  }

  // MFA required — encrypt the session and create a challenge row.
  // The client receives only the opaque challenge token; real tokens are
  // released only after successful TOTP/backup-code verification.
  const sessionPayload = JSON.stringify({
    access_token,
    refresh_token,
    expires_at: sessionExpiresAt,
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

import { createClient } from "@supabase/supabase-js";
import { getProfile } from "@spencare/domain-infra";
import { updateProfile } from "@spencare/domain-application";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

async function resolveUser(request: Request) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) return null;

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await anonClient.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  return {
    userId: data.user.id,
    email: data.user.email ?? "",
    userClient,
    serviceClient: createServiceRoleSupabaseClient(),
  };
}

/** GET /api/mobile/profile/me — fetch profile */
export async function GET(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const profile = await getProfile(user.userClient, user.userId);
    if (!profile) {
      return Response.json({ error: "Profile not found." }, { status: 404 });
    }

    return Response.json({
      profile: {
        display_name: profile.display_name,
        preferred_currency: profile.preferred_currency,
        timezone: profile.timezone,
        privacy_mode_enabled: profile.privacy_mode_enabled,
        onboarding_completed: profile.onboarding_completed_at !== null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch profile.";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/mobile/profile/me — update display name, currency, timezone */
export async function PATCH(request: Request): Promise<Response> {
  const user = await resolveUser(request);
  if (!user) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const ctx = {
    userId: user.userId,
    email: user.email,
    supabase: user.userClient,
    serviceRoleSupabase: user.serviceClient,
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch = body as Record<string, unknown>;
  const displayName = typeof patch.displayName === "string" ? patch.displayName : undefined;
  const preferredCurrency = typeof patch.preferredCurrency === "string" ? patch.preferredCurrency : undefined;
  const timezone = typeof patch.timezone === "string" ? patch.timezone : undefined;

  if (!displayName && !preferredCurrency && !timezone) {
    return Response.json({ error: "At least one field must be provided." }, { status: 400 });
  }

  // profileUpdateSchema requires preferredCurrency and timezone — fetch current values and merge
  const current = await getProfile(user.userClient, user.userId);
  if (!current) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  const result = await updateProfile.execute(ctx, {
    displayName,
    preferredCurrency: preferredCurrency ?? current.preferred_currency,
    timezone: timezone ?? current.timezone,
  });

  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 422 });
  }

  return Response.json({
    profile: {
      display_name: result.value.display_name,
      preferred_currency: result.value.preferred_currency,
      timezone: result.value.timezone,
      privacy_mode_enabled: result.value.privacy_mode_enabled,
    },
  });
}

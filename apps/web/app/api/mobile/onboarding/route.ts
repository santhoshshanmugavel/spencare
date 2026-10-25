import { createClient } from "@supabase/supabase-js";
import { onboardingStepSchema, completeOnboardingSchema } from "@spencare/validation";
import {
  saveOnboardingStep,
  completeOnboarding,
  getOnboardingStatusQuery,
} from "@spencare/domain-application";
import { getProfile } from "@spencare/domain-infra";
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
    supabase: userClient,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

/** GET /api/mobile/onboarding — returns onboarding status + saved profile data */
export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const [status, profile] = await Promise.all([
    getOnboardingStatusQuery(ctx),
    getProfile(ctx.supabase, ctx.userId),
  ]);

  return Response.json({
    completed: status?.completed ?? false,
    displayName: profile?.display_name ?? null,
    preferredCurrency: profile?.preferred_currency ?? "INR",
    timezone: profile?.timezone ?? null,
    interestedCategories: profile?.interested_categories ?? [],
    interestedGoalTypes: profile?.interested_goal_types ?? [],
    monthlyIncomeMinor: profile?.income_amount_minor ?? null,
    incomeFrequency: profile?.income_frequency ?? null,
  });
}

/** POST /api/mobile/onboarding — save a step incrementally */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = onboardingStepSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await saveOnboardingStep.execute(ctx, parsed.data);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 422 });
  }

  return Response.json({ success: true });
}

/** PUT /api/mobile/onboarding — complete onboarding (atomic, validates full payload) */
export async function PUT(request: Request): Promise<Response> {
  const ctx = await resolveUser(request);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = completeOnboardingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await completeOnboarding.execute(ctx, parsed.data);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 422 });
  }

  return Response.json({ success: true });
}

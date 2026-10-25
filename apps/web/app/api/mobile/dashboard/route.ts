import { createClient } from "@supabase/supabase-js";
import {
  getDashboardSummary,
  getCashFlowTrend,
  getCashFlowByCategory,
  listCategories,
} from "@spencare/domain-application";
import { lastDayOfMonth } from "@spencare/domain-core";
import { getProfile } from "@spencare/domain-infra";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

function currentMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export async function GET(request: Request): Promise<Response> {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return Response.json({ error: "Missing authorization header." }, { status: 401 });
  }

  // Validate the token and get the user identity.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  const userId = userData.user.id;
  const email = userData.user.email ?? "";

  // User-scoped client: all queries run under this user's RLS context.
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const serviceClient = createServiceRoleSupabaseClient();

  const ctx = { userId, email, supabase: userClient, serviceRoleSupabase: serviceClient };

  try {
    const periodStart = currentMonthStart();
    const periodEnd = lastDayOfMonth(periodStart);

    const [summary, profile, cashFlowTrend, topCategories, categories] = await Promise.all([
      getDashboardSummary(ctx),
      getProfile(userClient, userId),
      getCashFlowTrend(ctx, 6, periodStart),
      getCashFlowByCategory(ctx, { periodStart, periodEnd }, "expense"),
      listCategories(ctx),
    ]);

    const currency = profile?.preferred_currency ?? "INR";
    const categoryNameMap = new Map(categories.map((c) => [c.id, c.name]));

    return Response.json({
      safeToSpend: summary.safeToSpend,
      accounts: summary.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance_minor: a.balance_minor,
        market_value_minor: a.market_value_minor ?? null,
        credit_limit_minor: a.credit_limit_minor ?? null,
        credit_used_minor: a.credit_used_minor ?? null,
        is_archived: a.is_archived,
      })),
      goals: summary.goals,
      upcomingBills: summary.upcomingBills.map((b) => ({
        id: b.id,
        expected_date: b.expected_date,
        expected_amount_minor: b.expected_amount_minor,
        status: b.status,
        definition: {
          name: b.bill_definitions?.merchant_pattern || "Unknown bill",
          currency,
        },
      })),
      cashFlow: summary.cashFlow,
      netWorth: summary.netWorth,
      cashFlowTrend: cashFlowTrend.map((p) => ({
        periodStart: p.periodStart,
        incomeMinor: p.totals.incomeMinor,
        expenseMinor: p.totals.expenseMinor,
        netMinor: p.totals.netMinor,
      })),
      topCategories: topCategories.slice(0, 5).map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryId ? (categoryNameMap.get(c.categoryId) ?? "Uncategorized") : "Uncategorized",
        amountMinor: c.amountMinor,
        percent: c.percent,
      })),
      privacyMode: profile?.privacy_mode_enabled ?? false,
      preferredCurrency: currency,
    });
  } catch {
    return Response.json({ error: "Failed to load dashboard data." }, { status: 500 });
  }
}

import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight, Target } from "lucide-react";
import {
  getProfile,
  getSafeToSpend,
  getNetWorth,
  listAccounts,
  listBudgetsWithUsage,
  listGoals,
  type AuthContext,
} from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { Button } from "@/components/ui/button";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { signOutAction } from "../(auth)/actions";
import { HomeContent, type SafeToSpendPlain, type NetWorthPlain } from "./home-content";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Phase 14 (Dashboard/Home, DD-01 approved): adds the one net-new element
 * information-architecture.md's CF-D01 resolution calls for -- a
 * persistent Safe-to-Spend header -- plus SP-051's setup-nudge grid.
 *
 * Phase 29 Section 7/29 revisits the original "deliberately NOT a
 * monolithic dashboard, no Net Worth" scope: Home now also shows
 * Available Credit / Investments / Net Worth via the same shared
 * `<FinancialLayersCard>` Cash Flow Overview uses, composing `getNetWorth`
 * and the same investment-total aggregation `cash-flow/page.tsx` already
 * does -- no second implementation of either.
 */
export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // middleware guarantees this never renders unauthenticated

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  // Every one of these is an already-existing, unmodified Phase 7/9/10/11
  // query -- no new domain/application code, per the locked "build only
  // what the approved UI actually consumes" scope. `getSafeToSpend` is
  // reused byte-for-byte; `listAccounts`/`listBudgetsWithUsage`/`listGoals`
  // only drive which SP-051 nudge cards to show, the same composition
  // idiom already used by cash-flow/page.tsx and goals/page.tsx.
  const [profile, safeToSpendResult, netWorthResult, accounts, budgetUsages, goals] = await Promise.all([
    getProfile(ctx),
    getSafeToSpend(ctx),
    getNetWorth(ctx),
    listAccounts(ctx),
    listBudgetsWithUsage(ctx, currentPeriodStart()),
    listGoals(ctx),
  ]);

  // Real defect class avoided proactively (Phase 13 lesson): `Money` class
  // instances carry a `toJSON` method that Next.js's Server->Client
  // Component boundary rejects outright. Converting to a plain shape here
  // before it ever reaches "use client" `HomeContent`.
  const safeToSpend: SafeToSpendPlain = {
    state: safeToSpendResult.state,
    amountMinor: Number(safeToSpendResult.amount.amountMinorUnits),
    currency: safeToSpendResult.amount.currencyCode,
    ownedSpendableMinor: Number(safeToSpendResult.ownedSpendableTotal.amountMinorUnits),
    creditAvailableMinor: Number(safeToSpendResult.creditAvailableTotal.amountMinorUnits),
    goalReservedMinor: Number(safeToSpendResult.goalReservedTotal.amountMinorUnits),
    upcomingBillsMinor: Number(safeToSpendResult.upcomingBillsTotal.amountMinorUnits),
  };
  const netWorth: NetWorthPlain = {
    netWorthMinor: Number(netWorthResult.netWorth.amountMinorUnits),
    totalAssetsMinor: Number(netWorthResult.totalAssets.amountMinorUnits),
    totalLiabilitiesMinor: Number(netWorthResult.totalLiabilities.amountMinorUnits),
    currency: netWorthResult.netWorth.currencyCode,
  };
  const investmentTotalMinor = accounts
    .filter((a) => a.type === "investment")
    .reduce((sum, a) => sum + (a.market_value_minor ?? 0), 0);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={[
            { key: "home", label: "Home", icon: <HomeIcon className="size-5" />, href: "/home" },
            {
              key: "cash-flow",
              label: "Cash Flow",
              icon: <ArrowLeftRight className="size-5" />,
              href: "/cash-flow",
            },
            { key: "goals", label: "Goals", icon: <Target className="size-5" />, href: "/goals" },
            { key: "settings", label: "Settings", icon: <SettingsIcon className="size-5" />, href: "/settings/profile" },
          ]}
        />
      }
    >
      <div className="mx-auto max-w-2xl space-y-6 py-8">
        <HomeContent
          displayName={profile?.display_name ?? null}
          safeToSpend={safeToSpend}
          netWorth={netWorth}
          investmentTotalMinor={investmentTotalMinor}
          masked={profile?.privacy_mode_enabled ?? false}
          hasAccounts={accounts.length > 0}
          hasBudget={budgetUsages.length > 0}
          hasGoals={goals.length > 0}
        />
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as {user.email}. This is Home with your Safe-to-Spend snapshot,
          setup checklist, and the Spensa launcher above; Cash Flow, Goals, and Settings each have
          their own dedicated pages.
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="touch">
            Sign out
          </Button>
        </form>
      </div>
    </AppShell>
  );
}

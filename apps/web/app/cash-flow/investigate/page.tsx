import { getDecisionInvestigation, getProfile, type AuthContext } from "@spencare/domain-application";
import { lastDayOfMonth } from "@spencare/domain-core";
import Image from "next/image";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { InvestigationView } from "./investigation-view";

const AVAILABLE_MONTHS_BACK = 12;

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function shiftMonth(periodStart: string, delta: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function buildAvailableMonths(from: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const value = shiftMonth(from, -i);
    const [year, month] = value.split("-").map(Number);
    const label = new Date(Date.UTC(year!, month! - 1, 1)).toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return { value, label };
  });
}

export default async function InvestigatePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  const thisMonth = currentPeriodStart();
  const lastMonth = shiftMonth(thisMonth, -1);
  const availableMonths = buildAvailableMonths(thisMonth, AVAILABLE_MONTHS_BACK);

  // Profile must be fetched first to resolve currency — preferred_currency is
  // the authoritative source; hard-coding INR would silently wrong-label amounts
  // for any user whose profile differs.
  const profile = await getProfile(ctx);
  const currency = profile?.preferred_currency ?? "INR";

  const initialResult = await getDecisionInvestigation(ctx, {
    metric: "total_expenses",
    currentPeriod: { start: thisMonth, end: lastDayOfMonth(thisMonth) },
    comparisonPeriod: { start: lastMonth, end: lastDayOfMonth(lastMonth) },
    currency,
  }).catch((err: unknown) => ({
    _error: err instanceof Error ? err.message : "Failed to load investigation.",
  }));

  const masked = profile?.privacy_mode_enabled ?? false;

  const isError = initialResult && "_error" in initialResult;
  const data = isError ? null : initialResult && !("_error" in initialResult) ? initialResult : null;
  const error = isError && "_error" in initialResult ? String(initialResult._error) : null;

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<Image src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={
            <>
              <PrivacyModeToggle initialEnabled={masked} />
              <NotificationBell />
            </>
          }
          userProfile={{
            name: profile?.display_name ?? null,
            email: user.email ?? "",
            avatarUrl: null,
          }}
        />
      }
    >
      <div className="mx-auto max-w-4xl">
        <CashFlowTabs active="investigate" />
      </div>
      <div className="mx-auto max-w-4xl py-8">
        <InvestigationView
          initialResult={data}
          initialError={error}
          currency={currency}
          masked={masked}
          availableMonths={availableMonths}
          initialCurrentMonth={thisMonth}
          initialComparisonMonth={lastMonth}
          initialMetric="total_expenses"
        />
      </div>
    </AppShell>
  );
}

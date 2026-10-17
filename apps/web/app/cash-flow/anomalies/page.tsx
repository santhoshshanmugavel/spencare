import { getAnomalyReport, getProfile, type AuthContext } from "@spencare/domain-application";
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
import { AnomaliesView } from "./anomalies-view";

const DEFAULT_BASELINE_MONTHS = 3;

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export default async function AnomaliesPage() {
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

  const profile = await getProfile(ctx);
  const currency = profile?.preferred_currency ?? "INR";
  const masked = profile?.privacy_mode_enabled ?? false;

  const thisMonth = currentPeriodStart();
  const currentPeriod = { start: thisMonth, end: lastDayOfMonth(thisMonth) };

  const initialReport = await getAnomalyReport(ctx, {
    currentPeriod,
    currency,
    baselineMonths: DEFAULT_BASELINE_MONTHS,
  }).catch((err: unknown) => ({
    _error: err instanceof Error ? err.message : "Failed to load anomaly report.",
  }));

  const isError = initialReport && "_error" in initialReport;
  const data = isError ? null : ("findings" in initialReport ? initialReport : null);
  const error = isError ? String((initialReport as { _error: string })._error) : null;

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
        <CashFlowTabs active="anomalies" />
      </div>
      <div className="mx-auto max-w-4xl py-8">
        <AnomaliesView
          initialReport={data}
          initialError={error}
          currency={currency}
          masked={masked}
          currentPeriod={currentPeriod}
          baselineMonths={DEFAULT_BASELINE_MONTHS}
        />
      </div>
    </AppShell>
  );
}

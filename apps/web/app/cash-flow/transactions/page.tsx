import { Home as HomeIcon, Settings as SettingsIcon, ArrowLeftRight } from "lucide-react";
import { getProfile, listAccounts, listCategories, listTransactions, type AuthContext } from "@spencare/domain-application";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { TransactionList } from "./transaction-list";

/**
 * Route matches SP-089/090's OBSERVED `/cash-flow/transactions`. This page
 * renders only the transaction-list slice (SP-081's row anatomy) -- the
 * surrounding Cash Flow page chrome (donut, spend-limits panel, month
 * stepper, AI insight banner, the SP-081-vs-SP-089/090 toolbar question)
 * is step-12 Cash Flow per design-decision-gate.md §I, out of Phase 8's
 * scope. "Cash Flow" is one of NavigationRail's own documented 4
 * destinations (component-inventory.md §18) -- wiring it here is
 * completing an already-specified nav item, not inventing one.
 */
export default async function TransactionsPage() {
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
  const [transactions, accounts, categories, profile] = await Promise.all([
    listTransactions(ctx),
    listAccounts(ctx),
    listCategories(ctx),
    getProfile(ctx),
  ]);
  const spendEligibleAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

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
              href: "/cash-flow/transactions",
              active: true,
            },
            {
              key: "settings",
              label: "Settings",
              icon: <SettingsIcon className="size-5" />,
              href: "/settings/profile",
            },
          ]}
        />
      }
    >
      <div className="mx-auto max-w-2xl py-8">
        <TransactionList
          initialTransactions={transactions}
          accounts={spendEligibleAccounts}
          categories={categories}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}

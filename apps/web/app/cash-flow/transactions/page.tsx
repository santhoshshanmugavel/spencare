import { getProfile, listAccounts, listCategories, listTransactions, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { hasCapability } from "@spencare/domain-core";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
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
  // Phase 28: any account that can participate in SOME transaction/transfer
  // role (Bank/Cash/Credit Card) -- the kind-specific narrowing (Expense
  // vs. Income vs. Transfer From/To) happens inside AddTransactionSheet/
  // EditTransactionSheet via the same shared capability model. Investment
  // is excluded entirely: it is not a normal-transaction account.
  const spendEligibleAccounts = accounts.filter(
    (a) =>
      hasCapability(a.type, "expenseSource") ||
      hasCapability(a.type, "incomeTarget") ||
      hasCapability(a.type, "transferSource") ||
      hasCapability(a.type, "transferDestination"),
  );


  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<span className="text-lg font-bold text-primary">S</span>}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <div className="mx-auto max-w-2xl">
        <CashFlowTabs active="transactions" />
      </div>
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

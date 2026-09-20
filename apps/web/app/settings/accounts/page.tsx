import { getProfile, listAccounts, listGoals, listCardPaymentSources, listUpcoming, listAllLoans, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import { deriveCardPaymentReserveState } from "@spencare/domain-infra";
import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { SettingsShell } from "@/components/spencare/settings-nav";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { AccountList } from "./account-list";

export default async function AccountsSettingsPage() {
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
  const [accounts, profile, paymentSources, goals, commitmentOccurrences, loans] = await Promise.all([
    listAccounts(ctx),
    getProfile(ctx),
    listCardPaymentSources(ctx),
    listGoals(ctx),
    listUpcoming(ctx, { limit: 200 }),
    listAllLoans(ctx),
  ]);

  // Per bank/cash account: how much is reserved for card payments and goals.
  const cardReserveState = deriveCardPaymentReserveState(accounts, paymentSources);
  const cardReservePerAccount = cardReserveState.perPaymentAccount;

  // For credit card display: which bank account pays for which credit card.
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const paymentAccountNameByCardId: Record<string, string> = {};
  for (const src of paymentSources) {
    const bank = accountById.get(src.payment_account_id);
    if (bank) paymentAccountNameByCardId[src.credit_card_account_id] = bank.name;
  }

  // Per bank/cash account: sum of saved_amount_minor for goals funded from that account.
  const goalReservePerAccount: Record<string, number> = {};
  for (const goal of goals) {
    if (goal.status === "active") {
      goalReservePerAccount[goal.funding_account_id] =
        (goalReservePerAccount[goal.funding_account_id] ?? 0) + goal.saved_amount_minor;
    }
  }

  // Per bank/cash account: sum of reserved_minor from upcoming commitment occurrences.
  // Group by reserve_account_id (the bank/cash account where money is logically protected).
  // Credit card commitments have reserve_account_id = null and are excluded here.
  const commitmentReservePerAccount: Record<string, number> = {};
  for (const occ of commitmentOccurrences) {
    const reserveId = occ.planned_commitments?.reserve_account_id;
    if (reserveId && occ.reserved_minor > 0) {
      commitmentReservePerAccount[reserveId] =
        (commitmentReservePerAccount[reserveId] ?? 0) + occ.reserved_minor;
    }
  }

  // Per bank/cash account: sum of installment_amount_minor for active loans with that reserve_account_id.
  const loanReservePerAccount: Record<string, number> = {};
  for (const loan of loans) {
    if (loan.status === "active" && loan.reserve_account_id) {
      loanReservePerAccount[loan.reserve_account_id] =
        (loanReservePerAccount[loan.reserve_account_id] ?? 0) + loan.installment_amount_minor;
    }
  }

  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null = _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);
  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<img src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={<><PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} /><NotificationBell /></>}
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <SettingsShell active="accounts">
        <AccountList
          initialAccounts={accounts}
          masked={profile?.privacy_mode_enabled ?? false}
          cardReservePerAccount={cardReservePerAccount}
          goalReservePerAccount={goalReservePerAccount}
          commitmentReservePerAccount={commitmentReservePerAccount}
          cardReserveDetails={cardReserveState.perCard}
          loanReservePerAccount={loanReservePerAccount}
          paymentAccountNameByCardId={paymentAccountNameByCardId}
          paymentSources={paymentSources}
        />
      </SettingsShell>
    </AppShell>
  );
}

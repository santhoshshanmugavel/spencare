import { getProfile, listAccounts, listGoals, listCardPaymentSources, listCategories, listUpcoming, listAllLoans, getCreditCardBillingStatus, type AuthContext, getProfileForDisplay,
} from "@spencare/domain-application";
import type {
  AccountReserveBreakdown,
  CommitmentReserveItem,
  CreditCardBillingStatusView,
  GoalReserveItem,
  LoanReserveItem,
} from "./account-details-sheet";
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
  const [accounts, profile, paymentSources, goals, commitmentOccurrences, loans, categories] = await Promise.all([
    listAccounts(ctx),
    getProfile(ctx),
    listCardPaymentSources(ctx),
    listGoals(ctx),
    listUpcoming(ctx, { limit: 200 }),
    listAllLoans(ctx),
    listCategories(ctx),
  ]);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  // Per bank/cash account: how much is reserved for card payments and goals.
  const cardReserveState = deriveCardPaymentReserveState(accounts, paymentSources);
  const cardReservePerAccount = cardReserveState.perPaymentAccount;

  // Per credit card: the canonical billing status (statement balance,
  // payment status) -- same source every other surface uses. Fetched once
  // here (typically a handful of cards per user, never all transactions)
  // rather than each UI component re-deriving its own view of "what's owed."
  const todayIso = new Date().toISOString().slice(0, 10);
  const creditCardAccounts = accounts.filter((a) => a.type === "credit_card" && !a.is_archived);
  const billingStatusEntries = await Promise.all(
    creditCardAccounts.map(async (a) => {
      const status = await getCreditCardBillingStatus(ctx, a, todayIso);
      return [a.id, status] as const;
    }),
  );
  const billingStatusByCardId: Record<string, CreditCardBillingStatusView> = {};
  for (const [id, status] of billingStatusEntries) {
    if (status) {
      billingStatusByCardId[id] = {
        statementBalanceMinor: status.statementBalanceMinor,
        paymentStatus: status.paymentStatus,
        obligationStatus: status.obligation.status,
        // Due date + paid/remaining feed the Accounts card's bill
        // status row so a paid or zero-activity cycle can never
        // render "Bill overdue by Xd" from pure date math. Carried
        // alongside the fields already consumed by the details sheet.
        dueDate: status.obligation.dueDate,
        paidMinor: status.obligation.paidMinor,
        remainingMinor: status.obligation.remainingMinor,
        nextBillDueDate: status.snapshot.nextCycle.dueDate,
      };
    }
  }

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

  // Per-account itemized breakdowns. Built from the SAME source lists
  // the aggregates were derived from so the items always reconcile
  // exactly to the aggregate on the bank-detail sheet (no second
  // financial query, no risk of drift). Breakdown shape is defined
  // alongside the sheet in account-details-sheet.tsx so types travel
  // with the consumer.
  const reserveBreakdownByAccount = new Map<string, AccountReserveBreakdown>();
  function bucket(accountId: string): AccountReserveBreakdown {
    const existing = reserveBreakdownByAccount.get(accountId);
    if (existing) return existing;
    const next: AccountReserveBreakdown = { goals: [], commitments: [], loans: [] };
    reserveBreakdownByAccount.set(accountId, next);
    return next;
  }
  for (const goal of goals) {
    if (goal.status !== "active" || goal.saved_amount_minor <= 0) continue;
    const item: GoalReserveItem = {
      id: goal.id,
      name: goal.name,
      reservedMinor: goal.saved_amount_minor,
      targetMinor: goal.target_amount_minor,
      targetDate: goal.target_date,
    };
    bucket(goal.funding_account_id).goals.push(item);
  }

  // Multiple upcoming occurrences for the same commitment collapse into
  // one row per commitment per account: the row's reservedMinor is the
  // sum of reserved_minor across its occurrences (matches the account
  // aggregate), and the "Next payment" fields come from the NEAREST
  // upcoming occurrence (earliest due_date).
  const commitmentAccumulator = new Map<string, Map<string, CommitmentReserveItem>>();
  for (const occ of commitmentOccurrences) {
    const reserveId = occ.planned_commitments?.reserve_account_id;
    if (!reserveId || occ.reserved_minor <= 0) continue;
    const perAccount = commitmentAccumulator.get(reserveId) ?? new Map<string, CommitmentReserveItem>();
    commitmentAccumulator.set(reserveId, perAccount);
    const existing = perAccount.get(occ.commitment_id);
    if (!existing) {
      perAccount.set(occ.commitment_id, {
        id: occ.commitment_id,
        name: occ.planned_commitments?.name ?? "Commitment",
        categoryName: occ.planned_commitments?.category_id
          ? categoryNameById.get(occ.planned_commitments.category_id) ?? null
          : null,
        frequency: occ.planned_commitments?.payment_frequency ?? "monthly",
        reservedMinor: occ.reserved_minor,
        nextPaymentAmountMinor: occ.amount_minor,
        nextPaymentDate: occ.due_date,
        nextOccurrenceReservedMinor: occ.reserved_minor,
      });
    } else {
      existing.reservedMinor += occ.reserved_minor;
      if (occ.due_date < existing.nextPaymentDate) {
        // This occurrence is earlier -- it becomes the "Next payment"
        // the user sees for this commitment row.
        existing.nextPaymentAmountMinor = occ.amount_minor;
        existing.nextPaymentDate = occ.due_date;
        existing.nextOccurrenceReservedMinor = occ.reserved_minor;
      }
    }
  }
  for (const [accountId, perCommitment] of commitmentAccumulator) {
    const items = Array.from(perCommitment.values()).sort((a, b) =>
      a.nextPaymentDate.localeCompare(b.nextPaymentDate),
    );
    bucket(accountId).commitments.push(...items);
  }

  for (const loan of loans) {
    if (loan.status !== "active" || !loan.reserve_account_id) continue;
    const item: LoanReserveItem = {
      id: loan.id,
      name: loan.name,
      reservedMinor: loan.installment_amount_minor,
      nextInstallmentAmountMinor: loan.installment_amount_minor,
      nextPaymentDate: loan.next_payment_date,
      frequency: loan.repayment_frequency,
      outstandingMinor: loan.outstanding_minor,
    };
    bucket(loan.reserve_account_id).loans.push(item);
  }
  // Deterministic order so the sheet never re-sorts between refreshes.
  for (const bd of reserveBreakdownByAccount.values()) {
    bd.goals.sort((a, b) => b.reservedMinor - a.reservedMinor);
    bd.loans.sort((a, b) => (a.nextPaymentDate ?? "").localeCompare(b.nextPaymentDate ?? ""));
  }
  const reserveBreakdownByAccountRecord: Record<string, AccountReserveBreakdown> = {};
  for (const [k, v] of reserveBreakdownByAccount) reserveBreakdownByAccountRecord[k] = v;

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
          billingStatusByCardId={billingStatusByCardId}
          reserveBreakdownByAccount={reserveBreakdownByAccountRecord}
        />
      </SettingsShell>
    </AppShell>
  );
}

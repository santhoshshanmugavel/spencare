import {
  getProfile,
  listAccounts,
  listCommitments,
  listUpcoming,
  listAllLoans,
  listBillPredictions,
  listCategories,
  predictNextOccurrence,
  type AuthContext,
  type PlannedCommitmentRow,
  type PlannedCommitmentOccurrenceWithCommitment,
  type RecurrenceInterval,
  getProfileForDisplay,
} from "@spencare/domain-application";
import { projectOccurrenceDates, type PaymentFrequency } from "@spencare/domain-core";

import { AppShell } from "@/components/spencare/app-shell";
import { NavigationRail } from "@/components/spencare/navigation-rail";
import { PRIMARY_NAV_ITEMS } from "@/lib/nav-items";
import { PrivacyModeToggle } from "@/components/spencare/privacy-mode-toggle";
import { NotificationBell } from "@/components/spencare/notification-bell";
import { CashFlowTabs } from "@/components/spencare/cash-flow-tabs";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { UpcomingDashboard } from "./upcoming-dashboard";

export type PrepEvent = {
  commitment: PlannedCommitmentRow;
  date: string;
  amountMinor: number;
};

/** A future occurrence that has not yet been persisted in the DB. Computed on-the-fly from the recurrence rule. */
export type ProjectedOccurrence = {
  commitment: PlannedCommitmentRow;
  date: string;
  amountMinor: number;
};

function generatePrepEvents(
  commitments: PlannedCommitmentRow[],
  occurrences: PlannedCommitmentOccurrenceWithCommitment[],
  windowEnd: string,
): PrepEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const events: PrepEvent[] = [];

  for (const c of commitments) {
    if (!c.saving_cadence || !c.saving_amount_minor || !c.first_saving_date) continue;
    if (c.status !== "active" || c.deleted_at) continue;

    const occ = occurrences.find((o) => o.commitment_id === c.id);
    if (!occ) continue;
    if (occ.reserved_minor >= occ.amount_minor) continue;

    const paymentCutoff = occ.due_date < windowEnd ? occ.due_date : windowEnd;

    // Fast-forward from first_saving_date to the first future saving date
    let cur = c.first_saving_date;
    while (cur < today) {
      const next = predictNextOccurrence(cur, c.saving_cadence as RecurrenceInterval);
      if (!next || next <= cur) break;
      cur = next;
    }

    // Emit saving events that fall within [today, paymentCutoff)
    let iter = 0;
    while (cur < paymentCutoff && iter < 60) {
      iter++;
      if (cur >= today) {
        events.push({ commitment: c, date: cur, amountMinor: c.saving_amount_minor });
      }
      const next = predictNextOccurrence(cur, c.saving_cadence as RecurrenceInterval);
      if (!next || next <= cur) break;
      cur = next;
    }
  }

  return events;
}

/** Unified forward-looking view: planned commitment occurrences + loan installments + auto-detected bill predictions. */
export default async function UpcomingPage() {
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

  // 12-month window so every tab in the upcoming dashboard has data
  const windowEnd = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const [accounts, commitmentOccurrences, commitments, loans, billPredictions, profile, categories] = await Promise.all([
    listAccounts(ctx),
    listUpcoming(ctx, { limit: 500, dueBefore: windowEnd }),
    listCommitments(ctx),
    listAllLoans(ctx),
    listBillPredictions(ctx, { status: ["open", "overdue"] }),
    getProfile(ctx),
    listCategories(ctx),
  ]);

  const prepEvents = generatePrepEvents(commitments, commitmentOccurrences, windowEnd);

  // Build persistedMonths from ALL occurrence statuses (upcoming, paid, skipped) so that paid
  // months are not re-projected. listUpcoming only returns status='upcoming' occurrences, so we
  // need a separate lightweight query for the full deduplication set.
  const { data: allOccurrenceKeys } = await supabase
    .from("planned_commitment_occurrences")
    .select("commitment_id, due_date")
    .eq("user_id", user.id)
    .lte("due_date", windowEnd);

  const persistedMonths = new Set<string>();
  for (const occ of allOccurrenceKeys ?? []) {
    persistedMonths.add(`${occ.commitment_id}:${occ.due_date.slice(0, 7)}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const projectedOccurrences: ProjectedOccurrence[] = [];

  for (const c of commitments) {
    if (c.status !== "active" || c.deleted_at || !c.next_payment_date) continue;
    // "irregular" is not in PaymentFrequency; cast and skip if not a known value
    const freq = c.payment_frequency as string;
    if (freq === "irregular") continue;

    const dates = projectOccurrenceDates(
      c.next_payment_date,
      freq as PaymentFrequency,
      today,
      windowEnd,
      c.payment_day_rule ?? undefined,
    );

    for (const date of dates) {
      const monthKey = `${c.id}:${date.slice(0, 7)}`;
      if (!persistedMonths.has(monthKey)) {
        projectedOccurrences.push({ commitment: c, date, amountMinor: c.amount_minor });
      }
    }
  }

  const _displayProfile = await getProfileForDisplay(ctx).catch(() => null);
  const navAvatarUrl: string | null =
    _displayProfile?.avatarSignedUrl ?? (user.user_metadata?.avatar_url as string | null ?? null);

  return (
    <AppShell
      rail={
        <NavigationRail
          brand={<img src="/spencare-icon.svg" alt="Spencare" width={24} height={24} className="shrink-0" />}
          items={PRIMARY_NAV_ITEMS}
          extraFooterSlot={
            <>
              <PrivacyModeToggle initialEnabled={profile?.privacy_mode_enabled ?? false} />
              <NotificationBell />
            </>
          }
          userProfile={{ name: profile?.display_name ?? null, email: user.email ?? "", avatarUrl: navAvatarUrl }}
        />
      }
    >
      <div className="mx-auto max-w-2xl">
        <CashFlowTabs active="upcoming" />
      </div>
      <div className="mx-auto max-w-2xl py-8">
        <UpcomingDashboard
          commitmentOccurrences={commitmentOccurrences}
          commitments={commitments}
          billPredictions={billPredictions}
          loans={loans}
          accounts={accounts}
          categories={categories}
          prepEvents={prepEvents}
          projectedOccurrences={projectedOccurrences}
          masked={profile?.privacy_mode_enabled ?? false}
        />
      </div>
    </AppShell>
  );
}

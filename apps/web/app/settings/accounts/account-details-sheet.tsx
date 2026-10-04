"use client";

import { useState } from "react";
import {
  calculateCreditCardBillCycle,
  billingConfigFromAccount,
  derivePreparationStatus,
  Money as DomainMoney,
  type CreditCardPaymentStatus,
} from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import type { CardReserveDetail } from "@spencare/domain-infra";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/spencare/money";
import { Separator } from "@/components/ui/separator";
import { Landmark, Banknote, CreditCard, CircleCheck, ChevronDown, ChevronRight } from "lucide-react";
import { CreditCardPaymentDialog } from "@/app/cash-flow/upcoming/credit-card-actions";

const CURRENCY = "INR";

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PAYMENT_STATUS_LABELS: Record<CreditCardPaymentStatus, string> = {
  statement_closed: "Billed",
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue",
  paid: "Paid",
};

function dueDateHint(daysUntilDue: number): string {
  if (daysUntilDue === 0) return "Due today";
  if (daysUntilDue === 1) return "Due tomorrow";
  if (daysUntilDue > 0) return `Due in ${daysUntilDue} days`;
  if (daysUntilDue === -1) return "Overdue by 1 day";
  return `Overdue by ${Math.abs(daysUntilDue)} days`;
}

function formatDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Row({ label, children, highlighted }: { label: string; children: React.ReactNode; highlighted?: boolean }) {
  return (
    <div className={["flex items-center justify-between py-2.5", highlighted ? "text-foreground font-medium" : ""].join(" ")}>
      <span className={highlighted ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{label}</span>
      <span className={highlighted ? "text-sm font-semibold tabular-nums" : "text-sm tabular-nums"}>{children}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** Plain, server-fetched billing status for the credit card currently being viewed (null while unknown/loading, or when billing days aren't configured). The paid/remaining fields are optional only because older server routes did not populate them; the current page.tsx fills them. */
export interface CreditCardBillingStatusView {
  statementBalanceMinor: number;
  paymentStatus: CreditCardPaymentStatus;
  obligationStatus: "unpaid" | "partial" | "paid";
  /** Bill due date (= most recently closed cycle's dueDate). Null when the card is new/no closed cycle yet. */
  dueDate?: string | null;
  /** Minor units already paid against this bill. */
  paidMinor?: number;
  /** Minor units still owed on this bill (0 when paid). */
  remainingMinor?: number;
}

/** One goal contributing to the account's goal reservation. */
export interface GoalReserveItem {
  id: string;
  name: string;
  reservedMinor: number;
  targetMinor: number;
  targetDate: string | null;
}

/** One commitment contributing to the account's commitment reservation. */
export interface CommitmentReserveItem {
  id: string;
  name: string;
  categoryName: string | null;
  frequency: string;
  /** Sum of reserved_minor across every upcoming occurrence of this commitment on this account. Matches the account aggregate exactly. */
  reservedMinor: number;
  /** The nearest upcoming occurrence's expected payment amount in minor units. */
  nextPaymentAmountMinor: number;
  /** The nearest upcoming occurrence's due date (YYYY-MM-DD). */
  nextPaymentDate: string;
  /** Minor units already protected toward the next occurrence (for the preparation-status badge). */
  nextOccurrenceReservedMinor: number;
}

/** One loan contributing to the account's loan reservation. */
export interface LoanReserveItem {
  id: string;
  name: string;
  reservedMinor: number;
  nextInstallmentAmountMinor: number;
  nextPaymentDate: string | null;
  frequency: string;
  outstandingMinor: number | null;
}

/** Per-account itemized breakdown behind the aggregate reserve rows. Totals of each array exactly reconcile to the aggregate on the same props. */
export interface AccountReserveBreakdown {
  goals: GoalReserveItem[];
  commitments: CommitmentReserveItem[];
  loans: LoanReserveItem[];
}

interface AccountDetailsSheetProps {
  account: AccountRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  masked: boolean;
  goalReserveMinor: number;
  commitmentReserveMinor: number;
  loanReserveMinor: number;
  cardReserveMinor: number;
  cardReserveDetails: CardReserveDetail[];
  billingStatus?: CreditCardBillingStatusView | null;
  /** All of this user's accounts -- used to pick the bank/cash source when
   *  opening Pay Bill from the credit-card details view. Optional for
   *  callers that render a non-CC account; the Pay Bill CTA simply hides
   *  when the list isn't supplied. */
  allAccounts?: AccountRow[];
  /** Fired after a successful Pay Bill so the host page can revalidate.
   *  Optional; defaults to a no-op (the dialog already shows the toast). */
  onBillPaid?: () => void;
  /** Per-item breakdown behind the goals/commitments/loans aggregate rows.
   *  Each category's items sum EXACTLY to the matching aggregate on this
   *  same props object -- see page.tsx for the derivation. Omit when the
   *  caller only wants aggregate rows (older call sites). */
  reserveBreakdown?: AccountReserveBreakdown;
}

export function AccountDetailsSheet({
  account,
  open,
  onOpenChange,
  masked,
  goalReserveMinor,
  commitmentReserveMinor,
  loanReserveMinor,
  cardReserveMinor,
  cardReserveDetails,
  billingStatus = null,
  allAccounts = [],
  onBillPaid,
  reserveBreakdown,
}: AccountDetailsSheetProps) {
  const [payBillOpen, setPayBillOpen] = useState(false);
  // Section expansion state. Each key corresponds to one reserve
  // category; the row stays collapsed until the user clicks the chevron.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  if (!account) return null;

  const money = (minor: number, currency = CURRENCY) =>
    DomainMoney.fromMinorUnits(BigInt(minor), currency);

  const isBank = account.type === "bank" || account.type === "cash";
  const isCC = account.type === "credit_card";

  const Icon = account.type === "credit_card" ? CreditCard : account.type === "cash" ? Banknote : Landmark;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={[
          "max-h-[90vh] overflow-y-auto rounded-t-2xl",
          // Tight horizontal padding on phones so narrow screens keep as
          // much content width as possible; relaxes on tablet+. Bottom
          // honors the home-indicator safe-area inset.
          "px-4 sm:px-6",
          "pb-[calc(2rem+env(safe-area-inset-bottom))]",
        ].join(" ")}
      >
        <SheetHeader className="mb-2">
          <div className="flex items-center gap-3 pt-2">
            <Icon className="size-5 text-muted-foreground" />
            <SheetTitle className="text-lg font-semibold">{account.name}</SheetTitle>
          </div>
        </SheetHeader>

        {isBank && (() => {
          const todayIso = todayIsoLocal();
          const goals = reserveBreakdown?.goals ?? [];
          const commitments = reserveBreakdown?.commitments ?? [];
          const loans = reserveBreakdown?.loans ?? [];

          return (
          <>
            <SectionHeading>Balance</SectionHeading>
            <div className="divide-y divide-border rounded-xl border bg-card px-4">
              <Row label="Current balance" highlighted>
                <Money value={money(account.balance_minor)} masked={masked} size="numeric" />
              </Row>

              <ReserveSection
                label="Reserved for goals"
                countLabel={goals.length > 0 ? `${goals.length} ${goals.length === 1 ? "goal" : "goals"}` : null}
                description="Money protected for things you're saving toward."
                aggregateMinor={goalReserveMinor}
                hasBreakdown={goals.length > 0}
                expanded={!!expanded.goals}
                onToggle={() => toggle("goals")}
                masked={masked}
                money={money}
              >
                {goals.map((g) => (
                  <GoalBreakdownRow key={g.id} item={g} masked={masked} money={money} />
                ))}
              </ReserveSection>

              <ReserveSection
                label="Reserved for commitments"
                countLabel={
                  commitments.length > 0
                    ? `${commitments.length} ${commitments.length === 1 ? "commitment" : "commitments"}`
                    : null
                }
                description="Money protected for payments you expect to make."
                aggregateMinor={commitmentReserveMinor}
                hasBreakdown={commitments.length > 0}
                expanded={!!expanded.commitments}
                onToggle={() => toggle("commitments")}
                masked={masked}
                money={money}
              >
                {commitments.map((c) => (
                  <CommitmentBreakdownRow
                    key={c.id}
                    item={c}
                    todayIso={todayIso}
                    masked={masked}
                    money={money}
                  />
                ))}
              </ReserveSection>

              <ReserveSection
                label="Reserved for loans"
                countLabel={loans.length > 0 ? `${loans.length} ${loans.length === 1 ? "loan" : "loans"}` : null}
                description="Money protected for scheduled loan payments."
                aggregateMinor={loanReserveMinor}
                hasBreakdown={loans.length > 0}
                expanded={!!expanded.loans}
                onToggle={() => toggle("loans")}
                masked={masked}
                money={money}
              >
                {loans.map((l) => (
                  <LoanBreakdownRow key={l.id} item={l} masked={masked} money={money} />
                ))}
              </ReserveSection>

              <ReserveSection
                label="Reserved for card bills"
                countLabel={
                  cardReserveDetails.length > 0
                    ? `${cardReserveDetails.length} ${cardReserveDetails.length === 1 ? "card" : "cards"}`
                    : null
                }
                description="Money protected for upcoming card bills."
                aggregateMinor={cardReserveMinor}
                hasBreakdown={cardReserveDetails.length > 0}
                expanded={!!expanded.cards}
                onToggle={() => toggle("cards")}
                masked={masked}
                money={money}
              >
                {cardReserveDetails.map((d) => (
                  <CardBreakdownRow key={d.creditCardAccountId} detail={d} masked={masked} money={money} />
                ))}
              </ReserveSection>

              <Separator />
              <Row label="Available" highlighted>
                <Money
                  value={money(
                    Math.max(
                      0,
                      account.balance_minor - goalReserveMinor - commitmentReserveMinor - loanReserveMinor - cardReserveMinor,
                    ),
                  )}
                  masked={masked}
                  size="numeric"
                  className="text-success"
                />
              </Row>
            </div>
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Available is your current balance after protecting money already assigned to goals, commitments, loans, and
              card bills. You move the money yourself unless a specific automatic action says otherwise.
            </p>
          </>
          );
        })()}

        {isCC && (() => {
          const outstanding = account.credit_used_minor ?? 0;
          const limit = account.credit_limit_minor ?? 0;
          const available = Math.max(0, limit - outstanding);
          // Single-date billing model: payment_due_day IS the card's bill
          // due day. statement_close_day is deprecated and ignored here.
          const billConfig = billingConfigFromAccount(account);
          const snapshot = billConfig ? calculateCreditCardBillCycle(todayIsoLocal(), billConfig) : null;
          // The "bill now owed" = the cycle that most recently closed. Its
          // amount is the obligation's statement balance (if we have one),
          // minus whatever the user has already paid against it.
          const billAmountMinor = billingStatus?.statementBalanceMinor ?? 0;
          const paidMinor = Math.max(0, billAmountMinor - Math.max(0, outstanding));
          // ^ On a freshly-closed bill, remaining == outstanding (until the
          //   user starts the next cycle). This is a display-only derivation;
          //   authoritative paid/remaining lives on the obligation row.
          const remainingMinor = billingStatus
            ? Math.max(0, billingStatus.statementBalanceMinor - paidMinor)
            : outstanding;
          const bankSources = allAccounts.filter((a) => a.type === "bank" || a.type === "cash");
          const canPayBill = bankSources.length > 0 && remainingMinor > 0;

          return (
            <>
              <SectionHeading>Credit Card</SectionHeading>
              <div className="divide-y divide-border rounded-xl border bg-card px-4">
                <Row label="Current outstanding" highlighted>
                  <Money value={money(outstanding, account.currency)} masked={masked} size="numeric" />
                </Row>
                <Row label="Credit limit">
                  {limit > 0 ? (
                    <Money value={money(limit, account.currency)} masked={masked} size="numeric" className="text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </Row>
                <Row label="Available credit">
                  {limit > 0 ? (
                    <Money value={money(available, account.currency)} masked={masked} size="numeric" className="text-success" />
                  ) : (
                    <span className="text-muted-foreground">Set credit limit to see this</span>
                  )}
                </Row>
              </div>

              {snapshot && (
                <>
                  <SectionHeading>Bill</SectionHeading>
                  <div className="divide-y divide-border rounded-xl border bg-card px-4">
                    <Row label="Bill due">
                      <span className="text-muted-foreground">
                        {billConfig!.billDueDay === 32
                          ? "Last day of month"
                          : `${billConfig!.billDueDay}th of month`}
                      </span>
                    </Row>
                    <Row label="Next bill due" highlighted>
                      <span>{formatDate(snapshot.openCycle.cycleEnd)}</span>
                    </Row>
                    {billingStatus ? (
                      <>
                        <Row label="Bill amount">
                          <Money
                            value={money(billingStatus.statementBalanceMinor, account.currency)}
                            masked={masked}
                            size="numeric"
                            className="text-muted-foreground"
                          />
                        </Row>
                        <Row label="Paid">
                          <Money
                            value={money(paidMinor, account.currency)}
                            masked={masked}
                            size="numeric"
                            className="text-muted-foreground"
                          />
                        </Row>
                        <Row label="Remaining" highlighted>
                          <Money value={money(remainingMinor, account.currency)} masked={masked} size="numeric" />
                        </Row>
                        <Row label="Status" highlighted>
                          <span>{PAYMENT_STATUS_LABELS[billingStatus.paymentStatus]}</span>
                        </Row>
                      </>
                    ) : (
                      <Row label="Status">
                        <span className="text-muted-foreground">
                          {dueDateHint(snapshot.daysUntilMostRecentDue)}
                        </span>
                      </Row>
                    )}
                  </div>
                  {canPayBill && (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="touch"
                        className="w-full"
                        onClick={() => setPayBillOpen(true)}
                      >
                        <CircleCheck className="size-4 mr-2" />
                        Pay bill
                      </Button>
                      <CreditCardPaymentDialog
                        open={payBillOpen}
                        onOpenChange={setPayBillOpen}
                        creditCardAccount={account}
                        accounts={allAccounts}
                        outstandingMinor={remainingMinor}
                        onPaid={() => {
                          setPayBillOpen(false);
                          onBillPaid?.();
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}

type MoneyFactory = (minor: number, currency?: string) => DomainMoney;

/**
 * One reserve row (Goals / Commitments / Loans / Card bills). Collapsed
 * by default; expands to a stack of per-item rows when a breakdown is
 * available. When the aggregate is zero the row shows "None" and the
 * chevron is suppressed, so an unused category never opens an empty
 * drawer. Button-based toggle keeps keyboard + screen-reader support
 * without any extra wiring.
 */
function ReserveSection({
  label,
  description,
  countLabel,
  aggregateMinor,
  hasBreakdown,
  expanded,
  onToggle,
  masked,
  money,
  children,
}: {
  label: string;
  description: string;
  countLabel: string | null;
  aggregateMinor: number;
  hasBreakdown: boolean;
  expanded: boolean;
  onToggle: () => void;
  masked: boolean;
  money: MoneyFactory;
  children: React.ReactNode;
}) {
  const canExpand = aggregateMinor > 0 && hasBreakdown;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  if (aggregateMinor <= 0) {
    return (
      <div className="flex items-center justify-between py-2.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">None</span>
      </div>
    );
  }

  return (
    <div className="py-1">
      <button
        type="button"
        className={`-mx-2 flex w-[calc(100%+1rem)] items-center justify-between rounded-md px-2 py-2 text-left ${
          canExpand ? "hover:bg-muted/50" : "cursor-default"
        }`}
        onClick={canExpand ? onToggle : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={canExpand ? `Toggle ${label} breakdown` : label}
        disabled={!canExpand}
      >
        <span className="flex items-center gap-2">
          {canExpand ? <Chevron className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
          <span className="text-sm text-muted-foreground">{label}</span>
          {countLabel ? (
            <span className="text-xs text-muted-foreground opacity-70">· {countLabel}</span>
          ) : null}
        </span>
        <Money
          value={money(aggregateMinor)}
          masked={masked}
          size="numeric"
          className="text-muted-foreground"
        />
      </button>
      {expanded ? (
        <>
          <p className="mb-2 px-1 text-xs text-muted-foreground">{description}</p>
          <div className="mb-2 space-y-2 rounded-lg bg-muted/30 p-2">{children}</div>
        </>
      ) : null}
    </div>
  );
}

function GoalBreakdownRow({
  item,
  masked,
  money,
}: {
  item: GoalReserveItem;
  masked: boolean;
  money: MoneyFactory;
}) {
  const remaining = Math.max(0, item.targetMinor - item.reservedMinor);
  return (
    <div className="rounded-md bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Target{" "}
            <Money value={money(item.targetMinor)} masked={masked} size="body" className="inline" />
            {item.targetDate ? ` · ${formatDate(item.targetDate)}` : ""}
          </p>
          {remaining > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <Money value={money(remaining)} masked={masked} size="body" className="inline" /> remaining
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-success">Target reached</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Money value={money(item.reservedMinor)} masked={masked} size="numeric" />
          <p className="text-xs text-muted-foreground">protected</p>
        </div>
      </div>
    </div>
  );
}

function CommitmentBreakdownRow({
  item,
  todayIso,
  masked,
  money,
}: {
  item: CommitmentReserveItem;
  todayIso: string;
  masked: boolean;
  money: MoneyFactory;
}) {
  // Canonical preparation status is the SAME function Upcoming uses --
  // never a re-derivation in this component. Keeps the badge consistent
  // across every surface that explains a commitment's state.
  const prep = derivePreparationStatus({
    preparationDate: item.nextPaymentDate,
    todayIso,
    requiredMinor: item.nextPaymentAmountMinor,
    protectedMinor: item.nextOccurrenceReservedMinor,
    paymentAlreadyPaid: false,
  });

  const statusLabel =
    prep.kind === "ready"
      ? "Fully protected"
      : prep.kind === "preparation_behind"
      ? "Preparation behind"
      : prep.kind === "preparation_due"
      ? "Preparation due"
      : prep.kind === "payment_already_paid"
      ? "Payment recorded"
      : null;
  const statusClass =
    prep.kind === "ready" || prep.kind === "payment_already_paid"
      ? "text-success"
      : prep.kind === "preparation_behind"
      ? "text-warning"
      : "text-muted-foreground";

  return (
    <div className="rounded-md bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Next payment{" "}
            <Money value={money(item.nextPaymentAmountMinor)} masked={masked} size="body" className="inline" />
            {" · "}
            {formatDate(item.nextPaymentDate)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatFrequency(item.frequency)}
            {item.categoryName ? ` · ${item.categoryName}` : ""}
          </p>
          {statusLabel ? (
            <p className={`mt-0.5 text-xs font-medium ${statusClass}`}>{statusLabel}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <Money value={money(item.reservedMinor)} masked={masked} size="numeric" />
          <p className="text-xs text-muted-foreground">protected</p>
        </div>
      </div>
    </div>
  );
}

function LoanBreakdownRow({
  item,
  masked,
  money,
}: {
  item: LoanReserveItem;
  masked: boolean;
  money: MoneyFactory;
}) {
  return (
    <div className="rounded-md bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Next EMI{" "}
            <Money
              value={money(item.nextInstallmentAmountMinor)}
              masked={masked}
              size="body"
              className="inline"
            />
            {item.nextPaymentDate ? ` · ${formatDate(item.nextPaymentDate)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{formatFrequency(item.frequency)}</p>
          {item.outstandingMinor != null ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Outstanding{" "}
              <Money value={money(item.outstandingMinor)} masked={masked} size="body" className="inline" />
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <Money value={money(item.reservedMinor)} masked={masked} size="numeric" />
          <p className="text-xs text-muted-foreground">reserved</p>
        </div>
      </div>
    </div>
  );
}

function CardBreakdownRow({
  detail,
  masked,
  money,
}: {
  detail: CardReserveDetail;
  masked: boolean;
  money: MoneyFactory;
}) {
  return (
    <div className="rounded-md bg-background px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{detail.creditCardName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Protected toward the next bill.</p>
        </div>
        <div className="shrink-0 text-right">
          <Money value={money(detail.reservedMinor)} masked={masked} size="numeric" />
          <p className="text-xs text-muted-foreground">reserved</p>
        </div>
      </div>
    </div>
  );
}

/** Converts a RecurrenceInterval / PaymentFrequency string ("quarterly", "every_6_months") to display text. Falls back to the raw string so new cadences surface rather than silently blanking. */
function formatFrequency(freq: string): string {
  const map: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
    weekly: "Weekly",
    biweekly: "Biweekly",
    daily: "Daily",
    one_time: "One time",
    every_2_months: "Every 2 months",
    every_6_months: "Every 6 months",
    every_2_years: "Every 2 years",
    every_3_years: "Every 3 years",
  };
  return map[freq] ?? freq;
}

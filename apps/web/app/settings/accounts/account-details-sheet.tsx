"use client";

import { useState } from "react";
import {
  calculateCreditCardBillCycle,
  billingConfigFromAccount,
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
import { Landmark, Banknote, CreditCard, CircleCheck } from "lucide-react";
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

/** Plain, server-fetched billing status for the credit card currently being viewed (null while unknown/loading, or when billing days aren't configured). */
export interface CreditCardBillingStatusView {
  statementBalanceMinor: number;
  paymentStatus: CreditCardPaymentStatus;
  obligationStatus: "unpaid" | "partial" | "paid";
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
}: AccountDetailsSheetProps) {
  const [payBillOpen, setPayBillOpen] = useState(false);
  if (!account) return null;

  const money = (minor: number, currency = CURRENCY) =>
    DomainMoney.fromMinorUnits(BigInt(minor), currency);

  const isBank = account.type === "bank" || account.type === "cash";
  const isCC = account.type === "credit_card";

  const Icon = account.type === "credit_card" ? CreditCard : account.type === "cash" ? Banknote : Landmark;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl px-6 pb-8">
        <SheetHeader className="mb-2">
          <div className="flex items-center gap-3 pt-2">
            <Icon className="size-5 text-muted-foreground" />
            <SheetTitle className="text-lg font-semibold">{account.name}</SheetTitle>
          </div>
        </SheetHeader>

        {isBank && (
          <>
            <SectionHeading>Balance</SectionHeading>
            <div className="divide-y divide-border rounded-xl border bg-card px-4">
              <Row label="Current balance" highlighted>
                <Money value={money(account.balance_minor)} masked={masked} size="numeric" />
              </Row>
              <Row label="Reserved for goals">
                {goalReserveMinor > 0 ? (
                  <Money value={money(goalReserveMinor)} masked={masked} size="numeric" className="text-muted-foreground" />
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Row>
              <Row label="Reserved for commitments">
                {commitmentReserveMinor > 0 ? (
                  <Money value={money(commitmentReserveMinor)} masked={masked} size="numeric" className="text-muted-foreground" />
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Row>
              <Row label="Reserved for loans">
                {loanReserveMinor > 0 ? (
                  <Money value={money(loanReserveMinor)} masked={masked} size="numeric" className="text-muted-foreground" />
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Row>
              {cardReserveDetails.length > 0 && (
                <>
                  {cardReserveDetails.map((d) => (
                    <Row key={d.creditCardAccountId} label={`Reserved for ${d.creditCardName}`}>
                      <Money value={money(d.reservedMinor)} masked={masked} size="numeric" className="text-muted-foreground" />
                    </Row>
                  ))}
                </>
              )}
              {cardReserveMinor === 0 && cardReserveDetails.length === 0 && (
                <Row label="Reserved for card payments">
                  <span className="text-muted-foreground">None</span>
                </Row>
              )}
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
          </>
        )}

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

"use client";

import { resolveRecurringDay, Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import type { CardReserveDetail } from "@spencare/domain-infra";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Money } from "@/components/spencare/money";
import { Separator } from "@/components/ui/separator";
import { Landmark, Banknote, CreditCard } from "lucide-react";

const CURRENCY = "INR";

function nextOccurrenceOfDay(dayRule: number): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");

  const candidate = resolveRecurringDay({ year: y, month: m, paymentDayRule: dayRule });
  const todayIso = `${y}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (candidate >= todayIso) return candidate;

  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return resolveRecurringDay({ year: ny, month: nm, paymentDayRule: dayRule });
}

function nextPaymentDueAfterStatement(stmtDay: number, dueDay: number): string {
  const stmtDate = nextOccurrenceOfDay(stmtDay);
  const stmtParts = stmtDate.split("-").map(Number);
  const sy = stmtParts[0]!;
  const sm = stmtParts[1]!;

  const sameMoDue = resolveRecurringDay({ year: sy, month: sm, paymentDayRule: dueDay });
  if (sameMoDue > stmtDate) return sameMoDue;

  const ny = sm === 12 ? sy + 1 : sy;
  const nm = sm === 12 ? 1 : sm + 1;
  return resolveRecurringDay({ year: ny, month: nm, paymentDayRule: dueDay });
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
}: AccountDetailsSheetProps) {
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
          const used = account.credit_used_minor ?? 0;
          const limit = account.credit_limit_minor ?? 0;
          const available = Math.max(0, limit - used);
          const stmtDay = account.statement_close_day;
          const dueDay = account.payment_due_day;
          const nextStmt = stmtDay != null ? nextOccurrenceOfDay(stmtDay) : null;
          const nextDue =
            stmtDay != null && dueDay != null
              ? nextPaymentDueAfterStatement(stmtDay, dueDay)
              : dueDay != null
              ? nextOccurrenceOfDay(dueDay)
              : null;

          return (
            <>
              <SectionHeading>Credit Card</SectionHeading>
              <div className="divide-y divide-border rounded-xl border bg-card px-4">
                <Row label="Outstanding balance" highlighted>
                  <Money value={money(used, account.currency)} masked={masked} size="numeric" />
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

              {(stmtDay != null || dueDay != null) && (
                <>
                  <SectionHeading>Billing Cycle</SectionHeading>
                  <div className="divide-y divide-border rounded-xl border bg-card px-4">
                    {stmtDay != null && (
                      <Row label="Statement closes on">
                        <span className="text-muted-foreground">
                          {stmtDay === 32 ? "Last day of month" : `${stmtDay}th of month`}
                        </span>
                      </Row>
                    )}
                    {nextStmt && (
                      <Row label="Next statement close">
                        <span>{formatDate(nextStmt)}</span>
                      </Row>
                    )}
                    {dueDay != null && (
                      <Row label="Payment due on">
                        <span className="text-muted-foreground">
                          {dueDay === 32 ? "Last day of month" : `${dueDay}th of month`}
                        </span>
                      </Row>
                    )}
                    {nextDue && (
                      <Row label="Next payment due" highlighted>
                        <span>{formatDate(nextDue)}</span>
                      </Row>
                    )}
                  </div>
                </>
              )}
            </>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}

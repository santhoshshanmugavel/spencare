"use client";

import { MoreHorizontal, Landmark, Banknote, CreditCard, TrendingUp, AlertTriangle } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import type { CardReserveDetail } from "@spencare/domain-infra";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress, type ProgressTone } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Money } from "@/components/spencare/money";

/**
 * <AccountCard> — component-inventory.md §6 "Account card," evidenced by
 * SP-234 (grid tile anatomy per type) / SP-237 (masked state) / SP-238,
 * SP-239 (Actions menu). This is a distinct primitive from <ListRow>
 * (§8 "Transaction / list row") -- the two were conflated in an earlier
 * pass of this phase before the screen specs were consulted; ListRow's
 * anatomy (icon → two-line stack → category → account → amount) doesn't
 * match what the Accounts grid actually shows.
 *
 * Deliberately NOT built into this card (source-evidenced but out of
 * Phase 7's scope, since each depends on a later phase):
 * - bank goal-allocation split bar (needs Goals engine)
 * - "Add money" / "View reserved goals" / "Self transfer" / "Pay Now"
 *   menu items (need the Transactions engine)
 * - hover chevron → AI insight drawer (SP-240, Spensa is out of scope)
 * Also not built (evidenced in Add-account screens, but the column
 * doesn't exist in database-architecture.md's accounts table and isn't
 * marked resolved in visual-conflicts.md): bank subtype badge, credit
 * card statement/due-date row (billing_date_day / payment_due_days),
 * investment sub-type (CF-D19, explicitly "decision required").
 */

const CREDIT_UTILIZATION_THRESHOLDS = { warning: 70, danger: 90 } as const;

function typeIcon(type: AccountRow["type"]) {
  const base = "flex size-10 items-center justify-center rounded-xl";
  if (type === "credit_card")
    return <div className={`${base} bg-expense-subtle`}><CreditCard className="size-5 text-expense" aria-hidden="true" /></div>;
  if (type === "investment")
    return <div className={`${base} bg-income-subtle`}><TrendingUp className="size-5 text-income" aria-hidden="true" /></div>;
  if (type === "cash")
    return <div className={`${base} bg-transfer-subtle`}><Banknote className="size-5 text-transfer" aria-hidden="true" /></div>;
  return <div className={`${base} bg-primary/10`}><Landmark className="size-5 text-primary" aria-hidden="true" /></div>;
}

const TYPE_LABELS: Record<AccountRow["type"], string> = {
  bank: "Bank",
  cash: "Cash",
  credit_card: "Credit card",
  investment: "Investment",
};

function utilizationTone(usedMinor: number, limitMinor: number): { percent: number; tone: ProgressTone } {
  const percent = limitMinor > 0 ? Math.min(100, Math.round((usedMinor / limitMinor) * 100)) : 0;
  const tone: ProgressTone =
    percent >= CREDIT_UTILIZATION_THRESHOLDS.danger
      ? "danger"
      : percent >= CREDIT_UTILIZATION_THRESHOLDS.warning
        ? "warning"
        : "success";
  return { percent, tone };
}

function actionLabels(type: AccountRow["type"]): { edit: string; delete: string } {
  if (type === "credit_card") return { edit: "Edit credit card", delete: "Delete credit card" };
  return { edit: "Edit account", delete: "Delete account" };
}

export function AccountCard({
  account,
  masked,
  onEdit,
  onDelete,
  cardReserveMinor = 0,
  goalReserveMinor = 0,
  commitmentReserveMinor = 0,
  cardReserveDetails = [],
  paymentAccountName = null,
}: {
  account: AccountRow;
  masked: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Reserved for credit-card payments from this account (0 when no payment source configured). */
  cardReserveMinor?: number;
  /** Reserved for goals funded from this account. */
  goalReserveMinor?: number;
  /** Reserved for planned commitments funded from this account. */
  commitmentReserveMinor?: number;
  /** Per-card breakdown for bank/cash accounts (which cards contribute to the reserve). */
  cardReserveDetails?: CardReserveDetail[];
  /** For credit card accounts: the name of the bank account that pays this card. Null when not configured. */
  paymentAccountName?: string | null;
}) {
  const labels = actionLabels(account.type);

  return (
    <Card className="gap-0 p-0 overflow-hidden">
      <div className="flex items-start gap-3 p-4 pb-3">
        {typeIcon(account.type)}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate font-semibold text-foreground text-sm leading-tight">{account.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{TYPE_LABELS[account.type]}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${account.name}`}
              className="shrink-0 -mt-1 -mr-1"
              data-size="touch"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>{labels.edit}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              {labels.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="border-t border-border/60 px-4 pb-4 pt-3">
        <AccountCardBody
          account={account}
          masked={masked}
          cardReserveMinor={cardReserveMinor}
          goalReserveMinor={goalReserveMinor}
          commitmentReserveMinor={commitmentReserveMinor}
          cardReserveDetails={cardReserveDetails}
          paymentAccountName={paymentAccountName}
        />
      </div>
    </Card>
  );
}

function AccountCardBody({
  account,
  masked,
  cardReserveMinor,
  goalReserveMinor,
  commitmentReserveMinor,
  cardReserveDetails,
  paymentAccountName,
}: {
  account: AccountRow;
  masked: boolean;
  cardReserveMinor: number;
  goalReserveMinor: number;
  commitmentReserveMinor: number;
  cardReserveDetails: CardReserveDetail[];
  paymentAccountName: string | null;
}) {
  if (account.type === "credit_card") {
    const limit = account.credit_limit_minor ?? 0;
    const used = account.credit_used_minor ?? 0;
    const available = DomainMoney.fromMinorUnits(BigInt(limit - used), account.currency as never);
    const usedMoney = DomainMoney.fromMinorUnits(BigInt(used), account.currency as never);
    const limitMoney = DomainMoney.fromMinorUnits(BigInt(limit), account.currency as never);
    const { percent, tone } = utilizationTone(used, limit);
    return (
      <div>
        <Money
          value={available}
          masked={masked}
          size="numeric"
          aria-label={`Credit limit available for ${account.name}`}
        />
        <p className="text-xs text-muted-foreground">Credit limit available</p>
        <Progress value={percent} tone={tone} className="mt-3" aria-label="Credit utilization" />
        <p className="mt-1 text-xs text-muted-foreground">
          <Money value={usedMoney} masked={masked} size="body" className="inline" /> used ·{" "}
          <Money value={limitMoney} masked={masked} size="body" className="inline" /> total limit
        </p>
        {paymentAccountName ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Paid from <span className="font-medium text-foreground">{paymentAccountName}</span>
          </p>
        ) : used > 0 ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            No payment account set. Configure one to reserve this balance from your bank.
          </p>
        ) : null}
      </div>
    );
  }

  if (account.type === "investment") {
    const value = DomainMoney.fromMinorUnits(BigInt(account.market_value_minor ?? 0), account.currency as never);
    return (
      <div>
        <Money value={value} masked={masked} size="numeric" aria-label={`Total invested in ${account.name}`} />
        <p className="text-xs text-muted-foreground">Total invested</p>
      </div>
    );
  }

  const balance = account.balance_minor;
  const reservedTotal = goalReserveMinor + cardReserveMinor + commitmentReserveMinor;
  const availableRaw = balance - reservedTotal;
  const isOverReserved = availableRaw < 0;
  const available = Math.max(0, availableRaw);
  const value = DomainMoney.fromMinorUnits(BigInt(balance), account.currency as never);

  const hasAllocation = balance > 0 && reservedTotal > 0;
  const goalPct = hasAllocation ? Math.min(100, Math.round((goalReserveMinor / balance) * 100)) : 0;
  const commitmentPct = hasAllocation ? Math.min(100 - goalPct, Math.round((commitmentReserveMinor / balance) * 100)) : 0;
  const cardPct = hasAllocation ? Math.min(100 - goalPct - commitmentPct, Math.round((cardReserveMinor / balance) * 100)) : 0;
  const availPct = 100 - goalPct - commitmentPct - cardPct;

  return (
    <div>
      <Money value={value} masked={masked} size="numeric" tone="auto" aria-label={`Balance for ${account.name}`} />
      <p className="text-xs text-muted-foreground">Total balance</p>
      {hasAllocation ? (
        <div className="mt-3 space-y-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-primary/70 transition-all" style={{ width: `${availPct}%` }} title="Available" />
            <div className="bg-amber-400 transition-all" style={{ width: `${goalPct}%` }} title="Goals" />
            <div className="bg-violet-400 transition-all" style={{ width: `${commitmentPct}%` }} title="Commitments" />
            <div className="bg-rose-400 transition-all" style={{ width: `${cardPct}%` }} title="Card payments" />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-primary/70" />
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(available), account.currency as never)}
                masked={masked}
                size="body"
                className="inline"
              />
              {" available"}
            </span>
            {goalReserveMinor > 0 ? (
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-amber-400" />
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(goalReserveMinor), account.currency as never)}
                  masked={masked}
                  size="body"
                  className="inline"
                />
                {" goals"}
              </span>
            ) : null}
            {commitmentReserveMinor > 0 ? (
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-violet-400" />
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(commitmentReserveMinor), account.currency as never)}
                  masked={masked}
                  size="body"
                  className="inline"
                />
                {" commitments"}
              </span>
            ) : null}
            {cardReserveMinor > 0 ? (
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-rose-400" />
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(cardReserveMinor), account.currency as never)}
                  masked={masked}
                  size="body"
                  className="inline"
                />
                {" card payments"}
              </span>
            ) : null}
          </div>
          {cardReserveDetails.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {cardReserveDetails.map((detail) => (
                <div key={detail.creditCardAccountId} className="flex items-center justify-between text-[10px] text-muted-foreground pl-2.5">
                  <span className="truncate">{detail.creditCardName}</span>
                  <Money
                    value={DomainMoney.fromMinorUnits(BigInt(detail.reservedMinor), account.currency as never)}
                    masked={masked}
                    size="body"
                    className="inline shrink-0 ml-2"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {isOverReserved ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>Your card balance reserve exceeds the cash available in this account.</span>
        </div>
      ) : null}
    </div>
  );
}

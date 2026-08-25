"use client";

import { MoreHorizontal } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
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
}: {
  account: AccountRow;
  masked: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const labels = actionLabels(account.type);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-medium text-foreground">
          <span className="block truncate">{account.name}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              aria-label={`Actions for ${account.name}`}
              className="shrink-0 px-0"
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

      <AccountCardBody account={account} masked={masked} />
    </Card>
  );
}

function AccountCardBody({ account, masked }: { account: AccountRow; masked: boolean }) {
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

  const value = DomainMoney.fromMinorUnits(BigInt(account.balance_minor), account.currency as never);
  return (
    <div>
      <Money value={value} masked={masked} size="numeric" tone="auto" aria-label={`Balance for ${account.name}`} />
      <p className="text-xs text-muted-foreground">Total balance</p>
    </div>
  );
}

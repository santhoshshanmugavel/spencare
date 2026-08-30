"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { Money as DomainMoney, calculateGoalProgress } from "@spencare/domain-core";
import type { AccountRow, GoalRow, TransactionRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { GoalImageUploader } from "@/components/spencare/goal-image-uploader";
import { listContributionsAction } from "./actions";

/**
 * SP-195 (in-progress) / SP-196 (reached/celebratory) -- financial fields
 * OBSERVED, the lavender "AI insight" box is Spensa-only and excluded
 * (§17: no scope expansion). The Contributions ledger (SP-195/196's
 * "Reserved date | Contributions | Amount" table) is rendered via
 * <ListRow>, an INFERRED reuse -- component-inventory.md §8 doesn't cite
 * SP-195/196 directly the way it cites SP-166 for Budgets, but the
 * anatomy (leading icon, description, trailing signed amount) matches
 * ListRow's own shape closely enough that reusing it, rather than
 * inventing a one-off row, is the more consistent choice; called out
 * explicitly rather than claimed as an observed citation.
 */
export function GoalDetailDialog({
  goal,
  fundingAccount,
  masked,
  imageSignedUrl,
  open,
  onOpenChange,
  onContribute,
  onWithdraw,
  onEdit,
  onArchive,
  onDelete,
}: {
  goal: GoalRow;
  fundingAccount: AccountRow | undefined;
  masked: boolean;
  /** Resolved by the page (see `resolveGoalImageUrls`), never derived here -- `goal.image_url` is a private Storage path, not a displayable URL. */
  imageSignedUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContribute: () => void;
  onWithdraw: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [contributions, setContributions] = useState<TransactionRow[] | null>(null);
  const currency = fundingAccount?.currency ?? "INR";
  const progress = calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
  const isReached = progress.isReached;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listContributionsAction(goal.id).then((rows) => {
      if (!cancelled) setContributions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, goal.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle>{goal.name}</DialogTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="touch" aria-label={`More actions for ${goal.name}`}>
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>Edit Goal</DropdownMenuItem>
                <DropdownMenuItem onSelect={onWithdraw}>Withdraw</DropdownMenuItem>
                <DropdownMenuItem onSelect={onArchive}>Archive Goal</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  Delete Goal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <GoalImageUploader
              goalId={goal.id}
              goalName={goal.name}
              initialSignedUrl={imageSignedUrl}
              className="rounded-lg"
            />

            {isReached ? (
              <p className="text-sm font-medium text-success">🎉 Goal achieved!</p>
            ) : progress.monthsLeft !== null && goal.target_date ? (
              <p className="text-sm text-muted-foreground">
                {progress.monthsLeft} month{progress.monthsLeft === 1 ? "" : "s"} left
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No target date</p>
            )}

            <div>
              <Money
                value={DomainMoney.fromMinorUnits(BigInt(goal.saved_amount_minor), currency as never)}
                masked={masked}
                size="hero"
                tone={isReached ? "positive" : "neutral"}
                className="text-2xl min-[375px]:text-3xl sm:text-4xl"
              />
              {!isReached ? (
                <p className="text-sm text-muted-foreground">
                  of{" "}
                  <Money
                    value={DomainMoney.fromMinorUnits(BigInt(goal.target_amount_minor), currency as never)}
                    masked={masked}
                    size="body"
                    className="inline"
                  />
                </p>
              ) : (
                <p className="text-sm font-medium text-success">Saved</p>
              )}
            </div>

            <Progress
              value={Math.min(100, progress.percentSaved)}
              tone={isReached ? "success" : undefined}
              aria-label={`${goal.name} progress`}
            />

            {!isReached && progress.suggestedMonthlyContributionMinor !== null ? (
              <p className="text-xs text-muted-foreground">
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(progress.remainingMinor), currency as never)}
                  masked={masked}
                  size="body"
                  className="inline"
                />{" "}
                left · save{" "}
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(progress.suggestedMonthlyContributionMinor), currency as never)}
                  masked={masked}
                  size="body"
                  className="inline"
                />
                /month
              </p>
            ) : null}

            {fundingAccount ? (
              <p className="text-xs text-muted-foreground">Saved in {fundingAccount.name}</p>
            ) : null}

            <Button type="button" size="touch" className="w-full" onClick={onContribute}>
              Save more
            </Button>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Contributions</h3>
            {contributions === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : contributions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contributions yet.</p>
            ) : (
              contributions.map((txn) => (
                <ListRow
                  key={txn.id}
                  icon={
                    txn.type === "goal_withdrawal" ? (
                      <ArrowUpRight className="size-4 text-destructive" aria-hidden="true" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-success" aria-hidden="true" />
                    )
                  }
                  title={txn.type === "goal_withdrawal" ? "Withdraw" : "Contribution"}
                  subtitle={new Date(txn.occurred_at + "T00:00:00").toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  trailing={
                    <Money
                      value={DomainMoney.fromMinorUnits(BigInt(txn.amount_minor), txn.currency as never)}
                      masked={masked}
                      size="numeric"
                      tone={txn.type === "goal_withdrawal" ? "negative" : "positive"}
                    />
                  }
                />
              ))
            )}
          </div>
        </div>

        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

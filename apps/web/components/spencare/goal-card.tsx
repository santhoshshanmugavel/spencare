"use client";

import { MoreHorizontal, Target } from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { GoalProgress } from "@spencare/domain-application";
import type { GoalRow, AccountRow } from "@spencare/domain-application";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Money } from "@/components/spencare/money";
import { GoalImageUploader } from "@/components/spencare/goal-image-uploader";
import { formatMinorUnits } from "@/lib/currency-format";

/**
 * <GoalCard> — component-inventory.md §7 "Goal card," evidenced by
 * SP-181/182/184. A distinct primitive from <ListRow> -- Goals is
 * deliberately absent from ListRow's own "Screens using it" citation
 * list (component-inventory.md §8), the opposite lesson from Budgets
 * (where ListRow WAS the cited primitive). Not forcing Goals into
 * ListRow, per the Phase 7 AccountCard lesson.
 *
 * Image: Phase 26 adds a genuine USER-UPLOADED photo (via
 * `GoalImageUploader`) -- this is NOT the AI-generated/stock hero image
 * SP-193 explicitly declined to fabricate; that decision stands, and this
 * is a different, legitimate feature (the same category as the
 * already-shipped avatar upload). A goal with no uploaded image still
 * renders the exact OBSERVED "no-image fallback" (component-inventory.md
 * §7: "solid lavender fill + centered bold name, no photo") --
 * `GoalImageUploader` itself renders that fallback when there's nothing
 * to show, so this component doesn't duplicate it.
 *
 * NOT built (explicitly out of scope, Spensa/AI-only in source):
 * - "next image" carousel chevron, sparkle/AI insight icon.
 *
 * Mobile-safe (Phase 11 §8): SP-184's "Add Cash" action is hover-only in
 * source with no documented touch equivalent (its own open question) --
 * here it's a persistent, always-visible button, not hover-revealed.
 * Same for the "..." actions menu, mirroring AccountCard's own persistent-
 * button pattern from Phase 7 rather than a hover affordance.
 */

function monthLabel(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatAmount(minor: number, currency: string): string {
  const f = formatMinorUnits(BigInt(minor), currency);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

export function GoalCard({
  goal,
  progress,
  fundingAccount,
  masked,
  imageSignedUrl,
  onContribute,
  onWithdraw,
  onEdit,
  onArchive,
  onDelete,
  onViewDetail,
}: {
  goal: GoalRow;
  progress: GoalProgress;
  fundingAccount: AccountRow | undefined;
  masked: boolean;
  /** Resolved by the page (see `resolveGoalImageUrls`), never derived here -- `goal.image_url` is a private Storage path, not a displayable URL. */
  imageSignedUrl: string | null;
  onContribute: () => void;
  onWithdraw: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onViewDetail: () => void;
}) {
  const currency = fundingAccount?.currency ?? "INR";
  const isReached = progress.isReached;
  const savedMoney = DomainMoney.fromMinorUnits(BigInt(goal.saved_amount_minor), currency as never);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <GoalImageUploader goalId={goal.id} goalName={goal.name} initialSignedUrl={imageSignedUrl} />

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onViewDetail} className="min-w-0 text-left">
            <span className="block truncate font-medium text-foreground">{goal.name}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="touch"
                aria-label={`Actions for ${goal.name}`}
                className="shrink-0 px-0"
              >
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

        <div className="flex items-baseline gap-1.5">
          <Money value={savedMoney} masked={masked} size="numeric" tone={isReached ? "positive" : "neutral"} />
          {!isReached ? (
            <span className="text-xs text-muted-foreground">
              / {masked ? "***" : formatAmount(goal.target_amount_minor, currency)}
            </span>
          ) : (
            <span className="text-xs font-medium text-success">Saved</span>
          )}
        </div>

        <Progress
          value={Math.min(100, progress.percentSaved)}
          tone={isReached ? "success" : undefined}
          aria-label={`${goal.name} progress`}
        />

        {isReached ? (
          <p className="text-xs font-medium text-success">🎉 Goal reached</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {masked ? "Amount hidden" : `${formatAmount(progress.remainingMinor, currency)} left`}
            {progress.suggestedMonthlyContributionMinor !== null
              ? ` · ${masked ? "***" : formatAmount(progress.suggestedMonthlyContributionMinor, currency)}/mo`
              : null}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {isReached
            ? "Completed"
            : progress.monthsLeft !== null && goal.target_date
              ? `${progress.monthsLeft} month${progress.monthsLeft === 1 ? "" : "s"} left · ${monthLabel(goal.target_date)}`
              : "No target date"}
        </p>

        {fundingAccount ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Target className="size-3" aria-hidden="true" />
            Saved in {fundingAccount.name}
          </p>
        ) : null}

        <Button type="button" size="touch" className="w-full" onClick={onContribute}>
          Add Cash
        </Button>
      </div>
    </Card>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, MoreHorizontal, Pause, Play, Sparkles } from "lucide-react";
import { Money as DomainMoney, calculateGoalPaceStatus, calculateGoalProgress, FREQUENCY_LABELS } from "@spencare/domain-core";
import type { AccountRow, GoalContributionPlanRow, GoalRow, TransactionRow } from "@spencare/domain-application";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { getGoalInsight } from "@/lib/goal-insight";
import { toastConfirmed, toastError } from "@/lib/toast";
import {
  listContributionsAction,
  getGoalContributionPlanAction,
  pauseGoalContributionPlanAction,
  resumeGoalContributionPlanAction,
} from "./actions";
import { ContributionPlanSheet } from "./contribution-plan-sheet";

/** Whole calendar months between two ISO timestamps, floored at 0 -- same convention as `GoalCard`'s own `monthsBetween`. */
function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(0, months);
}

/**
 * SP-195 (in-progress) / SP-196 (reached/celebratory) -- financial fields
 * OBSERVED. The Contributions ledger (SP-195/196's "Reserved date |
 * Contributions | Amount" table) is rendered via <ListRow>, an INFERRED
 * reuse -- component-inventory.md §8 doesn't cite SP-195/196 directly the
 * way it cites SP-166 for Budgets, but the anatomy (leading icon,
 * description, trailing signed amount) matches ListRow's own shape
 * closely enough that reusing it, rather than inventing a one-off row, is
 * the more consistent choice; called out explicitly rather than claimed
 * as an observed citation.
 *
 * Phase 34 §11 correction: an earlier phase's comment here claimed the
 * insight box was "Spensa-only, no scope expansion" and excluded it
 * without ever re-reading `Goals-6.pdf` to check. Re-read directly this
 * phase: the reference DOES show a real, non-AI-chat insight sentence
 * ("You're on track for your Bali Trip. ₹30,000 saved so far — ₹20,907
 * left. Saving ₹3,500/month will get you there by Mar 2027.") in the same
 * `border-primary/20 bg-primary/5` + Sparkles-icon card Cash Flow's own
 * insight banner already uses (`computeSpendingInsight`'s render site) --
 * reused here for the same reason, not invented fresh. `getGoalInsight`
 * (`@/lib/goal-insight`) computes it purely from `calculateGoalProgress`/
 * `calculateGoalPaceStatus` (both pure, already-tested domain-core
 * functions) -- no live model call, nothing this function can't back with
 * the numbers it was given. The reference's copy/regenerate/thumbs-up-
 * down icons are deliberately NOT reproduced: this insight is
 * deterministic, not a live AI generation, so a "regenerate" affordance
 * implying a different answer next time would be exactly the fake-AI
 * pattern this engagement's own UX-quality mandate forbids.
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
  const [plan, setPlan] = useState<GoalContributionPlanRow | null | undefined>(undefined);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const currency = fundingAccount?.currency ?? "INR";
  const progress = calculateGoalProgress(goal.target_amount_minor, goal.saved_amount_minor, goal.target_date);
  const isReached = progress.isReached;
  const paceStatus = calculateGoalPaceStatus(goal.target_amount_minor, goal.saved_amount_minor, goal.created_at, goal.target_date);
  const targetDateLabel = goal.target_date
    ? new Date(goal.target_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : null;
  const insight = getGoalInsight(goal.name, progress, paceStatus, targetDateLabel);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listContributionsAction(goal.id).then((rows) => {
      if (!cancelled) setContributions(rows);
    });
    getGoalContributionPlanAction(goal.id).then((p) => {
      if (!cancelled) setPlan(p);
    });
    return () => {
      cancelled = true;
    };
  }, [open, goal.id]);

  async function handlePausePlan() {
    if (!plan) return;
    const result = await pauseGoalContributionPlanAction(plan.id);
    if (!result.ok) { toastError(result.error.message); return; }
    setPlan(result.value);
    toastConfirmed("Plan paused. Reminders are off until you resume.");
  }

  async function handleResumePlan() {
    if (!plan) return;
    const result = await resumeGoalContributionPlanAction(plan.id);
    if (!result.ok) { toastError(result.error.message); return; }
    setPlan(result.value);
    toastConfirmed("Plan resumed. Reminders are back on.");
  }

  function refreshPlan() {
    getGoalContributionPlanAction(goal.id).then(setPlan);
  }

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
              <p className="text-sm font-medium text-success">
                🎉{" "}
                {goal.completed_at
                  ? `Completed in ${monthsBetween(goal.created_at, goal.completed_at)} month${monthsBetween(goal.created_at, goal.completed_at) === 1 ? "" : "s"}`
                  : "You're all set"}
              </p>
            ) : progress.monthsLeft !== null && goal.target_date ? (
              <p className="text-sm text-muted-foreground">
                {progress.monthsLeft} month{progress.monthsLeft === 1 ? "" : "s"} left
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No target date</p>
            )}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual saved</p>
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
                  />{" "}
                  target
                </p>
              ) : (
                <p className="text-sm font-medium text-success">Goal reached</p>
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

          <div className="space-y-4">
            {/* Goals-6.pdf's insight box -- skipped entirely when masked,
                same trade `<CashFlowTrendChart>` already makes: this
                sentence embeds real rupee figures as plain text (it's a
                sentence, not a `<Money>` tree), so there is no safe way to
                surgically redact numbers inside it. Omitting the whole
                card is the honest choice, not a masked-looking chip that
                still leaks digit count. */}
            {masked ? (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-center gap-1.5 py-4 text-sm text-muted-foreground">
                  <Sparkles className="size-4 text-primary" aria-hidden="true" />
                  Goal insight hidden while Privacy Mode is on.
                </CardContent>
              </Card>
            ) : (
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="flex items-start gap-1.5 py-4 text-sm text-foreground">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{insight}</span>
                </CardContent>
              </Card>
            )}

            {/* Contribution Plan section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">Contribution plan</h3>
                {!isReached ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto py-0 text-xs text-primary"
                    onClick={() => setPlanSheetOpen(true)}
                  >
                    {plan ? "Edit" : "Set up"}
                  </Button>
                ) : null}
              </div>
              {plan === undefined ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : plan === null ? (
                <p className="text-sm text-muted-foreground">
                  No plan yet.{" "}
                  {!isReached ? (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => setPlanSheetOpen(true)}
                    >
                      Set up a reminder schedule.
                    </button>
                  ) : null}
                </p>
              ) : (
                <Card className="border-border/60">
                  <CardContent className="space-y-2 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Planned {FREQUENCY_LABELS[plan.frequency].toLowerCase()} contribution
                          </p>
                          <span className="text-sm font-medium">
                            <Money
                              value={DomainMoney.fromNumber(plan.amount_minor, currency as never)}
                              masked={masked}
                              size="body"
                              className="inline"
                            />
                          </span>
                        </div>
                      </div>
                      <Badge variant={plan.status === "paused" ? "secondary" : "default"} className="text-xs">
                        {plan.status === "paused" ? "Paused" : "Active"}
                      </Badge>
                    </div>
                    {plan.next_due_at ? (
                      <p className="text-xs text-muted-foreground">
                        Next contribution:{" "}
                        {new Date(plan.next_due_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      This is a reminder — not an automatic transfer. Money moves only when you record a contribution.
                    </p>
                    <div className="flex gap-2 pt-1">
                      {plan.status === "active" ? (
                        <Button type="button" size="sm" variant="outline" onClick={handlePausePlan} className="gap-1.5 text-xs">
                          <Pause className="size-3" aria-hidden="true" />
                          Pause
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={handleResumePlan} className="gap-1.5 text-xs">
                          <Play className="size-3" aria-hidden="true" />
                          Resume
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
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
        </div>

        <DialogFooter />
      </DialogContent>

      <ContributionPlanSheet
        goalId={goal.id}
        goalName={goal.name}
        targetAmountMinor={goal.target_amount_minor}
        savedAmountMinor={goal.saved_amount_minor}
        targetDateIso={goal.target_date}
        existingPlan={plan ?? null}
        open={planSheetOpen}
        onOpenChange={setPlanSheetOpen}
        onSaved={refreshPlan}
      />
    </Dialog>
  );
}

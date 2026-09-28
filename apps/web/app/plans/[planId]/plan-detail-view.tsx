"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, MoreHorizontal, Pencil, Plus, Unlink } from "lucide-react";
import {
  Money as DomainMoney,
  isValidPlanStatusTransition,
  isValidPlanItemStatusTransition,
  type PlanStatus,
} from "@spencare/domain-core";
import { planStatusSchema, planItemStatusSchema } from "@spencare/validation";
import type {
  AccountRow,
  CategoryRow,
  GoalRow,
  PlanDetail,
  PlannedCommitmentRow,
} from "@spencare/domain-application";
import {
  revivePlanCalculations,
  reviveCategoryBreakdown,
  type SerializedPlanCalculationResult,
  type SerializedPlanCategoryBreakdownEntry,
} from "@/lib/plan-calculations-serialization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLAN_STATUS_LABELS, PLAN_ITEM_STATUS_LABELS } from "@/lib/plan-status-labels";
import { formatPlanDate } from "@/lib/plan-date-format";
import { toastConfirmed, toastError } from "@/lib/toast";
import { updatePlanStatusAction, updatePlanItemStatusAction, dissociatePlanGoalAction, dissociatePlanCommitmentAction, dissociatePlanAccountAction, setTransactionPlanAction } from "../actions";
import { EditPlanSheet } from "./edit-plan-sheet";
import { PlanBudgetSheet } from "./plan-budget-sheet";
import { PlanItemSheet } from "./plan-item-sheet";
import { ArchivePlanDialog } from "./archive-plan-dialog";
import { DeletePlanDialog } from "./delete-plan-dialog";
import { AssociateGoalDialog } from "./associate-goal-dialog";
import { AssociateCommitmentDialog } from "./associate-commitment-dialog";
import { AssociateAccountDialog } from "./associate-account-dialog";
import { AssociateTransactionDialog } from "./associate-transaction-dialog";

/**
 * Verb-phrased button labels for a lifecycle transition, distinct from
 * `PLAN_STATUS_LABELS` (which names a STATE, e.g. "Paused" — confusing as
 * a button label, since it reads like the current state rather than an
 * action to take). The set of buttons shown is still driven entirely by
 * `isValidPlanStatusTransition` — this only maps an already-valid target
 * status to its call-to-action text.
 */
function lifecycleActionLabel(from: PlanStatus, target: PlanStatus): string {
  if (target === "active") return from === "archived" || from === "completed" ? "Reopen" : "Resume";
  if (target === "paused") return "Pause";
  if (target === "postponed") return "Postpone";
  if (target === "completed") return "Mark complete";
  return PLAN_STATUS_LABELS[target];
}

/**
 * The one full Plan read (Gate 3's `getPlanDetail`, Gate 4's own read
 * model). Every figure shown here — actualSpend, plannedSpend, remaining,
 * progress, overBudget, variance — is exactly what `initialDetail.calculations`
 * already contains; this component performs no financial arithmetic beyond
 * a single presentational grouping (the category breakdown, which sums
 * already-included transactions by `category_id` for display only — it
 * never redefines which transactions count as Plan spending; that rule
 * lives solely in Gate 1's `calculatePlanActualSpend`).
 */
export interface SerializedPlanDetail extends Omit<PlanDetail, "calculations" | "categoryBreakdown"> {
  calculations: SerializedPlanCalculationResult;
  categoryBreakdown: SerializedPlanCategoryBreakdownEntry[];
}

export function PlanDetailView({
  initialDetail,
  accounts,
  categories,
  goals,
  commitments,
  masked,
}: {
  initialDetail: SerializedPlanDetail;
  accounts: AccountRow[];
  categories: CategoryRow[];
  goals: GoalRow[];
  commitments: PlannedCommitmentRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const detail: PlanDetail = useMemo(
    () => ({
      ...initialDetail,
      calculations: revivePlanCalculations(initialDetail.calculations),
      categoryBreakdown: reviveCategoryBreakdown(initialDetail.categoryBreakdown),
    }),
    [initialDetail],
  );
  const { plan, items, goalLinks, commitmentLinks, accountLinks, transactions, calculations } = detail;
  const { budgetStatus, variance, progress, excludedTransactions, excludedItems } = calculations;

  const [editOpen, setEditOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [itemSheet, setItemSheet] = useState<{ open: boolean; item: (typeof items)[number] | null }>({
    open: false,
    item: null,
  });
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [commitmentDialogOpen, setCommitmentDialogOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);

  function refresh() {
    router.refresh();
  }

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const commitmentById = new Map(commitments.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const linkedGoals = goalLinks.map((l) => goalById.get(l.goal_id)).filter((g): g is GoalRow => !!g);
  const linkedCommitments = commitmentLinks
    .map((l) => commitmentById.get(l.commitment_id))
    .filter((c): c is PlannedCommitmentRow => !!c);
  const linkedAccounts = accountLinks.map((l) => accountById.get(l.account_id)).filter((a): a is AccountRow => !!a);

  const unlinkedGoals = goals.filter((g) => !goalLinks.some((l) => l.goal_id === g.id));
  const unlinkedCommitments = commitments.filter((c) => !commitmentLinks.some((l) => l.commitment_id === c.id));
  const unlinkedAccounts = accounts.filter((a) => !accountLinks.some((l) => l.account_id === a.id));

  const canDelete = plan.status === "draft" && items.length === 0 && goalLinks.length === 0 && commitmentLinks.length === 0 && accountLinks.length === 0 && transactions.length === 0;

  const nextStatuses = useMemo(
    () =>
      planStatusSchema.options.filter(
        (s) => s !== plan.status && s !== "archived" && isValidPlanStatusTransition(plan.status as PlanStatus, s),
      ),
    [plan.status],
  );

  async function handleStatusChange(targetStatus: PlanStatus) {
    const result = await updatePlanStatusAction(plan.id, { targetStatus });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`${plan.name} is now ${PLAN_STATUS_LABELS[targetStatus].toLowerCase()}.`);
    refresh();
  }

  async function handleItemStatusChange(itemId: string, targetStatus: (typeof planItemStatusSchema.options)[number]) {
    const result = await updatePlanItemStatusAction(plan.id, itemId, { targetStatus });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Item status updated.");
    refresh();
  }

  async function handleDetachTransaction(transactionId: string) {
    const result = await setTransactionPlanAction(plan.id, transactionId, { planId: null, planItemId: null });
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Transaction detached from this Plan.");
    refresh();
  }

  async function handleUnlinkGoal(goalId: string) {
    const result = await dissociatePlanGoalAction(plan.id, goalId);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Goal unlinked.");
    refresh();
  }

  async function handleUnlinkCommitment(commitmentId: string) {
    const result = await dissociatePlanCommitmentAction(plan.id, commitmentId);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Commitment unlinked.");
    refresh();
  }

  async function handleUnlinkAccount(accountId: string) {
    const result = await dissociatePlanAccountAction(plan.id, accountId);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Account unlinked.");
    refresh();
  }

  return (
    <div className="space-y-6">
      <Link href="/plans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Plans
      </Link>

      {/* Header — what is this Plan, and its current state */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="break-words text-2xl font-semibold text-foreground">{plan.name}</h1>
            <Badge variant={plan.status === "active" ? "default" : "outline"}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
          </div>
          {plan.description ? <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">
            {plan.base_currency}
            {formatPlanDate(plan.start_date) || formatPlanDate(plan.end_date) ? (
              <>
                {" · "}
                {formatPlanDate(plan.start_date) ?? "No start date"} – {formatPlanDate(plan.end_date) ?? "No end date"}
              </>
            ) : null}
          </p>
        </div>
        {/* A single overflow menu for every Plan-level action — matches the
            existing GoalCard convention (one "Actions" dropdown bundling
            Edit/lifecycle/Archive/Delete) rather than a growing row of
            individual buttons, which becomes visual noise once a Plan has
            several valid next statuses. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="touch" aria-label={`Actions for ${plan.name}`} className="shrink-0 px-0">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit Plan</DropdownMenuItem>
            {nextStatuses.map((target) => (
              <DropdownMenuItem key={target} onSelect={() => handleStatusChange(target)}>
                {lifecycleActionLabel(plan.status as PlanStatus, target)}
              </DropdownMenuItem>
            ))}
            {plan.status !== "archived" ? (
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>Archive Plan</DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                Delete Plan
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Financial position — one coherent section instead of several
          equal-weight cards, per the "budget / committed+upcoming / planned
          vs actual" hierarchy being a single mental model, not three. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Plan budget</p>
            <Button variant="ghost" size="sm" onClick={() => setBudgetOpen(true)}>
              {budgetStatus.hasBudget ? "Change budget" : "Add a budget"}
            </Button>
          </div>
          {budgetStatus.hasBudget && budgetStatus.currentBudget ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Plan budget</p>
                  <Money value={budgetStatus.currentBudget} masked={masked} size="numeric" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Spent</p>
                  <Money value={budgetStatus.actualSpend} masked={masked} size="numeric" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{budgetStatus.overBudget ? "Over by" : "Remaining"}</p>
                  <Money value={budgetStatus.remaining ?? budgetStatus.actualSpend} masked={masked} size="numeric" />
                </div>
              </div>
              <Progress
                value={Math.min(100, Math.max(0, progress.percentOfBudgetUsed ?? 0))}
                tone={budgetStatus.overBudget ? "warning" : undefined}
              />
              {budgetStatus.overBudget ? (
                <p className="text-xs text-warning">This Plan has gone over its budget — spending is still tracked normally.</p>
              ) : null}
            </>
          ) : (
            // No-budget is a valid, intentional state (Gate 1 §7/§8) — never
            // a fake "Remaining ₹0" / "Progress 0%" / "Over budget" reading.
            <p className="text-sm text-muted-foreground">
              No plan budget — this Plan is tracking spend only (<Money value={budgetStatus.actualSpend} masked={masked} size="body" />{" "}
              so far).
            </p>
          )}

          {!calculations.committedAmount.isZero() || !calculations.upcomingAmount.isZero() ? (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {!calculations.upcomingAmount.isZero() ? (
                <>
                  Upcoming <Money value={calculations.upcomingAmount} masked={masked} size="body" />
                </>
              ) : null}
              {!calculations.committedAmount.isZero() && !calculations.upcomingAmount.isZero() ? " · " : null}
              {!calculations.committedAmount.isZero() ? (
                <>
                  Committed <Money value={calculations.committedAmount} masked={masked} size="body" />
                </>
              ) : null}
            </p>
          ) : null}

          {!variance.planned.isZero() || !variance.actual.isZero() ? (
            <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Planned</p>
                <Money value={variance.planned} masked={masked} size="numeric" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Actual</p>
                <Money value={variance.actual} masked={masked} size="numeric" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Variance</p>
                <Money value={variance.variance} masked={masked} tone="auto" size="numeric" />
              </div>
            </div>
          ) : null}

          {excludedTransactions.length > 0 || excludedItems.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {excludedTransactions.length + excludedItems.length} item
              {excludedTransactions.length + excludedItems.length === 1 ? "" : "s"} in a different currency than{" "}
              {plan.base_currency} aren&rsquo;t included in these totals.
            </p>
          ) : null}

          {detail.categoryBreakdown.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">By category</p>
              {detail.categoryBreakdown.map(({ categoryId, actualSpend, plannedSpend }) => (
                <ListRow
                  key={categoryId ?? "uncategorized"}
                  title={(categoryId ? categoryById.get(categoryId)?.name : undefined) ?? "Uncategorized"}
                  subtitle={
                    plannedSpend != null ? (
                      <>
                        of <Money value={plannedSpend} masked={masked} size="body" /> planned
                      </>
                    ) : undefined
                  }
                  trailing={<Money value={actualSpend} masked={masked} />}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Plan items — "4. Planned items" in the section hierarchy */}
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Items</p>
            <Button variant="ghost" size="sm" onClick={() => setItemSheet({ open: true, item: null })}>
              <Plus className="size-4" aria-hidden="true" />
              Add item
            </Button>
          </div>
          {items.length === 0 ? (
            <EmptyState size="sm" title="No items yet" description="Add what you expect to spend on." />
          ) : (
            items.map((item) => {
              const itemNextStatuses = planItemStatusSchema.options.filter(
                (s) => s !== item.status && isValidPlanItemStatusTransition(item.status, s),
              );
              return (
                <ListRow
                  key={item.id}
                  title={item.name}
                  subtitle={item.category_id ? categoryById.get(item.category_id)?.name : undefined}
                  metadata={[formatPlanDate(item.expected_date), PLAN_ITEM_STATUS_LABELS[item.status]].filter(
                    (v): v is string => v != null,
                  )}
                  trailing={
                    item.estimated_amount_minor != null && item.estimated_currency ? (
                      <Money
                        value={DomainMoney.fromMinorUnits(BigInt(item.estimated_amount_minor), item.estimated_currency)}
                        masked={masked}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">No estimate</span>
                    )
                  }
                  hoverActions={
                    <>
                      <Button variant="ghost" size="icon" aria-label={`Edit ${item.name}`} onClick={() => setItemSheet({ open: true, item })}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      {itemNextStatuses.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Change status for ${item.name}`}>
                              <ChevronDown className="size-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {itemNextStatuses.map((s) => (
                              <DropdownMenuItem key={s} onClick={() => handleItemStatusChange(item.id, s)}>
                                {PLAN_ITEM_STATUS_LABELS[s]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </>
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Actual transactions */}
      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Transactions</p>
            <Button variant="ghost" size="sm" onClick={() => setTransactionDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Attach transaction
            </Button>
          </div>
          {transactions.length === 0 ? (
            <EmptyState size="sm" title="No transactions attached yet" />
          ) : (
            transactions.map((t) => (
              <ListRow
                key={t.id}
                title={t.merchant ?? t.description ?? "Transaction"}
                subtitle={formatPlanDate(t.occurred_at) ?? t.occurred_at}
                metadata={t.category_id ? [categoryById.get(t.category_id)?.name ?? ""] : []}
                trailing={
                  <Money
                    value={DomainMoney.fromMinorUnits(BigInt(t.amount_minor), t.currency)}
                    masked={masked}
                    tone={t.type === "expense" ? "negative" : "neutral"}
                  />
                }
                hoverActions={
                  <Button variant="ghost" size="icon" aria-label="Detach from this Plan" onClick={() => handleDetachTransaction(t.id)}>
                    <Unlink className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Associations — supporting context, least prominent, shown last */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AssociationCard
          title="Linked Goals"
          entries={linkedGoals.map((g) => ({ id: g.id, label: g.name }))}
          onAdd={() => setGoalDialogOpen(true)}
          onUnlink={handleUnlinkGoal}
          addLabel="Link a Goal"
        />
        <AssociationCard
          title="Linked Commitments"
          entries={linkedCommitments.map((c) => ({ id: c.id, label: c.name }))}
          onAdd={() => setCommitmentDialogOpen(true)}
          onUnlink={handleUnlinkCommitment}
          addLabel="Link a Commitment"
        />
        <AssociationCard
          title="Linked Accounts"
          entries={linkedAccounts.map((a) => ({ id: a.id, label: a.name }))}
          onAdd={() => setAccountDialogOpen(true)}
          onUnlink={handleUnlinkAccount}
          addLabel="Link an account"
        />
      </div>

      <EditPlanSheet plan={plan} open={editOpen} onOpenChange={setEditOpen} onUpdated={() => { setEditOpen(false); refresh(); }} />
      <PlanBudgetSheet plan={plan} open={budgetOpen} onOpenChange={setBudgetOpen} onUpdated={() => { setBudgetOpen(false); refresh(); }} />
      <ArchivePlanDialog plan={plan} open={archiveOpen} onOpenChange={setArchiveOpen} onArchived={() => { setArchiveOpen(false); refresh(); }} />
      <DeletePlanDialog plan={plan} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <PlanItemSheet
        planId={plan.id}
        currency={plan.base_currency}
        categories={categories}
        item={itemSheet.item}
        open={itemSheet.open}
        onOpenChange={(o) => setItemSheet((s) => ({ ...s, open: o }))}
        onSaved={() => { setItemSheet({ open: false, item: null }); refresh(); }}
      />
      <AssociateGoalDialog planId={plan.id} goals={unlinkedGoals} open={goalDialogOpen} onOpenChange={setGoalDialogOpen} onLinked={() => { setGoalDialogOpen(false); refresh(); }} />
      <AssociateCommitmentDialog planId={plan.id} commitments={unlinkedCommitments} open={commitmentDialogOpen} onOpenChange={setCommitmentDialogOpen} onLinked={() => { setCommitmentDialogOpen(false); refresh(); }} />
      <AssociateAccountDialog planId={plan.id} accounts={unlinkedAccounts} open={accountDialogOpen} onOpenChange={setAccountDialogOpen} onLinked={() => { setAccountDialogOpen(false); refresh(); }} />
      <AssociateTransactionDialog
        planId={plan.id}
        currency={plan.base_currency}
        items={items}
        open={transactionDialogOpen}
        onOpenChange={setTransactionDialogOpen}
        onAssociated={() => { setTransactionDialogOpen(false); refresh(); }}
      />
    </div>
  );
}

function AssociationCard({
  title,
  entries,
  onAdd,
  onUnlink,
  addLabel,
}: {
  title: string;
  entries: { id: string; label: string }[];
  onAdd: () => void;
  onUnlink: (id: string) => void;
  addLabel: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <Button variant="ghost" size="sm" onClick={onAdd} aria-label={addLabel}>
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">None linked yet.</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{e.label}</span>
                <Button variant="ghost" size="icon" aria-label={`Unlink ${e.label}`} onClick={() => onUnlink(e.id)}>
                  <Unlink className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

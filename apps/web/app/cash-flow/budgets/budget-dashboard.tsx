"use client";

import { useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Money as DomainMoney } from "@spencare/domain-core";
import type { BudgetWithUsage, CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, type ProgressTone } from "@/components/ui/progress";
import { ListRow } from "@/components/spencare/list-row";
import { Money } from "@/components/spencare/money";
import { EmptyState } from "@/components/spencare/empty-state";
import { formatMinorUnits } from "@/lib/currency-format";
import { AddBudgetSheet } from "./add-budget-sheet";
import { EditBudgetSheet } from "./edit-budget-sheet";
import { DeleteBudgetDialog } from "./delete-budget-dialog";

/**
 * SP-166's "Spend limits" dashboard slice: a rollup figure + repeating
 * category rows (icon+name, remaining amount, progress bar, "spent/budget"
 * caption). `ListRow` (not a new "BudgetCard") is the correct primitive
 * per component-inventory.md §8's own citation of SP-166 -- the same
 * lesson Phase 7 got wrong for Accounts and Phase 8 got right for
 * Transactions.
 *
 * The rollup is deliberately labeled "Budget remaining," never "Available
 * to spend" or "Safe to Spend" -- SP-166 itself uses "Available to spend"
 * because it shares a component with the separate Safe-to-Spend feature
 * (step 8, not built here), which folds in income/bills/goals this rollup
 * does not have. Relabeling avoids implying a computation this phase
 * doesn't perform (locked Phase 9 Safe-to-Spend boundary rule).
 *
 * budgets.amount_minor has no currency column (database-architecture.md
 * §"budgets" table) -- OBSERVED architectural constraint, treated as
 * INR-only same as every other seed/test fixture in this codebase.
 */

const CURRENCY = "INR";

function toneFor(status: BudgetWithUsage["status"]): ProgressTone {
  if (status === "exceeded") return "danger";
  if (status === "near_limit") return "warning";
  return "success";
}

function iconFor(iconName: string | null) {
  let IconComp: ComponentType<{ className?: string }> = Tag;
  if (iconName) {
    const pascal = iconName
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    const found = (LucideIcons as unknown as Record<string, ComponentType<{ className?: string }>>)[pascal];
    if (found) IconComp = found;
  }
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-muted" aria-hidden="true">
      <IconComp className="size-4 text-muted-foreground" />
    </div>
  );
}

function shiftMonth(periodStart: string, delta: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function formatMonthLabel(periodStart: string): string {
  return new Date(periodStart + "T00:00:00Z").toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatAmount(minor: number): string {
  const f = formatMinorUnits(BigInt(minor), CURRENCY);
  return `${f.symbol}${f.integerPart}.${f.decimalPart}`;
}

/**
 * SP-166's own "States" note: "exceeded (solid red, 'over' replaces
 * 'remaining')" -- exceeded categories show the *overage* magnitude with
 * an explicit "over" label, not a signed negative "remaining" figure.
 * Its "Interactions" note further flags that non-exceeded rows use
 * "black/neutral text" for remaining (only the "Transport" 0%-spent row
 * renders green, itself flagged as an unresolved open question) -- so
 * remaining is neutral-toned here, not tone="auto"'s green/"+", which
 * would incorrectly color every under-budget row green.
 */
function remainingDisplay(remainingMinor: number): { magnitude: number; tone: "neutral" | "negative"; label: string } {
  if (remainingMinor < 0) {
    return { magnitude: -remainingMinor, tone: "negative", label: "over" };
  }
  return { magnitude: remainingMinor, tone: "neutral", label: "remaining" };
}

export function BudgetDashboard({
  periodStart,
  usages,
  categories,
  masked,
}: {
  periodStart: string;
  usages: BudgetWithUsage[];
  categories: CategoryRow[];
  masked: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetWithUsage | null>(null);
  const [deleting, setDeleting] = useState<BudgetWithUsage | null>(null);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const budgetedCategoryIds = new Set(usages.map((u) => u.categoryId));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  const totalLimit = usages.reduce((sum, u) => sum + u.limitMinor, 0);
  const totalSpent = usages.reduce((sum, u) => sum + u.spentMinor, 0);
  const totalRemaining = totalLimit - totalSpent;
  const overallStatus: BudgetWithUsage["status"] =
    totalLimit > 0 && totalSpent / totalLimit >= 1
      ? "exceeded"
      : totalLimit > 0 && totalSpent / totalLimit >= 0.7
        ? "near_limit"
        : "under";

  function handleMutated() {
    router.refresh();
  }

  function goToMonth(next: string) {
    router.push(`/cash-flow/budgets?month=${next}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Budgets</h1>
        <Button
          size="touch"
          onClick={() => setAddOpen(true)}
          disabled={availableCategories.length === 0}
        >
          + Add budget
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => goToMonth(shiftMonth(periodStart, -1))}>
          ← Previous
        </Button>
        <span className="text-sm font-medium text-muted-foreground">{formatMonthLabel(periodStart)}</span>
        <Button variant="ghost" size="sm" onClick={() => goToMonth(shiftMonth(periodStart, 1))}>
          Next →
        </Button>
      </div>

      {usages.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title={`No budgets set for ${formatMonthLabel(periodStart)}`}
              description="Add a budget to start tracking your spending by category."
              action={availableCategories.length > 0 ? { label: "+ Add budget", onClick: () => setAddOpen(true) } : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="bg-primary/5 px-5 pt-5 pb-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">
                {totalRemaining < 0 ? "Over budget" : "Budget remaining"}
              </span>
              <div className="mt-1">
                <Money
                  value={DomainMoney.fromMinorUnits(BigInt(remainingDisplay(totalRemaining).magnitude), CURRENCY as never)}
                  masked={masked}
                  size="hero"
                  tone={remainingDisplay(totalRemaining).tone}
                  className="text-2xl min-[375px]:text-3xl sm:text-4xl tabular-nums"
                />
              </div>
            </div>
            <CardContent className="space-y-2 pt-3 pb-4">
              <Progress
                value={totalLimit > 0 ? Math.min(100, (totalSpent / totalLimit) * 100) : 0}
                tone={toneFor(overallStatus)}
                aria-label="Overall budget usage"
              />
              <p className="text-xs text-muted-foreground">
                {masked ? "Amount hidden" : `${formatAmount(totalSpent)} spent of ${formatAmount(totalLimit)} budgeted`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1">
              {usages.map((u) => {
                const category = categoryById.get(u.categoryId);
                const { magnitude, tone, label } = remainingDisplay(u.remainingMinor);
                return (
                  <div key={u.id} className="space-y-1.5 px-1 py-1">
                    <ListRow
                      icon={iconFor(category?.icon ?? null)}
                      title={category?.name ?? "Category"}
                      subtitle={
                        masked ? "Amount hidden" : `${formatAmount(u.spentMinor)} spent / ${formatAmount(u.limitMinor)} budget`
                      }
                      trailing={
                        <div className="text-right">
                          <Money
                            value={DomainMoney.fromMinorUnits(BigInt(magnitude), CURRENCY as never)}
                            masked={masked}
                            size="numeric"
                            tone={tone}
                            aria-label={
                              masked ? undefined : `${label === "over" ? "over budget by" : "remaining"} ${formatAmount(magnitude)}`
                            }
                          />
                          <div className="text-xs text-muted-foreground">{label}</div>
                        </div>
                      }
                      onClick={() => setEditing(u)}
                      aria-label={`${category?.name ?? "Category"}, edit budget`}
                      hoverActions={
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(u)}>
                          Delete
                        </Button>
                      }
                    />
                    <Progress
                      value={Math.min(100, u.percentUsed)}
                      tone={toneFor(u.status)}
                      className="mx-3 w-auto"
                      aria-label={`${category?.name ?? "Category"} budget usage`}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      <AddBudgetSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        periodStart={periodStart}
        categories={availableCategories}
        onCreated={() => {
          setAddOpen(false);
          handleMutated();
        }}
      />

      {editing ? (
        <EditBudgetSheet
          budget={editing}
          categoryName={categoryById.get(editing.categoryId)?.name ?? "Category"}
          open={!!editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          onUpdated={() => {
            setEditing(null);
            handleMutated();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteBudgetDialog
          budget={deleting}
          categoryName={categoryById.get(deleting.categoryId)?.name ?? "Category"}
          open={!!deleting}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          onDeleted={() => {
            setDeleting(null);
            handleMutated();
          }}
        />
      ) : null}
    </div>
  );
}

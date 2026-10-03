"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPinned } from "lucide-react";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/spencare/empty-state";
import { Money } from "@/components/spencare/money";
import { PLAN_STATUS_LABELS } from "@/lib/plan-status-labels";
import { formatPlanDate } from "@/lib/plan-date-format";
import { CreatePlanSheet } from "./create-plan-sheet";
import { revivePlanCalculations, type SerializedPlanCalculationResult } from "@/lib/plan-calculations-serialization";

/**
 * /plans list. Each card's figures come straight from
 * `listPlansWithSummariesAction`'s server-computed `PlanCalculationResult`
 * (Gate 1's pure `summarizePlan`) — this component performs no financial
 * arithmetic of its own, only presentation (rounding a percentage for the
 * progress bar's `value`, choosing a Progress `tone`). `calculations`
 * arrives pre-serialized (a real `Money` instance cannot cross the Server-
 * to-Client Component boundary) and is revived back into real Money once
 * here, not per render.
 */
export interface SerializedPlanWithSummary {
  plan: FinancialPlanRow;
  calculations: SerializedPlanCalculationResult;
  itemCount: number;
  transactionCount: number;
}

export function PlansGrid({
  initialPlans,
  masked,
}: {
  initialPlans: SerializedPlanWithSummary[];
  masked: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const plans = useMemo(
    () =>
      initialPlans.map((p) => ({
        plan: p.plan,
        calculations: revivePlanCalculations(p.calculations),
        itemCount: p.itemCount,
        transactionCount: p.transactionCount,
      })),
    [initialPlans],
  );

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (query === "") return plans;
    return plans.filter((p) => p.plan.name.toLowerCase().includes(query));
  }, [plans, query]);

  // Land on the new Plan's detail page (where items/transactions get added)
  // rather than back on the list, so the user sees what they just made.
  function handleCreated(planId: string) {
    setCreateOpen(false);
    router.push(`/plans/${planId}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Plans</h1>
          <p className="text-sm text-muted-foreground">
            Plans organize spending around real-life purposes — a trip, a wedding, a home renovation — separate from
            your ongoing monthly Budgets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              placeholder="Search Plans"
              aria-label="Search Plans"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44 pl-9"
            />
          </div>
          <Button size="touch" onClick={() => setCreateOpen(true)}>
            + Create Plan
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<MapPinned className="size-6" aria-hidden="true" />}
              title="No Plans yet"
              description="Plans help you organize spending around real-life purposes — like a trip, a wedding, or a home renovation."
              action={{ label: "Create your first Plan", onClick: () => setCreateOpen(true) }}
            />
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState title={`No matches for "${search}"`} description="Try a different search term." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ plan, calculations, itemCount, transactionCount }) => {
            const { budgetStatus, actualSpend, committedAmount, upcomingAmount } = calculations;
            const percent = budgetStatus.hasBudget
              ? Math.min(100, Math.max(0, calculations.progress.percentOfBudgetUsed ?? 0))
              : null;
            const startLabel = formatPlanDate(plan.start_date);
            const endLabel = formatPlanDate(plan.end_date);
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => router.push(`/plans/${plan.id}`)}
                className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-xl"
              >
                <Card className="h-full transition-colors hover:bg-accent/40">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{plan.name}</p>
                        {plan.description ? (
                          <p className="truncate text-xs text-muted-foreground">{plan.description}</p>
                        ) : null}
                        {/* Hidden entirely when neither date is set, rather than showing "-"/"N/A" for a valid, dateless Plan. */}
                        {startLabel || endLabel ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {startLabel ?? "No start"} – {endLabel ?? "No end"}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={plan.status === "active" ? "default" : "outline"}>
                        {PLAN_STATUS_LABELS[plan.status]}
                      </Badge>
                    </div>

                    {budgetStatus.hasBudget && budgetStatus.currentBudget ? (
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                          <span>
                            <Money value={actualSpend} masked={masked} size="body" /> of{" "}
                            <Money value={budgetStatus.currentBudget} masked={masked} size="body" />
                          </span>
                          {budgetStatus.overBudget ? <span className="text-warning">Over budget</span> : null}
                        </div>
                        <Progress value={percent ?? 0} tone={budgetStatus.overBudget ? "warning" : undefined} />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Tracking spend only — <Money value={actualSpend} masked={masked} size="body" /> so far
                      </p>
                    )}

                    {!committedAmount.isZero() || !upcomingAmount.isZero() ? (
                      <p className="text-xs text-muted-foreground">
                        {!upcomingAmount.isZero() ? (
                          <>
                            Upcoming <Money value={upcomingAmount} masked={masked} size="body" />
                          </>
                        ) : null}
                        {!committedAmount.isZero() && !upcomingAmount.isZero() ? " · " : null}
                        {!committedAmount.isZero() ? (
                          <>
                            Committed <Money value={committedAmount} masked={masked} size="body" />
                          </>
                        ) : null}
                      </p>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      {transactionCount} transaction{transactionCount === 1 ? "" : "s"} · {itemCount} item
                      {itemCount === 1 ? "" : "s"}
                    </p>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      <CreatePlanSheet open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  );
}

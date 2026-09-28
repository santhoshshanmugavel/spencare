"use client";

import { useState } from "react";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { updatePlanBudgetAction } from "../actions";

/**
 * Setting a budget below current actual spend is allowed without warning or
 * blocking here (Gate 4 spec: "reducing budget below actual" must not be
 * blocked) — `updatePlanBudget`/Gate 1's `calculatePlanRemainingBudget`
 * already handle a negative `remaining` and `overBudget: true` honestly;
 * the detail view's summary section is what surfaces that calmly (Progress
 * tone="warning"), not this form.
 */
export function PlanBudgetSheet({
  plan,
  open,
  onOpenChange,
  onUpdated,
}: {
  plan: FinancialPlanRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [display, setDisplay] = useState(
    plan.current_budget_minor != null ? minorUnitsToDisplay(plan.current_budget_minor, plan.base_currency) : "",
  );
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    let budgetMinor: number | null = null;
    if (display.trim() !== "") {
      const parsed = parseMoneyInput(display, plan.base_currency);
      if (parsed.error) {
        setError(parsed.error);
        return;
      }
      budgetMinor = parsed.minor;
    }
    setIsSubmitting(true);
    const result = await updatePlanBudgetAction(plan.id, { budgetMinor });
    setIsSubmitting(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(budgetMinor === null ? "Budget removed — this Plan now just tracks spending." : "Budget updated.");
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Set budget</SheetTitle>
          <SheetDescription>
            Set a total limit for {plan.name}, or clear it to just track spending with no limit.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4 px-4">
          <FormField
            id="plan-budget-amount"
            label={`Total budget (${plan.base_currency})`}
            error={error}
            hint="Leave empty to remove the budget."
          >
            <Input
              id="plan-budget-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
              aria-describedby={error ? errorId("plan-budget-amount") : undefined}
            />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save budget"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

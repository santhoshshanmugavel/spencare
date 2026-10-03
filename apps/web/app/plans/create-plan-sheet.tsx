"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFinancialPlanSchema, type CreateFinancialPlanInput } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput } from "@/lib/money-input";
import { createPlanAction, updatePlanBudgetAction } from "./actions";

const CURRENCY_OPTIONS = ["INR", "USD", "EUR", "GBP", "JPY"];

/**
 * Progressive Plan creation (Gate 4 spec): only a name is required. Leaving
 * "Total budget" empty creates a "Just track it" Plan (no limit — items and
 * transactions can still be attached to it later); filling it in creates a
 * "Total limit" Plan. "Plan by category" isn't a distinct creation mode —
 * it's the same Plan with no top-level budget, refined afterward on the
 * detail page by adding category-tagged Plan Items (Gate 3's `addPlanItem`),
 * whose estimated amounts roll up into `plannedSpend` per Gate 1's
 * `calculatePlanPlannedSpend`. This sheet never talks to Supabase directly —
 * it only calls the two Gate 3 server actions in sequence when a budget is
 * given, since `createPlan` and `updatePlanBudget` are separate commands.
 */
export function CreatePlanSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (planId: string) => void;
}) {
  const [budgetDisplay, setBudgetDisplay] = useState("");
  const [budgetError, setBudgetError] = useState<string | undefined>();
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateFinancialPlanInput>({
    resolver: zodResolver(createFinancialPlanSchema),
    defaultValues: { name: "", description: null, baseCurrency: "INR", startDate: null, endDate: null },
  });
  const currency = watch("baseCurrency") || "INR";

  async function onSubmit(data: CreateFinancialPlanInput) {
    setBudgetError(undefined);
    let budgetMinor: number | null = null;
    if (budgetDisplay.trim() !== "") {
      const parsed = parseMoneyInput(budgetDisplay, currency);
      if (parsed.error) {
        setBudgetError(parsed.error);
        return;
      }
      budgetMinor = parsed.minor;
    }

    const created = await createPlanAction(data);
    if (!created.ok) {
      toastError(created.error.message);
      return;
    }

    if (budgetMinor !== null) {
      const budgetResult = await updatePlanBudgetAction(created.value.id, { budgetMinor });
      if (!budgetResult.ok) {
        toastError(`Plan created, but the budget couldn't be saved: ${budgetResult.error.message}`);
        reset();
        setBudgetDisplay("");
        onCreated(created.value.id);
        return;
      }
    }

    toastConfirmed(`${created.value.name} created.`);
    reset();
    setBudgetDisplay("");
    onCreated(created.value.id);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Create a Plan</SheetTitle>
          <SheetDescription>
            A Plan organizes spending around a real-life purpose — a trip, a wedding, a renovation. Only a name is
            required; add a budget and dates whenever you&rsquo;re ready.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="create-plan-name" label="Plan name" error={errors.name?.message}>
            <Input id="create-plan-name" placeholder="e.g. Thailand Trip" {...register("name")} />
          </FormField>

          <FormField id="create-plan-description" label="Purpose (optional)" error={errors.description?.message}>
            <Textarea id="create-plan-description" placeholder="What is this Plan for?" {...register("description")} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id="create-plan-start" label="Start date (optional)">
              <Input id="create-plan-start" type="date" {...register("startDate")} />
            </FormField>
            <FormField id="create-plan-end" label="End date (optional)" error={errors.endDate?.message}>
              <Input id="create-plan-end" type="date" {...register("endDate")} />
            </FormField>
          </div>

          <Controller
            control={control}
            name="baseCurrency"
            render={({ field }) => (
              <FormField
                id="create-plan-currency"
                label="Currency"
                hint="A Plan has one currency (v1). Transactions or items in another currency are tracked separately, never converted."
              >
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="create-plan-currency">
                    <SelectValue placeholder="Choose a currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <FormField
            id="create-plan-budget"
            label="Total budget (optional)"
            error={budgetError}
            hint="Leave this empty to just track spending with no limit."
          >
            <Input
              id="create-plan-budget"
              inputMode="decimal"
              placeholder="0.00"
              value={budgetDisplay}
              onChange={(e) => setBudgetDisplay(e.target.value)}
              aria-describedby={budgetError ? errorId("create-plan-budget") : undefined}
            />
          </FormField>

          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create Plan"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

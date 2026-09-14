"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createGoalContributionPlanSchema, GOAL_CONTRIBUTION_FREQUENCIES, type CreateGoalContributionPlanInput } from "@spencare/validation";
import type { GoalContributionPlanRow } from "@spencare/domain-application";
import { FREQUENCY_LABELS, suggestContributionAmount } from "@spencare/domain-core";
import { Money as DomainMoney } from "@spencare/domain-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, errorId } from "@/components/spencare/form-field";
import { Money } from "@/components/spencare/money";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import {
  createGoalContributionPlanAction,
  updateGoalContributionPlanAction,
  deleteGoalContributionPlanAction,
} from "./actions";

/**
 * Sheet for creating or editing a contribution plan.
 * A plan is a REMINDER SCHEDULE only — it never moves money automatically.
 * The "Save" button creates/updates the plan; actual contributions still
 * require an explicit user action in the contribute sheet.
 */

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function onChange(raw: string, set: (minor: number) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (normalized === "" || normalized === ".") { set(0); return; }
    const { minor } = parseMoneyInput(normalized, "INR");
    set(minor);
  }
  return { display, onChange };
}

export function ContributionPlanSheet({
  goalId,
  goalName,
  targetAmountMinor,
  savedAmountMinor,
  targetDateIso,
  existingPlan,
  open,
  onOpenChange,
  onSaved,
}: {
  goalId: string;
  goalName: string;
  targetAmountMinor: number;
  savedAmountMinor: number;
  targetDateIso: string | null;
  existingPlan: GoalContributionPlanRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEditing = !!existingPlan;
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateGoalContributionPlanInput>({
    resolver: zodResolver(createGoalContributionPlanSchema),
    defaultValues: {
      goalId,
      frequency: existingPlan?.frequency ?? "monthly",
      amountMinor: existingPlan?.amount_minor ?? 0,
      anchorDay: existingPlan?.anchor_day ?? 1,
    },
  });

  const frequency = watch("frequency");
  const amountMinor = watch("amountMinor");

  // Reset form when sheet opens/closes or existingPlan changes
  useEffect(() => {
    reset({
      goalId,
      frequency: existingPlan?.frequency ?? "monthly",
      amountMinor: existingPlan?.amount_minor ?? 0,
      anchorDay: existingPlan?.anchor_day ?? 1,
    });
  }, [open, existingPlan, goalId, reset]);

  const amountField = useMoneyField(
    existingPlan?.amount_minor ? minorUnitsToDisplay(existingPlan.amount_minor, "INR") : "",
  );

  const suggestion = suggestContributionAmount(
    targetAmountMinor,
    savedAmountMinor,
    targetDateIso,
    frequency,
  );

  async function onSubmit(values: CreateGoalContributionPlanInput) {
    if (isEditing && existingPlan) {
      const result = await updateGoalContributionPlanAction(existingPlan.id, {
        frequency: values.frequency,
        amountMinor: values.amountMinor,
        anchorDay: values.anchorDay,
      });
      if (!result.ok) { toastError(result.error.message); return; }
    } else {
      const result = await createGoalContributionPlanAction(values);
      if (!result.ok) { toastError(result.error.message); return; }
    }
    toastConfirmed(isEditing ? "Plan updated." : "Plan set up! Spensa will remind you when it's time.");
    onSaved();
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!existingPlan) return;
    const result = await deleteGoalContributionPlanAction(existingPlan.id);
    if (!result.ok) { toastError(result.error.message); return; }
    toastConfirmed("Plan removed.");
    onSaved();
    onOpenChange(false);
  }

  const anchorDayLabel = frequency === "weekly" ? "Day of week" : "Day of month";
  const showAnchorDay = frequency !== "daily" && frequency !== "yearly";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit contribution plan" : "Set up a contribution plan"}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? `Adjust your savings schedule for ${goalName}.`
              : `Schedule reminders to save regularly for ${goalName}. This is a reminder — not an automatic transfer.`}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
          <input type="hidden" {...register("goalId")} />

          <FormField id="frequency" label="Frequency" error={errors.frequency?.message}>
            <Controller
              name="frequency"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={errorId("frequency")} aria-invalid={!!errors.frequency}>
                    <SelectValue placeholder="How often?" />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_CONTRIBUTION_FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <FormField id="amountMinor" label="Amount per period (INR ₹)" error={errors.amountMinor?.message}>
            <Controller
              name="amountMinor"
              control={control}
              render={({ field }) => (
                <Input
                  id={errorId("amountMinor")}
                  type="text"
                  inputMode="decimal"
                  placeholder="10000"
                  aria-invalid={!!errors.amountMinor}
                  aria-describedby={errors.amountMinor ? errorId("amountMinor") : undefined}
                  value={amountField.display}
                  onChange={(e) => amountField.onChange(e.target.value, field.onChange)}
                />
              )}
            />
            {suggestion && suggestion > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Suggested:{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => {
                    setValue("amountMinor", suggestion);
                    amountField.onChange(
                      String(Math.round(suggestion / 100)),
                      () => {},
                    );
                  }}
                >
                  <Money value={DomainMoney.fromNumber(suggestion, "INR")} />
                </button>{" "}
                to reach your goal on time.
              </p>
            ) : null}
          </FormField>

          {showAnchorDay ? (
            <FormField
              id="anchorDay"
              label={anchorDayLabel}
              error={errors.anchorDay?.message}
            >
              <Controller
                name="anchorDay"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value != null ? String(field.value) : ""}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <SelectTrigger id={errorId("anchorDay")} aria-invalid={!!errors.anchorDay}>
                      <SelectValue placeholder={frequency === "weekly" ? "Select day" : "Select day of month"} />
                    </SelectTrigger>
                    <SelectContent>
                      {frequency === "weekly"
                        ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, i) => (
                            <SelectItem key={i + 1} value={String(i + 1)}>
                              {day}
                            </SelectItem>
                          ))
                        : Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {d}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button type="submit" size="touch" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEditing ? "Update plan" : "Set up plan"}
            </Button>
            {isEditing ? (
              <Button type="button" size="touch" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                Remove
              </Button>
            ) : (
              <Button type="button" size="touch" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
            )}
          </div>
        </form>

        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createPlanItemSchema, type CreatePlanItemInput } from "@spencare/validation";
import type { CategoryRow, PlanItemRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { addPlanItemAction, updatePlanItemAction } from "../actions";

/**
 * Shared add/edit form for a Plan Item — an expectation, never a
 * transaction (Gate 1 locked invariant). `estimatedAmountMinor` is
 * optional: a bare "Flight" placeholder with no price yet is a fully valid
 * item (progressive planning). Category here reuses the app's global
 * `categories` table (Gate 4 spec: "reusing global categories") — Plans
 * never define their own category list.
 */
export function PlanItemSheet({
  planId,
  currency,
  categories,
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  planId: string;
  currency: string;
  categories: CategoryRow[];
  /** `null` = add mode; otherwise editing this existing item. */
  item: PlanItemRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [amountDisplay, setAmountDisplay] = useState(
    item?.estimated_amount_minor != null ? minorUnitsToDisplay(item.estimated_amount_minor, currency) : "",
  );
  const [amountError, setAmountError] = useState<string | undefined>();
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreatePlanItemInput>({
    resolver: zodResolver(createPlanItemSchema),
    defaultValues: {
      name: item?.name ?? "",
      description: item?.description ?? null,
      categoryId: item?.category_id ?? null,
      estimatedAmountMinor: item?.estimated_amount_minor ?? null,
      estimatedCurrency: item?.estimated_currency ?? null,
      expectedDate: item?.expected_date ?? null,
      commitmentId: item?.commitment_id ?? null,
    },
  });

  async function onSubmit(data: CreatePlanItemInput) {
    setAmountError(undefined);
    let estimatedAmountMinor: number | null = null;
    if (amountDisplay.trim() !== "") {
      const parsed = parseMoneyInput(amountDisplay, currency);
      if (parsed.error) {
        setAmountError(parsed.error);
        return;
      }
      estimatedAmountMinor = parsed.minor;
    }
    const payload: CreatePlanItemInput = {
      ...data,
      estimatedAmountMinor,
      estimatedCurrency: estimatedAmountMinor === null ? null : currency,
    };

    const result = item
      ? await updatePlanItemAction(planId, item.id, payload)
      : await addPlanItemAction(planId, payload);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(item ? "Item updated." : "Item added.");
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{item ? `Edit ${item.name}` : "Add a Plan item"}</SheetTitle>
          <SheetDescription>
            An item is something you expect to spend on — a price estimate, not a real transaction yet.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="plan-item-name" label="Item name" error={errors.name?.message}>
            <Input id="plan-item-name" placeholder="e.g. Flights" {...register("name")} />
          </FormField>

          <FormField id="plan-item-description" label="Notes (optional)" error={errors.description?.message}>
            <Textarea id="plan-item-description" {...register("description")} />
          </FormField>

          <FormField
            id="plan-item-amount"
            label={`Estimated amount (optional, ${currency})`}
            error={amountError}
            hint="Leave empty for a placeholder item you haven't priced yet."
          >
            <Input
              id="plan-item-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amountDisplay}
              onChange={(e) => setAmountDisplay(e.target.value)}
              aria-describedby={amountError ? errorId("plan-item-amount") : undefined}
            />
          </FormField>

          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="plan-item-category" label="Category (optional)" error={errors.categoryId?.message}>
                <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="plan-item-category">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          <FormField id="plan-item-date" label="Expected date (optional)">
            <Input id="plan-item-date" type="date" {...register("expectedDate")} />
          </FormField>

          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : item ? "Save changes" : "Add item"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateFinancialPlanSchema, type UpdateFinancialPlanInput } from "@spencare/validation";
import type { FinancialPlanRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormField } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { updatePlanAction } from "../actions";

/** Name/purpose/dates only — currency is locked at creation (single-currency v1 contract, Gate 1 D-003) and never editable here. */
export function EditPlanSheet({
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
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateFinancialPlanInput>({
    resolver: zodResolver(updateFinancialPlanSchema),
    defaultValues: {
      name: plan.name,
      description: plan.description,
      startDate: plan.start_date,
      endDate: plan.end_date,
    },
  });

  async function onSubmit(data: UpdateFinancialPlanInput) {
    const result = await updatePlanAction(plan.id, data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed("Plan updated.");
    onUpdated();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {plan.name}</SheetTitle>
          <SheetDescription>Change the name, purpose, or dates. Currency can&rsquo;t be changed after creation.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="edit-plan-name" label="Plan name" error={errors.name?.message}>
            <Input id="edit-plan-name" {...register("name")} />
          </FormField>
          <FormField id="edit-plan-description" label="Purpose (optional)" error={errors.description?.message}>
            <Textarea id="edit-plan-description" {...register("description")} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="edit-plan-start" label="Start date (optional)">
              <Input id="edit-plan-start" type="date" {...register("startDate")} />
            </FormField>
            <FormField id="edit-plan-end" label="End date (optional)" error={errors.endDate?.message}>
              <Input id="edit-plan-end" type="date" {...register("endDate")} />
            </FormField>
          </div>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

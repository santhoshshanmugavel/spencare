"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCommitmentSchema,
  PAYMENT_FREQUENCIES,
  PAYMENT_FREQUENCY_LABELS,
  SAVING_CADENCES,
  SAVING_CADENCE_LABELS,
  type CreateCommitmentInput,
} from "@spencare/validation";
import type { AccountRow, CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { toastConfirmed, toastError } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { CreditCard } from "lucide-react";
import { getCategoryIcon } from "@/lib/category-icons";
import { createCommitmentAction, updateCommitmentAction } from "./actions";
import type { PlannedCommitmentRow } from "@spencare/domain-application";

const CURRENCY = "INR";

function useMoneyField(initialMinor?: number) {
  const [display, setDisplay] = useState(initialMinor ? minorUnitsToDisplay(initialMinor, CURRENCY) : "");
  function onChange(raw: string, set: (minor: number | null) => void) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : cleaned;
    setDisplay(normalized);
    if (!normalized || normalized === ".") { set(null); return; }
    const { minor } = parseMoneyInput(normalized, CURRENCY);
    set(minor);
  }
  return { display, setDisplay, onChange };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function msg(e: any): string | undefined { return typeof e?.message === "string" ? e.message : undefined; }

interface CommitmentSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  accounts: AccountRow[];
  categories: CategoryRow[];
  existing?: PlannedCommitmentRow;
}

export function CommitmentSheet({ open, onOpenChange, onSaved, accounts, categories, existing }: CommitmentSheetProps) {
  const isEdit = !!existing;
  const amountField = useMoneyField(existing?.amount_minor);
  const savingAmountField = useMoneyField(existing?.saving_amount_minor ?? undefined);
  const alreadyReservedField = useMoneyField(undefined);

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useForm<any>({
    resolver: zodResolver(createCommitmentSchema),
    defaultValues: {
      name: existing?.name ?? "",
      categoryId: existing?.category_id ?? "",
      amountMinor: existing?.amount_minor ?? (undefined as unknown as number),
      amountIsEstimate: existing?.amount_is_estimate ?? false,
      currency: CURRENCY,
      paymentFrequency: (existing?.payment_frequency ?? "monthly") as CreateCommitmentInput["paymentFrequency"],
      nextPaymentDate: existing?.next_payment_date ?? "",
      paymentAccountId: existing?.payment_account_id ?? null,
      reserveAccountId: existing?.reserve_account_id ?? null,
      alreadyReservedMinor: null,
      savingCadence: (existing?.saving_cadence ?? null) as CreateCommitmentInput["savingCadence"],
      savingAmountMinor: existing?.saving_amount_minor ?? null,
      firstSavingDate: existing?.first_saving_date ?? null,
      tenureType: existing?.tenure_type ?? "none",
      tenurePayments: existing?.tenure_payments ?? null,
      tenureEndDate: existing?.tenure_end_date ?? null,
      notes: existing?.notes ?? null,
      autoPayEnabled: existing?.auto_pay_enabled ?? false,
      autoProtectEnabled: existing?.auto_protect_enabled ?? false,
    },
  });

  const tenureType = watch("tenureType");
  const savingCadence = watch("savingCadence");
  const paymentAccountId = watch("paymentAccountId");
  const reserveAccountId = watch("reserveAccountId");

  const paymentAccount = accounts.find((a) => a.id === paymentAccountId);
  const isCreditCard = paymentAccount?.type === "credit_card";
  const hasSavingSchedule = !!savingCadence;
  const hasReserveAccount = !!reserveAccountId;

  function handlePaymentAccountChange(accountId: string | null, fieldOnChange: (v: string | null) => void) {
    fieldOnChange(accountId || null);
    const account = accounts.find((a) => a.id === accountId);
    if (account?.type === "credit_card") {
      setValue("reserveAccountId", null);
      setValue("savingCadence", null);
      setValue("savingAmountMinor", null);
      setValue("firstSavingDate", null);
      setValue("alreadyReservedMinor", null);
      alreadyReservedField.setDisplay("");
      savingAmountField.setDisplay("");
    }
  }

  async function onSubmit(data: CreateCommitmentInput) {
    let result;
    if (isEdit && existing) {
      result = await updateCommitmentAction(existing.id, {
        name: data.name,
        categoryId: data.categoryId,
        amountMinor: data.amountMinor,
        amountIsEstimate: data.amountIsEstimate,
        paymentFrequency: data.paymentFrequency,
        nextPaymentDate: data.nextPaymentDate,
        paymentAccountId: data.paymentAccountId,
        reserveAccountId: data.reserveAccountId,
        savingCadence: data.savingCadence,
        savingAmountMinor: data.savingAmountMinor,
        firstSavingDate: data.firstSavingDate,
        tenureType: data.tenureType,
        tenurePayments: data.tenurePayments,
        tenureEndDate: data.tenureEndDate,
        notes: data.notes,
        autoPayEnabled: data.autoPayEnabled,
        autoProtectEnabled: data.autoProtectEnabled,
      });
    } else {
      result = await createCommitmentAction(data);
    }
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(isEdit ? "Commitment updated." : "Commitment added.");
    if (!isEdit) {
      reset();
      amountField.setDisplay("");
      savingAmountField.setDisplay("");
      alreadyReservedField.setDisplay("");
    }
    onSaved();
  }

  const paymentAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash" || a.type === "credit_card");
  const reserveAccounts = accounts.filter((a) => a.type === "bank" || a.type === "cash");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit commitment" : "Add commitment"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update this planned commitment."
              : "Plan a future payment and optionally protect money ahead of time."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4 pb-6">
          {/* Name */}
          <FormField id="c-name" label="What are you planning for?" error={msg(errors.name)}>
            <Input
              id="c-name"
              placeholder="e.g. Star Health Insurance, Netflix"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? errorId("c-name") : undefined}
              {...register("name")}
            />
          </FormField>

          {/* Amount */}
          <FormField id="c-amount" label="How much will you pay? (INR)" error={msg(errors.amountMinor)}>
            <Input
              id="c-amount"
              inputMode="decimal"
              placeholder="0"
              value={amountField.display}
              aria-invalid={!!errors.amountMinor}
              aria-describedby={errors.amountMinor ? errorId("c-amount") : undefined}
              onChange={(e) => amountField.onChange(e.target.value, (v) => setValue("amountMinor", v ?? 0))}
            />
          </FormField>

          {/* Category - required */}
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField
                id="c-category"
                label="Category"
                error={msg(errors.categoryId)}
              >
                <Select
                  value={field.value ?? ""}
                  onValueChange={(v) => field.onChange(v || "")}
                >
                  <SelectTrigger id="c-category" aria-invalid={!!errors.categoryId}>
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => {
                      const Icon = getCategoryIcon(cat.icon) ?? CreditCard;
                      return (
                        <SelectItem key={cat.id} value={cat.id}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            {cat.name}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Estimate toggle */}
          <div className="flex items-center gap-3">
            <Controller
              control={control}
              name="amountIsEstimate"
              render={({ field }) => (
                <Switch id="c-estimate" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="c-estimate" className="text-sm text-muted-foreground">
              Amount varies (estimate)
            </Label>
          </div>

          {/* Payment frequency */}
          <Controller
            control={control}
            name="paymentFrequency"
            render={({ field }) => (
              <FormField id="c-freq" label="How often do you pay?" error={msg(errors.paymentFrequency)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="c-freq">
                    <SelectValue placeholder="Choose frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>{PAYMENT_FREQUENCY_LABELS[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Next payment date */}
          <FormField id="c-next-pay" label="Next payment date" error={msg(errors.nextPaymentDate)}>
            <Input
              id="c-next-pay"
              type="date"
              aria-invalid={!!errors.nextPaymentDate}
              aria-describedby={errors.nextPaymentDate ? errorId("c-next-pay") : undefined}
              {...register("nextPaymentDate")}
            />
          </FormField>

          {/* Payment account */}
          <Controller
            control={control}
            name="paymentAccountId"
            render={({ field }) => (
              <FormField
                id="c-payment-account"
                label="Which account will you pay from?"
                hint="Bank, cash, or credit card."
                error={msg(errors.paymentAccountId)}
              >
                <Select
                  value={field.value ?? ""}
                  onValueChange={(v) => handlePaymentAccountChange(v || null, field.onChange)}
                >
                  <SelectTrigger id="c-payment-account">
                    <SelectValue placeholder="Choose payment account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No specific account</SelectItem>
                    {paymentAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {/* Reserve account - bank/cash only, hidden when credit card */}
          {!isCreditCard && (
            <Controller
              control={control}
              name="reserveAccountId"
              render={({ field }) => (
                <FormField
                  id="c-reserve-account"
                  label="Where do you want to protect money for this?"
                  hint="Choose a bank or cash account to set money aside. Leave empty if you want to track without protecting money."
                  error={msg(errors.reserveAccountId)}
                >
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => {
                      field.onChange(v || null);
                      if (!v) {
                        setValue("savingCadence", null);
                        setValue("savingAmountMinor", null);
                        setValue("firstSavingDate", null);
                        setValue("alreadyReservedMinor", null);
                        alreadyReservedField.setDisplay("");
                        savingAmountField.setDisplay("");
                      }
                    }}
                  >
                    <SelectTrigger id="c-reserve-account">
                      <SelectValue placeholder="No cash protection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No cash protection</SelectItem>
                      {reserveAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          )}

          {isCreditCard && (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-2">
              Credit card payments are tracked but no cash is set aside. Spencare will not reserve money from any bank account for this commitment.
            </p>
          )}

          {/* Already protected - only when reserve account is set */}
          {hasReserveAccount && !isCreditCard && (
            <FormField
              id="c-already-reserved"
              label="Do you already have money set aside? (INR)"
              hint="If you already saved part of this amount, enter it here. No transaction will be created."
              error={msg(errors.alreadyReservedMinor)}
            >
              <Input
                id="c-already-reserved"
                inputMode="decimal"
                placeholder="0"
                value={alreadyReservedField.display}
                aria-invalid={!!errors.alreadyReservedMinor}
                aria-describedby={errors.alreadyReservedMinor ? errorId("c-already-reserved") : undefined}
                onChange={(e) =>
                  alreadyReservedField.onChange(e.target.value, (v) => setValue("alreadyReservedMinor", v))
                }
              />
            </FormField>
          )}

          {/* Duration */}
          <Controller
            control={control}
            name="tenureType"
            render={({ field }) => (
              <FormField id="c-tenure" label="How long should this continue?" error={msg(errors.tenureType)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="c-tenure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No end date</SelectItem>
                    <SelectItem value="n_payments">End after N payments</SelectItem>
                    <SelectItem value="end_date">End on a date</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />

          {tenureType === "n_payments" && (
            <FormField id="c-n-pay" label="Number of payments" error={msg(errors.tenurePayments)}>
              <Input
                id="c-n-pay"
                type="number"
                min={1}
                inputMode="numeric"
                aria-invalid={!!errors.tenurePayments}
                {...register("tenurePayments", { valueAsNumber: true })}
              />
            </FormField>
          )}

          {tenureType === "end_date" && (
            <FormField id="c-end-date" label="End date" error={msg(errors.tenureEndDate)}>
              <Input
                id="c-end-date"
                type="date"
                aria-invalid={!!errors.tenureEndDate}
                {...register("tenureEndDate")}
              />
            </FormField>
          )}

          {/* Saving schedule - only when reserve account is set */}
          {hasReserveAccount && !isCreditCard && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Set money aside ahead of time (optional)</p>
              <p className="text-xs text-muted-foreground">
                Spencare will remind you to set aside money each period so the full amount is ready by the payment date.
              </p>

              <Controller
                control={control}
                name="savingCadence"
                render={({ field }) => (
                  <FormField id="c-saving-cadence" label="How often do you want to set money aside?" error={msg(errors.savingCadence)}>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <SelectTrigger id="c-saving-cadence">
                        <SelectValue placeholder="Choose frequency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No saving schedule</SelectItem>
                        {SAVING_CADENCES.map((c) => (
                          <SelectItem key={c} value={c}>{SAVING_CADENCE_LABELS[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              />

              {hasSavingSchedule && (
                <>
                  <FormField id="c-saving-amt" label="How much to set aside each time? (INR)" error={msg(errors.savingAmountMinor)}>
                    <Input
                      id="c-saving-amt"
                      inputMode="decimal"
                      placeholder="0"
                      value={savingAmountField.display}
                      aria-invalid={!!errors.savingAmountMinor}
                      aria-describedby={errors.savingAmountMinor ? errorId("c-saving-amt") : undefined}
                      onChange={(e) =>
                        savingAmountField.onChange(e.target.value, (v) => setValue("savingAmountMinor", v))
                      }
                    />
                  </FormField>

                  <FormField id="c-first-save" label="When do you start?" error={msg(errors.firstSavingDate)}>
                    <Input
                      id="c-first-save"
                      type="date"
                      aria-invalid={!!errors.firstSavingDate}
                      aria-describedby={errors.firstSavingDate ? errorId("c-first-save") : undefined}
                      {...register("firstSavingDate")}
                    />
                  </FormField>
                </>
              )}
            </div>
          )}

          {/* Auto-pay toggle - only when a payment account is selected */}
          {paymentAccountId && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Controller
                  control={control}
                  name="autoPayEnabled"
                  render={({ field }) => (
                    <Switch
                      id="c-autopay"
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5 shrink-0"
                    />
                  )}
                />
                <div>
                  <Label htmlFor="c-autopay" className="text-sm font-medium">Enable Auto-pay</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Spencare will automatically record this payment in your account on the scheduled date.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Auto-protect toggle - only when saving schedule is configured */}
          {hasSavingSchedule && !isCreditCard && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Controller
                  control={control}
                  name="autoProtectEnabled"
                  render={({ field }) => (
                    <Switch
                      id="c-autoprotect"
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5 shrink-0"
                    />
                  )}
                />
                <div>
                  <Label htmlFor="c-autoprotect" className="text-sm font-medium">Enable Auto-protect</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Spencare will automatically protect money on each saving date.
                  </p>
                </div>
              </div>
            </div>
          )}

          <SheetFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Saving..." : isEdit ? "Save changes" : "Add commitment"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useState, useEffect } from "react";
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

const PAYMENT_DAY_LAST_OF_MONTH = 32;

function ordinalLabel(n: number): string {
  if (n === PAYMENT_DAY_LAST_OF_MONTH) return "Last day of month";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const DAY_RULE_OPTIONS: { value: number; label: string }[] = [
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: ordinalLabel(i + 1) })),
  { value: PAYMENT_DAY_LAST_OF_MONTH, label: "Last day of month" },
];

// ISO 8601: 1=Mon … 7=Sun
const DAY_OF_WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

function nextPaymentDateFromDayRule(dayRule: number): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const daysInM = new Date(y, m, 0).getDate();
  const day = dayRule >= PAYMENT_DAY_LAST_OF_MONTH ? daysInM : Math.min(dayRule, daysInM);
  const pad = (n: number) => String(n).padStart(2, "0");
  const candidate = `${y}-${pad(m)}-${pad(day)}`;
  const todayIso = today.toISOString().slice(0, 10);
  if (candidate >= todayIso) return candidate;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const daysInN = new Date(ny, nm, 0).getDate();
  const nd = dayRule >= PAYMENT_DAY_LAST_OF_MONTH ? daysInN : Math.min(dayRule, daysInN);
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

// Compute first_saving_date from a day-of-month rule (1-31 or 32 = last)
function firstSavingDateFromMonthlyRule(dayRule: number): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInM = new Date(y, m, 0).getDate();
  const day = dayRule >= PAYMENT_DAY_LAST_OF_MONTH ? daysInM : Math.min(dayRule, daysInM);
  const candidate = `${y}-${pad(m)}-${pad(day)}`;
  const todayIso = today.toISOString().slice(0, 10);
  if (candidate >= todayIso) return candidate;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const daysInN = new Date(ny, nm, 0).getDate();
  const nd = dayRule >= PAYMENT_DAY_LAST_OF_MONTH ? daysInN : Math.min(dayRule, daysInN);
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

// Compute first_saving_date from a day-of-week rule (1=Mon … 7=Sun ISO 8601)
function firstSavingDateFromWeeklyRule(isoDay: number): string {
  const cur = new Date();
  // JS getDay(): 0=Sun, 1=Mon … 6=Sat. Convert ISO: 7=Sun->0, else same.
  const jsTarget = isoDay === 7 ? 0 : isoDay;
  const curDay = cur.getDay();
  let daysAhead = jsTarget - curDay;
  if (daysAhead < 0) daysAhead += 7;
  cur.setDate(cur.getDate() + daysAhead);
  return cur.toISOString().slice(0, 10);
}

function nextPaymentDateFromWeekdayRule(isoDay: number): string {
  return firstSavingDateFromWeeklyRule(isoDay);
}


/** Returns exact integer number of saving periods per one payment cycle, or null if not expressible as an integer. */
function getPeriodsPerCycle(paymentFreq: string, saveCadence: string): number | null {
  const MONTHS: Record<string, number> = {
    monthly: 1, every_2_months: 2, quarterly: 3,
    every_6_months: 6, yearly: 12, every_2_years: 24, every_3_years: 36,
  };
  const pm = MONTHS[paymentFreq];
  const sm = MONTHS[saveCadence];
  if (!pm || !sm || pm < sm) return null;
  const ratio = pm / sm;
  return Number.isInteger(ratio) ? ratio : null;
}

/** Unit label for saving cadence (singular). */
function savingCadenceUnit(cadence: string): string {
  if (cadence === "weekly" || cadence === "biweekly") return "week";
  if (cadence === "daily") return "day";
  return "month";
}

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
  // Contribution count: how many saving installments have already been set aside (for initial reservation on create).
  const [contributionCount, setContributionCount] = useState(0);

  // Whether the user wants preparation tracking
  const [preparationEnabled, setPreparationEnabled] = useState<boolean>(
    !!(existing?.saving_cadence || existing?.reserve_account_id)
  );

  // Day rule for the saving schedule: day-of-month (1-32) or day-of-week (1-7 ISO) or null
  const initialSavingDayRule = existing?.saving_day_rule ?? null;
  const [savingDayRule, setSavingDayRule] = useState<number | null>(initialSavingDayRule);

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
      paymentDayRule: existing?.payment_day_rule ?? null,
      savingDayRule: initialSavingDayRule,
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
  const paymentFrequency = watch("paymentFrequency");
  const reserveAccountId = watch("reserveAccountId");
  const autoPayEnabled = watch("autoPayEnabled");
  const amountMinorWatched = watch("amountMinor") as number | null | undefined;

  const hasSavingSchedule = !!savingCadence;
  const hasReserveAccount = !!reserveAccountId;

  // Auto-calculate saving amount: payment amount / periods per cycle (integer ceiling, no float).
  const periods = preparationEnabled && savingCadence
    ? getPeriodsPerCycle(paymentFrequency, savingCadence)
    : null;
  const autoSavingAmount = (periods && amountMinorWatched && amountMinorWatched > 0)
    ? Math.ceil(amountMinorWatched / periods)
    : null;

  useEffect(() => {
    if (autoSavingAmount != null) {
      setValue("savingAmountMinor", autoSavingAmount);
    }
  }, [autoSavingAmount, setValue]);

  const alreadyReservedMinor = !isEdit && autoSavingAmount != null
    ? Math.min(contributionCount * autoSavingAmount, amountMinorWatched ?? 0)
    : null;

  useEffect(() => {
    setValue("alreadyReservedMinor", alreadyReservedMinor ?? null);
  }, [alreadyReservedMinor, setValue]);

  // Payment date UI branches by frequency
  const paymentIsMonthly = paymentFrequency === "monthly";
  const paymentIsWeekly = paymentFrequency === "weekly" || paymentFrequency === "biweekly";
  const EXACT_DATE_FREQUENCIES = ["every_2_months", "quarterly", "every_6_months", "yearly", "every_2_years", "every_3_years", "daily"];
  const paymentIsExactRecurring = EXACT_DATE_FREQUENCIES.includes(paymentFrequency);
  const paymentIsOneTimeOrIrregular = paymentFrequency === "one_time" || paymentFrequency === "irregular";

  // Saving day rule needs a day-of-month picker for monthly, day-of-week for weekly/biweekly, or date for daily
  const savingNeedsMonthDay = savingCadence === "monthly";
  const savingNeedsWeekDay = savingCadence === "weekly" || savingCadence === "biweekly";
  const savingNeedsDate = savingCadence === "daily";

  function handlePreparationToggle(enabled: boolean) {
    setPreparationEnabled(enabled);
    if (!enabled) {
      setValue("savingCadence", null);
      setValue("savingAmountMinor", null);
      setValue("firstSavingDate", null);
      setValue("savingDayRule", null);
      setValue("reserveAccountId", null);
      setValue("alreadyReservedMinor", null);
      setValue("autoProtectEnabled", false);
      setSavingDayRule(null);
      setContributionCount(0);
    }
  }

  function handlePaymentFrequencyChange(freq: string, fieldOnChange: (v: string) => void) {
    fieldOnChange(freq);
    setValue("nextPaymentDate", "");
    setValue("paymentDayRule", null);
  }

  function handleSavingCadenceChange(cadence: string | null, fieldOnChange: (v: string | null) => void) {
    fieldOnChange(cadence || null);
    setSavingDayRule(null);
    setValue("savingDayRule", null);
    setValue("firstSavingDate", null);
    setValue("savingAmountMinor", null);
    setContributionCount(0);
  }

  function handleSavingDayRuleChange(rule: number, cadence: string) {
    setSavingDayRule(rule);
    setValue("savingDayRule", rule);
    let date: string;
    if (cadence === "monthly") {
      date = firstSavingDateFromMonthlyRule(rule);
    } else {
      date = firstSavingDateFromWeeklyRule(rule);
    }
    setValue("firstSavingDate", date);
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
        paymentDayRule: data.paymentDayRule ?? undefined,
        savingDayRule: (data as { savingDayRule?: number | null }).savingDayRule ?? undefined,
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
      setPreparationEnabled(false);
      setSavingDayRule(null);
      setContributionCount(0);
      setValue("savingDayRule", null);
      amountField.setDisplay("");
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
              : "Plan a future payment and optionally prepare for it ahead of time."}
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

          {/* Category */}
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <FormField id="c-category" label="Category" error={msg(errors.categoryId)}>
                <Select value={field.value ?? ""} onValueChange={(v) => field.onChange(v || "")}>
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
                <Select value={field.value} onValueChange={(v) => handlePaymentFrequencyChange(v, field.onChange)}>
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

          {/* Payment day - frequency-aware */}
          {paymentIsMonthly && (
            <Controller
              control={control}
              name="paymentDayRule"
              render={({ field }) => (
                <FormField
                  id="c-day-rule"
                  label="Which day is it due?"
                  hint="Spencare will schedule future payments on this day each month."
                  error={msg(errors.paymentDayRule)}
                >
                  <Select
                    value={field.value != null ? String(field.value) : ""}
                    onValueChange={(v) => {
                      const rule = v ? parseInt(v, 10) : null;
                      field.onChange(rule);
                      if (rule != null) {
                        setValue("nextPaymentDate", nextPaymentDateFromDayRule(rule));
                      }
                    }}
                  >
                    <SelectTrigger id="c-day-rule">
                      <SelectValue placeholder="Choose payment day" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_RULE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          )}

          {paymentIsWeekly && (
            <Controller
              control={control}
              name="paymentDayRule"
              render={({ field }) => (
                <FormField
                  id="c-payment-weekday"
                  label="Which day is it due?"
                  hint="Spencare will schedule future payments on this day each week."
                  error={msg(errors.paymentDayRule)}
                >
                  <Select
                    value={field.value != null ? String(field.value) : ""}
                    onValueChange={(v) => {
                      const rule = v ? parseInt(v, 10) : null;
                      field.onChange(rule);
                      if (rule != null) {
                        setValue("nextPaymentDate", nextPaymentDateFromWeekdayRule(rule));
                      }
                    }}
                  >
                    <SelectTrigger id="c-payment-weekday">
                      <SelectValue placeholder="Choose day of week" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OF_WEEK_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          )}

          {paymentIsExactRecurring && (
            <Controller
              control={control}
              name="nextPaymentDate"
              render={({ field }) => (
                <FormField
                  id="c-next-pay"
                  label="When is the next payment due?"
                  hint="This sets the anchor date. Spencare projects future payments from here."
                  error={msg(errors.nextPaymentDate)}
                >
                  <Input
                    id="c-next-pay"
                    type="date"
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const dateVal = e.target.value;
                      field.onChange(dateVal);
                      if (dateVal && dateVal.length === 10) {
                        setValue("paymentDayRule", parseInt(dateVal.slice(8, 10), 10));
                      }
                    }}
                    aria-invalid={!!errors.nextPaymentDate}
                    aria-describedby={errors.nextPaymentDate ? errorId("c-next-pay") : undefined}
                  />
                </FormField>
              )}
            />
          )}

          {paymentIsOneTimeOrIrregular && (
            <FormField id="c-next-pay" label="When is this payment due?" error={msg(errors.nextPaymentDate)}>
              <Input
                id="c-next-pay"
                type="date"
                aria-invalid={!!errors.nextPaymentDate}
                aria-describedby={errors.nextPaymentDate ? errorId("c-next-pay") : undefined}
                {...register("nextPaymentDate")}
              />
            </FormField>
          )}

          {/* Prepare for this payment? */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Prepare for this payment?</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={preparationEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => handlePreparationToggle(true)}
              >
                Yes, help me prepare
              </Button>
              <Button
                type="button"
                variant={!preparationEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => handlePreparationToggle(false)}
              >
                No, I&apos;ll handle it when due
              </Button>
            </div>

            {preparationEnabled && (
              <div className="rounded-lg border border-dashed border-border p-4 space-y-3">
                {/* Saving cadence */}
                <Controller
                  control={control}
                  name="savingCadence"
                  render={({ field }) => (
                    <FormField id="c-saving-cadence" label="How often should you set money aside?" error={msg(errors.savingCadence)}>
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) => handleSavingCadenceChange(v || null, field.onChange)}
                      >
                        <SelectTrigger id="c-saving-cadence">
                          <SelectValue placeholder="Choose frequency" />
                        </SelectTrigger>
                        <SelectContent>
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
                    {/* Saving amount - auto-calculated from payment amount / periods, shown read-only */}
                    {autoSavingAmount != null && amountMinorWatched ? (
                      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm space-y-0.5">
                        <p className="text-xs text-muted-foreground">Amount to set aside each time</p>
                        <p className="font-medium text-foreground">
                          {minorUnitsToDisplay(amountMinorWatched, CURRENCY)} over {periods} {savingCadenceUnit(savingCadence!)}s = {minorUnitsToDisplay(autoSavingAmount, CURRENCY)} per {savingCadenceUnit(savingCadence!)}
                        </p>
                      </div>
                    ) : (
                      <FormField id="c-saving-amt" label="How much should you set aside each time? (INR)" hint="Enter the payment amount above first." error={msg(errors.savingAmountMinor)}>
                        <Input
                          id="c-saving-amt"
                          inputMode="decimal"
                          placeholder="0"
                          disabled
                          value=""
                          readOnly
                        />
                      </FormField>
                    )}

                    {/* When to set it aside - day rule or start date */}
                    {savingNeedsMonthDay && (
                      <FormField
                        id="c-saving-day-month"
                        label="When should you set it aside?"
                        hint="Spencare will remind you on this day each month."
                        error={msg(errors.firstSavingDate)}
                      >
                        <Select
                          value={savingDayRule != null ? String(savingDayRule) : ""}
                          onValueChange={(v) => {
                            if (v) handleSavingDayRuleChange(parseInt(v, 10), savingCadence!);
                          }}
                        >
                          <SelectTrigger id="c-saving-day-month">
                            <SelectValue placeholder="Choose day of month" />
                          </SelectTrigger>
                          <SelectContent>
                            {DAY_RULE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    )}

                    {savingNeedsWeekDay && (
                      <FormField
                        id="c-saving-day-week"
                        label="When should you set it aside?"
                        hint="Spencare will remind you on this day each week."
                        error={msg(errors.firstSavingDate)}
                      >
                        <Select
                          value={savingDayRule != null ? String(savingDayRule) : ""}
                          onValueChange={(v) => {
                            if (v) handleSavingDayRuleChange(parseInt(v, 10), savingCadence!);
                          }}
                        >
                          <SelectTrigger id="c-saving-day-week">
                            <SelectValue placeholder="Choose day of week" />
                          </SelectTrigger>
                          <SelectContent>
                            {DAY_OF_WEEK_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    )}

                    {savingNeedsDate && (
                      <FormField id="c-first-save" label="When should you start?" error={msg(errors.firstSavingDate)}>
                        <Input
                          id="c-first-save"
                          type="date"
                          aria-invalid={!!errors.firstSavingDate}
                          aria-describedby={errors.firstSavingDate ? errorId("c-first-save") : undefined}
                          {...register("firstSavingDate")}
                        />
                      </FormField>
                    )}
                  </>
                )}

                {/* Protection account */}
                <Controller
                  control={control}
                  name="reserveAccountId"
                  render={({ field }) => (
                    <FormField
                      id="c-reserve-account"
                      label="Where do you want to set money aside?"
                      hint="Choose a bank or cash account to hold this money. Credit cards are not allowed."
                      error={msg(errors.reserveAccountId)}
                    >
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) => {
                          field.onChange(v || null);
                          if (!v) {
                            setValue("alreadyReservedMinor", null);
                            setContributionCount(0);
                          }
                        }}
                      >
                        <SelectTrigger id="c-reserve-account">
                          <SelectValue placeholder="I&apos;ll decide later" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">I&apos;ll decide later</SelectItem>
                          {reserveAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />

                {/* Already protected - contribution count selector (create only) */}
                {hasReserveAccount && !isEdit && autoSavingAmount != null && periods != null && (
                  <FormField
                    id="c-already-reserved"
                    label="How many installments have you already set aside?"
                    hint="No transaction is created. This just marks money as already protected."
                  >
                    <Select
                      value={String(contributionCount)}
                      onValueChange={(v) => setContributionCount(Number(v))}
                    >
                      <SelectTrigger id="c-already-reserved">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: periods + 1 }, (_, i) => {
                          const amount = Math.min(i * autoSavingAmount, amountMinorWatched ?? 0);
                          return (
                            <SelectItem key={i} value={String(i)}>
                              {i === 0
                                ? "None yet"
                                : `${i} ${savingCadenceUnit(savingCadence!)}${i === 1 ? "" : "s"} protected (${minorUnitsToDisplay(amount, CURRENCY)})`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              </div>
            )}
          </div>

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

          {/* Automatically track payments */}
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
                <Label htmlFor="c-autopay" className="text-sm font-medium">Automatically track payments</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Spencare will look for a matching transaction and automatically record this payment in your account on the scheduled date. It does not make a real bank payment.
                </p>
              </div>
            </div>

            {autoPayEnabled && (
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
                      onValueChange={(v) => field.onChange(v || null)}
                    >
                      <SelectTrigger id="c-payment-account">
                        <SelectValue placeholder="Choose payment account" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              />
            )}
          </div>

          {/* Automatically set aside money - only when preparation is enabled with a schedule */}
          {preparationEnabled && hasSavingSchedule && (
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
                  <Label htmlFor="c-autoprotect" className="text-sm font-medium">Automatically record protection on schedule</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Spencare will mark each installment as protected on the scheduled date. You still move the money yourself. No bank transfer is made.
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

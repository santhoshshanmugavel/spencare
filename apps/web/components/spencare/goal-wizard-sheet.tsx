"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createGoalSchema, createGoalContributionPlanSchema, type CreateGoalInput } from "@spencare/validation";
import {
  calculateGoalProgress,
  suggestContributionAmount,
  calculateNextOccurrence,
  FREQUENCY_LABELS,
} from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import { GOAL_CONTRIBUTION_FREQUENCIES, type GoalContributionFrequencyInput } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toastError, toastConfirmed } from "@/lib/toast";
import { parseMoneyInput } from "@/lib/money-input";
import { createGoalAction, createGoalContributionPlanAction } from "@/app/goals/actions";
import { cn } from "@/lib/utils";

/**
 * Goal creation sheet.
 *
 * Design: "Create with Spensa AI" button + "Or" divider + standard form fields
 * on the same screen — matching the product reference (Goal create 2.pdf).
 * This is NOT a progressive wizard. All questions are immediately visible;
 * conditional fields reveal when Yes is selected.
 *
 * Financial correctness:
 * - "Existing savings" sets initialSavedAmountMinor. No debit, no transaction.
 * - Contribution plan is a REMINDER SCHEDULE. No automatic money movement.
 * - Credit cards are excluded from account selectors via fundingEligibleAccounts.
 */

type Frequency = GoalContributionFrequencyInput;

interface FormState {
  name: string;
  targetDisplay: string;
  targetMinor: number;
  term: "short" | "long";
  hasSavings: "yes" | "no" | null;
  savingsDisplay: string;
  savingsMinor: number;
  savingsAccountId: string;
  targetDate: string;
  hasRecurring: "yes" | "no" | null;
  frequency: Frequency;
  anchorDay: number;
  fundingAccountId: string;
  amountDisplay: string;
  amountMinorOverride: number | null; // null = use suggested
}

function initialState(): FormState {
  return {
    name: "",
    targetDisplay: "",
    targetMinor: 0,
    term: "short",
    hasSavings: null,
    savingsDisplay: "",
    savingsMinor: 0,
    savingsAccountId: "",
    targetDate: "",
    hasRecurring: null,
    frequency: "monthly",
    anchorDay: 1,
    fundingAccountId: "",
    amountDisplay: "",
    amountMinorOverride: null,
  };
}

function parseMinor(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return 0;
  const { minor } = parseMoneyInput(cleaned, "INR");
  return minor;
}

export function GoalWizardSheet({
  open,
  onOpenChange,
  onCreated,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  accounts: AccountRow[];
}) {
  const formId = useId();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = useMemo(() => new Date(), []);

  // Three future date suggestions generated from current date
  const dateSuggestions = useMemo(() => {
    const offsets = [6, 12, 18];
    return offsets.map((months) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, 1));
      return {
        iso: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }),
      };
    });
  }, [today]);

  function reset() {
    setForm(initialState());
    setIsSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSpensaAI() {
    onOpenChange(false);
    router.push("/spensa/new?intent=create_goal");
  }

  // Derived plan values
  const existingSavingsMinor = form.hasSavings === "yes" ? form.savingsMinor : 0;

  const progress = form.targetMinor > 0 && form.targetDate
    ? calculateGoalProgress(form.targetMinor, existingSavingsMinor, form.targetDate, today)
    : null;

  const suggestedMinor = form.hasRecurring === "yes" && form.targetMinor > 0 && form.targetDate
    ? suggestContributionAmount(form.targetMinor, existingSavingsMinor, form.targetDate, form.frequency)
    : null;

  const effectiveAmountMinor = form.amountMinorOverride ?? suggestedMinor ?? 0;

  const nextContribution = form.hasRecurring === "yes"
    ? calculateNextOccurrence(form.frequency, form.anchorDay || null, null)
    : null;

  const showAnchorDay = form.frequency !== "daily";

  // Validation: minimum required to enable Create Goal
  const canCreate = form.name.trim().length > 0 && form.targetMinor > 0;

  // Validate for create (show which optional sections are incomplete)
  const recurringRequiresFunding =
    form.hasRecurring === "yes" && !form.fundingAccountId && accounts.length > 0;

  async function handleCreate() {
    if (!canCreate || isSubmitting) return;
    setIsSubmitting(true);

    const fundingId = form.hasRecurring === "yes" && form.fundingAccountId
      ? form.fundingAccountId
      : (accounts[0]?.id ?? "");

    const goalInput: CreateGoalInput = createGoalSchema.parse({
      name: form.name.trim(),
      targetAmountMinor: form.targetMinor,
      targetDate: form.targetDate || null,
      fundingAccountId: fundingId,
      term: form.term,
      initialSavedAmountMinor: existingSavingsMinor,
    });

    const goalResult = await createGoalAction(goalInput);
    if (!goalResult.ok) {
      toastError(goalResult.error.message);
      setIsSubmitting(false);
      return;
    }

    if (form.hasRecurring === "yes" && effectiveAmountMinor > 0 && !recurringRequiresFunding) {
      const planInput = createGoalContributionPlanSchema.parse({
        goalId: goalResult.value.id,
        frequency: form.frequency,
        amountMinor: effectiveAmountMinor,
        anchorDay: showAnchorDay ? form.anchorDay : null,
        timezone: "Asia/Kolkata",
        startDate: today.toISOString().slice(0, 10),
      });
      const planResult = await createGoalContributionPlanAction(planInput);
      if (!planResult.ok) {
        toastError(planResult.error.message);
        setIsSubmitting(false);
        return;
      }
    }

    toastConfirmed(
      form.name.trim() ? `"${form.name.trim()}" goal is ready!` : "Goal created!",
    );
    setIsSubmitting(false);
    reset();
    onCreated();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-border/50 px-5 py-4">
          <SheetTitle>Create Goal</SheetTitle>
          <SheetDescription className="sr-only">
            Create a new savings goal with a contribution plan.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-5 space-y-6">

            {/* ── Spensa AI entry ── */}
            <div className="text-center space-y-3">
              <p className="text-sm font-medium text-foreground">
                Create your goal with Spensa AI
              </p>
              <Button
                type="button"
                onClick={handleSpensaAI}
                className="inline-flex items-center gap-2 rounded-full px-5"
                size="default"
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Create with Spensa AI
              </Button>
            </div>

            {/* ── Or divider ── */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border/60" />
              <span>Or</span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

            {/* ── Manual form ── */}
            <div className="space-y-5">

              {/* Goal name */}
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-name`}>Goal name</Label>
                <Input
                  id={`${formId}-name`}
                  placeholder="Eg: Emergency fund, Trip, or something else"
                  value={form.name}
                  maxLength={120}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>

              {/* Term */}
              <div className="space-y-1.5">
                <Label>Goal type</Label>
                <div className="flex gap-2">
                  <PillToggle
                    active={form.term === "short"}
                    onClick={() => setForm((s) => ({ ...s, term: "short" }))}
                  >
                    Short term
                  </PillToggle>
                  <PillToggle
                    active={form.term === "long"}
                    onClick={() => setForm((s) => ({ ...s, term: "long" }))}
                  >
                    Long term
                  </PillToggle>
                </div>
              </div>

              {/* Target amount */}
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-target`}>
                  How much would you like to save?
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                    ₹
                  </span>
                  <Input
                    id={`${formId}-target`}
                    className="pl-7"
                    inputMode="decimal"
                    placeholder="Enter amount"
                    value={form.targetDisplay}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9.]/g, "");
                      setForm((s) => ({
                        ...s,
                        targetDisplay: raw,
                        targetMinor: parseMinor(raw),
                        amountMinorOverride: null,
                        amountDisplay: "",
                      }));
                    }}
                  />
                </div>
              </div>

              {/* Existing savings */}
              <div className="space-y-2 rounded-lg border border-border/50 p-3.5">
                <p className="text-sm font-medium text-foreground">
                  Do you already have some savings for this?
                </p>
                <RadioGroup
                  value={form.hasSavings ?? ""}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      hasSavings: v as "yes" | "no",
                      savingsMinor: v === "no" ? 0 : s.savingsMinor,
                      savingsDisplay: v === "no" ? "" : s.savingsDisplay,
                    }))
                  }
                  className="flex gap-5"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="yes" id={`${formId}-savings-yes`} />
                    <Label htmlFor={`${formId}-savings-yes`} className="font-normal cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="no" id={`${formId}-savings-no`} />
                    <Label htmlFor={`${formId}-savings-no`} className="font-normal cursor-pointer">No</Label>
                  </div>
                </RadioGroup>

                {form.hasSavings === "yes" && (
                  <div className="mt-3 space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${formId}-savings-amt`}>
                        How much have you already saved?
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                          ₹
                        </span>
                        <Input
                          id={`${formId}-savings-amt`}
                          className="pl-7"
                          inputMode="decimal"
                          placeholder="e.g. 20,000"
                          value={form.savingsDisplay}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                            setForm((s) => ({
                              ...s,
                              savingsDisplay: raw,
                              savingsMinor: parseMinor(raw),
                            }));
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${formId}-savings-acct`}>
                        Where is that money currently kept?
                      </Label>
                      {accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No accounts yet.{" "}
                          <Link href="/settings/accounts" className="text-primary hover:underline">
                            Add an account
                          </Link>
                        </p>
                      ) : (
                        <AccountSelect
                          id={`${formId}-savings-acct`}
                          accounts={accounts}
                          value={form.savingsAccountId}
                          onChange={(id) => setForm((s) => ({ ...s, savingsAccountId: id }))}
                          placeholder="Choose account"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Target date */}
              <div className="space-y-2">
                <Label>When is your target date?</Label>
                <div className="flex flex-wrap gap-2">
                  {dateSuggestions.map((d) => (
                    <PillToggle
                      key={d.iso}
                      active={form.targetDate === d.iso}
                      onClick={() => setForm((s) => ({ ...s, targetDate: d.iso }))}
                    >
                      {d.label}
                    </PillToggle>
                  ))}
                  <PillToggle
                    active={
                      !!form.targetDate &&
                      !dateSuggestions.find((d) => d.iso === form.targetDate)
                    }
                    onClick={() => document.getElementById(`${formId}-date`)?.focus()}
                  >
                    Enter my own
                  </PillToggle>
                </div>
                <Input
                  id={`${formId}-date`}
                  type="date"
                  value={form.targetDate}
                  min={today.toISOString().slice(0, 10)}
                  onChange={(e) => setForm((s) => ({ ...s, targetDate: e.target.value }))}
                  aria-label="Custom target date"
                />
                {progress && progress.monthsLeft !== null && (
                  <p className="text-xs text-muted-foreground">
                    {progress.monthsLeft} month{progress.monthsLeft === 1 ? "" : "s"} to go
                    {progress.remainingMinor > 0
                      ? ` · ₹${(progress.remainingMinor / 100).toLocaleString("en-IN")} remaining`
                      : " · Goal already reached with your savings"}
                  </p>
                )}
              </div>

              {/* Recurring */}
              <div className="space-y-2 rounded-lg border border-border/50 p-3.5">
                <p className="text-sm font-medium text-foreground">
                  Are you planning to save regularly?
                </p>
                <RadioGroup
                  value={form.hasRecurring ?? ""}
                  onValueChange={(v) =>
                    setForm((s) => ({
                      ...s,
                      hasRecurring: v as "yes" | "no",
                      amountMinorOverride: null,
                      amountDisplay: "",
                    }))
                  }
                  className="flex gap-5"
                >
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="yes" id={`${formId}-rec-yes`} />
                    <Label htmlFor={`${formId}-rec-yes`} className="font-normal cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RadioGroupItem value="no" id={`${formId}-rec-no`} />
                    <Label htmlFor={`${formId}-rec-no`} className="font-normal cursor-pointer">
                      No, I&apos;ll top up whenever I want
                    </Label>
                  </div>
                </RadioGroup>

                {form.hasRecurring === "yes" && (
                  <div className="mt-3 space-y-3 pt-1">
                    {/* Frequency */}
                    <div className="space-y-1.5">
                      <Label htmlFor={`${formId}-freq`}>How often?</Label>
                      <Select
                        value={form.frequency}
                        onValueChange={(v) =>
                          setForm((s) => ({
                            ...s,
                            frequency: v as Frequency,
                            anchorDay: 1,
                            amountMinorOverride: null,
                            amountDisplay: "",
                          }))
                        }
                      >
                        <SelectTrigger id={`${formId}-freq`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GOAL_CONTRIBUTION_FREQUENCIES.map((f) => (
                            <SelectItem key={f} value={f}>
                              {FREQUENCY_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Anchor day */}
                    {showAnchorDay && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`${formId}-anchor`}>
                          {form.frequency === "weekly" ? "Day of week" : "Contribution day"}
                        </Label>
                        {form.frequency === "weekly" ? (
                          <Select
                            value={String(form.anchorDay)}
                            onValueChange={(v) =>
                              setForm((s) => ({ ...s, anchorDay: Number(v) }))
                            }
                          >
                            <SelectTrigger id={`${formId}-anchor`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
                                (d, i) => (
                                  <SelectItem key={i + 1} value={String(i + 1)}>
                                    {d}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={String(form.anchorDay)}
                            onValueChange={(v) =>
                              setForm((s) => ({ ...s, anchorDay: Number(v) }))
                            }
                          >
                            <SelectTrigger id={`${formId}-anchor`}>
                              <SelectValue placeholder="Day" />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 2, 5, 10, 15, 20, 25].map((d) => (
                                <SelectItem key={d} value={String(d)}>
                                  {d === 1 ? "1st" : d === 2 ? "2nd" : d === 5 ? "5th" : `${d}th`}
                                </SelectItem>
                              ))}
                              <SelectItem value="28">28th</SelectItem>
                              <SelectItem value="29">29th (last day in Feb)</SelectItem>
                              <SelectItem value="30">30th (last day in short months)</SelectItem>
                              <SelectItem value="31">Last day of month</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}

                    {/* Amount — recommended with user override */}
                    <div className="space-y-1.5">
                      <Label htmlFor={`${formId}-amount`}>
                        How much to save each time?
                      </Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                          ₹
                        </span>
                        <Input
                          id={`${formId}-amount`}
                          className="pl-7"
                          inputMode="decimal"
                          placeholder={
                            suggestedMinor
                              ? `Recommended: ${(suggestedMinor / 100).toLocaleString("en-IN")}`
                              : "Enter amount"
                          }
                          value={form.amountDisplay}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                            const minor = parseMinor(raw);
                            setForm((s) => ({
                              ...s,
                              amountDisplay: raw,
                              amountMinorOverride: raw ? minor : null,
                            }));
                          }}
                        />
                      </div>
                      {suggestedMinor && !form.amountMinorOverride ? (
                        <p className="text-xs text-muted-foreground">
                          Recommended{" "}
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={() => {
                              setForm((s) => ({
                                ...s,
                                amountDisplay: (suggestedMinor / 100).toLocaleString("en-IN"),
                                amountMinorOverride: suggestedMinor,
                              }));
                            }}
                          >
                            ₹{(suggestedMinor / 100).toLocaleString("en-IN")}
                          </button>{" "}
                          to reach your goal on time
                        </p>
                      ) : null}
                    </div>

                    {/* Funding account */}
                    <div className="space-y-1.5">
                      <Label htmlFor={`${formId}-funding`}>Which account for this goal?</Label>
                      {accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No accounts yet.{" "}
                          <Link href="/settings/accounts" className="text-primary hover:underline">
                            Add an account
                          </Link>
                        </p>
                      ) : (
                        <AccountSelect
                          id={`${formId}-funding`}
                          accounts={accounts}
                          value={form.fundingAccountId}
                          onChange={(id) => setForm((s) => ({ ...s, fundingAccountId: id }))}
                          placeholder="Choose account"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Plan summary banner */}
              {form.targetMinor > 0 && form.targetDate && form.hasRecurring === "yes" && effectiveAmountMinor > 0 && (
                <div className="rounded-lg bg-primary/6 border border-primary/15 px-4 py-3 text-sm">
                  <p className="text-foreground">
                    Save{" "}
                    <span className="font-semibold">
                      ₹{(effectiveAmountMinor / 100).toLocaleString("en-IN")}
                    </span>
                    {" "}/{" "}{FREQUENCY_LABELS[form.frequency].toLowerCase()}
                    {progress?.monthsLeft ? ` for ${progress.monthsLeft} months` : ""}
                    {" "}to reach your goal
                  </p>
                  {nextContribution && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Next:{" "}
                      {nextContribution.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Reminder only — Spencare won&apos;t move money automatically.
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── Sticky footer ── */}
        <SheetFooter className="shrink-0 flex-row gap-2 border-t border-border/50 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={handleCreate}
            disabled={!canCreate || isSubmitting}
          >
            {isSubmitting ? "Creating…" : "Create goal"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ── Small helpers ── */

function PillToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/70 bg-background text-foreground/80 hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function AccountSelect({
  id,
  accounts,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  accounts: AccountRow[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

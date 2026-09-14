"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createGoalSchema, createGoalContributionPlanSchema, type CreateGoalInput } from "@spencare/validation";
import { Money as DomainMoney, calculateGoalProgress, suggestContributionAmount, calculateNextOccurrence, FREQUENCY_LABELS } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import { GOAL_CONTRIBUTION_FREQUENCIES, type GoalContributionFrequencyInput } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Money } from "@/components/spencare/money";
import { toastError, toastConfirmed } from "@/lib/toast";
import { parseMoneyInput, minorUnitsToDisplay } from "@/lib/money-input";
import { createGoalAction, createGoalContributionPlanAction } from "@/app/goals/actions";
import { cn } from "@/lib/utils";

/**
 * Goal creation sheet — structured progressive form.
 *
 * Design: sections appear as the user fills in earlier fields (progressive
 * disclosure). NOT a chatbot questionnaire. Feels like Account Creation.
 *
 * Financial correctness: "existing savings" writes to saved_amount_minor at
 * creation (initialSavedAmountMinor). It does NOT call addContribution or
 * debit the funding account — that money already exists in the account.
 * The recurring plan is a REMINDER SCHEDULE only; no automatic transfers occur.
 */

type Frequency = GoalContributionFrequencyInput;

interface FormState {
  name: string;
  targetDisplay: string;
  targetMinor: number;
  hasSavings: boolean | null;
  savingsDisplay: string;
  savingsMinor: number;
  savingsAccountId: string;
  targetDate: string;
  hasRecurring: boolean | null;
  frequency: Frequency;
  anchorDay: number;
  fundingAccountId: string;
}

function initialState(): FormState {
  return {
    name: "",
    targetDisplay: "",
    targetMinor: 0,
    hasSavings: null,
    savingsDisplay: "",
    savingsMinor: 0,
    savingsAccountId: "",
    targetDate: "",
    hasRecurring: null,
    frequency: "monthly",
    anchorDay: 1,
    fundingAccountId: "",
  };
}

function useMoneyField(initial = "") {
  const [display, setDisplay] = useState(initial);
  function parse(raw: string): number {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    if (!cleaned || cleaned === ".") return 0;
    const { minor } = parseMoneyInput(cleaned, "INR");
    return minor;
  }
  return { display, setDisplay, parse };
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
  const [form, setForm] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const targetField = useMoneyField();
  const savingsField = useMoneyField();

  const today = useMemo(() => new Date(), []);
  const dateSuggestions = useMemo(() => {
    const offsets = [6, 12, 18];
    return offsets.map((months) => {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, 1));
      const iso = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
      return { iso, label };
    });
  }, [today]);

  function reset() {
    setForm(initialState());
    targetField.setDisplay("");
    savingsField.setDisplay("");
    setIsSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  // Derived: which sections are visible
  const basicsComplete = form.name.trim().length > 0 && form.targetMinor > 0;
  const savingsComplete = form.hasSavings !== null && (
    form.hasSavings === false ||
    (form.savingsMinor >= 0 && !!form.savingsAccountId)
  );
  const dateComplete = !!form.targetDate;
  const recurringComplete = form.hasRecurring !== null && (
    form.hasRecurring === false ||
    !!form.fundingAccountId
  );
  const allComplete = basicsComplete && savingsComplete && dateComplete && recurringComplete;

  // Plan calculation
  const progress = form.targetMinor && form.targetDate
    ? calculateGoalProgress(form.targetMinor, form.hasSavings ? form.savingsMinor : 0, form.targetDate, today)
    : null;

  const suggestedContribution = form.hasRecurring && form.frequency && form.targetMinor && form.targetDate
    ? suggestContributionAmount(form.targetMinor, form.hasSavings ? form.savingsMinor : 0, form.targetDate, form.frequency)
    : null;

  const nextContribution = form.hasRecurring && form.frequency
    ? calculateNextOccurrence(form.frequency, form.anchorDay || null, null)
    : null;

  // Anchor day label and options
  const anchorDayLabel = form.frequency === "weekly" ? "Day of week" : "Day of month";
  const showAnchorDay = form.frequency !== "daily";

  async function handleCreate() {
    if (!allComplete) return;
    setIsSubmitting(true);

    const goalInput: CreateGoalInput = createGoalSchema.parse({
      name: form.name.trim(),
      targetAmountMinor: form.targetMinor,
      targetDate: form.targetDate,
      fundingAccountId: form.hasRecurring ? form.fundingAccountId : (accounts[0]?.id ?? ""),
      term: "medium",
      initialSavedAmountMinor: form.hasSavings ? form.savingsMinor : 0,
    });

    const goalResult = await createGoalAction(goalInput);
    if (!goalResult.ok) {
      toastError(goalResult.error.message);
      setIsSubmitting(false);
      return;
    }

    const goalId = goalResult.value.id;

    if (form.hasRecurring && suggestedContribution) {
      const planInput = createGoalContributionPlanSchema.parse({
        goalId,
        frequency: form.frequency,
        amountMinor: suggestedContribution,
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

    toastConfirmed("Goal created!");
    setIsSubmitting(false);
    reset();
    onCreated();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-border/60 px-4 py-3">
          <SheetTitle>New Goal</SheetTitle>
          <SheetDescription>Set up a savings goal and optional contribution reminder.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-0 overflow-y-auto">
          {/* Section 1: Basics — always visible */}
          <Section title="Goal details">
            <div className="space-y-4">
              <Field label="Goal name" id={`${formId}-name`} required>
                <Input
                  id={`${formId}-name`}
                  placeholder="e.g. Emergency Fund, Bali Trip…"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  autoFocus
                />
              </Field>
              <Field label="Target amount (₹)" id={`${formId}-target`} required>
                <Input
                  id={`${formId}-target`}
                  inputMode="decimal"
                  placeholder="e.g. 200000"
                  value={targetField.display}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                    targetField.setDisplay(cleaned);
                    setForm((s) => ({ ...s, targetMinor: targetField.parse(cleaned) }));
                  }}
                />
              </Field>
            </div>
          </Section>

          {/* Section 2: Existing savings */}
          {basicsComplete && (
            <Section title="Existing savings">
              <p className="mb-3 text-sm text-muted-foreground">Do you already have some savings for this goal?</p>
              <div className="flex gap-2">
                <ToggleChip active={form.hasSavings === false} onClick={() => setForm((s) => ({ ...s, hasSavings: false, savingsMinor: 0 }))}>
                  No, starting fresh
                </ToggleChip>
                <ToggleChip active={form.hasSavings === true} onClick={() => setForm((s) => ({ ...s, hasSavings: true }))}>
                  Yes, I have some saved
                </ToggleChip>
              </div>
              {form.hasSavings === true && (
                <div className="mt-4 space-y-4">
                  <Field label="Already saved (₹)" id={`${formId}-savings`} required>
                    <Input
                      id={`${formId}-savings`}
                      inputMode="decimal"
                      placeholder="e.g. 50000"
                      value={savingsField.display}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                        savingsField.setDisplay(cleaned);
                        setForm((s) => ({ ...s, savingsMinor: savingsField.parse(cleaned) }));
                      }}
                    />
                  </Field>
                  <Field label="Where is this money?" id={`${formId}-savings-account`} required>
                    <AccountSelect
                      id={`${formId}-savings-account`}
                      accounts={accounts}
                      value={form.savingsAccountId}
                      onChange={(id) => setForm((s) => ({ ...s, savingsAccountId: id }))}
                      placeholder="Choose account"
                    />
                  </Field>
                </div>
              )}
            </Section>
          )}

          {/* Section 3: Target date */}
          {basicsComplete && savingsComplete && (
            <Section title="Target date">
              <p className="mb-3 text-sm text-muted-foreground">When would you like to reach this goal?</p>
              <div className="flex flex-wrap gap-2">
                {dateSuggestions.map((d) => (
                  <ToggleChip
                    key={d.iso}
                    active={form.targetDate === d.iso}
                    onClick={() => setForm((s) => ({ ...s, targetDate: d.iso }))}
                  >
                    {d.label}
                  </ToggleChip>
                ))}
                <ToggleChip
                  active={!!form.targetDate && !dateSuggestions.find((d) => d.iso === form.targetDate)}
                  onClick={() => {
                    // Trigger native date input focus below
                    document.getElementById(`${formId}-date`)?.focus();
                  }}
                >
                  Custom date
                </ToggleChip>
              </div>
              <Input
                id={`${formId}-date`}
                type="date"
                className="mt-3"
                value={form.targetDate}
                min={today.toISOString().slice(0, 10)}
                onChange={(e) => setForm((s) => ({ ...s, targetDate: e.target.value }))}
                aria-label="Custom target date"
              />
              {progress && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {progress.monthsLeft !== null ? `${progress.monthsLeft} months to go` : ""}
                  {progress.remainingMinor > 0 ? ` · ₹${(progress.remainingMinor / 100).toLocaleString("en-IN")} remaining` : " · Goal reached!"}
                </p>
              )}
            </Section>
          )}

          {/* Section 4: Recurring contribution */}
          {basicsComplete && savingsComplete && dateComplete && (
            <Section title="Contribution reminder">
              <p className="mb-3 text-sm text-muted-foreground">
                Would you like to set up a recurring reminder to save?
              </p>
              <div className="flex gap-2">
                <ToggleChip active={form.hasRecurring === false} onClick={() => setForm((s) => ({ ...s, hasRecurring: false }))}>
                  I&apos;ll add money myself
                </ToggleChip>
                <ToggleChip active={form.hasRecurring === true} onClick={() => setForm((s) => ({ ...s, hasRecurring: true }))}>
                  Yes, help me plan
                </ToggleChip>
              </div>

              {form.hasRecurring === true && (
                <div className="mt-4 space-y-4">
                  <Field label="Saving frequency" id={`${formId}-freq`} required>
                    <Select
                      value={form.frequency}
                      onValueChange={(v) => setForm((s) => ({ ...s, frequency: v as Frequency, anchorDay: 1 }))}
                    >
                      <SelectTrigger id={`${formId}-freq`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GOAL_CONTRIBUTION_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {showAnchorDay && (
                    <Field label={anchorDayLabel} id={`${formId}-anchor`} required>
                      {form.frequency === "weekly" ? (
                        <Select
                          value={String(form.anchorDay)}
                          onValueChange={(v) => setForm((s) => ({ ...s, anchorDay: Number(v) }))}
                        >
                          <SelectTrigger id={`${formId}-anchor`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => (
                              <SelectItem key={i + 1} value={String(i + 1)}>{d}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select
                          value={String(form.anchorDay)}
                          onValueChange={(v) => setForm((s) => ({ ...s, anchorDay: Number(v) }))}
                        >
                          <SelectTrigger id={`${formId}-anchor`}>
                            <SelectValue placeholder="Day" />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                              <SelectItem key={d} value={String(d)}>
                                {d}{d === 29 || d === 30 || d === 31 ? " (uses last day if shorter month)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  )}

                  <Field label="Funding account" id={`${formId}-funding`} required>
                    {accounts.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground">
                        No accounts yet.{" "}
                        <Link href="/settings/accounts" className="text-primary underline-offset-4 hover:underline">
                          Add an account
                        </Link>
                      </div>
                    ) : (
                      <AccountSelect
                        id={`${formId}-funding`}
                        accounts={accounts}
                        value={form.fundingAccountId}
                        onChange={(id) => setForm((s) => ({ ...s, fundingAccountId: id }))}
                        placeholder="Which account to save from?"
                      />
                    )}
                  </Field>

                  {/* Plan preview */}
                  {suggestedContribution !== null && suggestedContribution > 0 && nextContribution && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        Save{" "}
                        <Money value={DomainMoney.fromNumber(suggestedContribution, "INR")} />{" "}
                        {FREQUENCY_LABELS[form.frequency].toLowerCase()}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        Next: {nextContribution.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        This is a reminder plan — Spencare won&apos;t move money automatically. You&apos;ll record each contribution when you&apos;re ready.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Section 5: Summary + Create */}
          {allComplete && (
            <Section title="Ready to create">
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                <SummaryRow label="Goal">{form.name}</SummaryRow>
                <SummaryRow label="Target">
                  <Money value={DomainMoney.fromNumber(form.targetMinor, "INR")} />
                </SummaryRow>
                {form.hasSavings && form.savingsMinor > 0 && (
                  <SummaryRow label="Already saved">
                    <Money value={DomainMoney.fromNumber(form.savingsMinor, "INR")} />
                  </SummaryRow>
                )}
                {form.targetDate && (
                  <SummaryRow label="Target date">
                    {new Date(`${form.targetDate}T00:00:00Z`).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
                    })}
                  </SummaryRow>
                )}
                {form.hasRecurring && suggestedContribution ? (
                  <>
                    <SummaryRow label={`Contribution (${FREQUENCY_LABELS[form.frequency].toLowerCase()})`}>
                      <Money value={DomainMoney.fromNumber(suggestedContribution, "INR")} />
                    </SummaryRow>
                    {nextContribution && (
                      <SummaryRow label="Next reminder">
                        {nextContribution.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </SummaryRow>
                    )}
                  </>
                ) : (
                  <SummaryRow label="Contribution plan">Manual — add money when ready</SummaryRow>
                )}
              </div>

              {form.hasRecurring && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reminder plan only — Spencare will never move money automatically.
                </p>
              )}

              <Button
                className="mt-4 w-full"
                size="lg"
                onClick={handleCreate}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating…" : "Create Goal"}
              </Button>
            </Section>
          )}

          {/* Spacer */}
          <div className="h-6" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Helpers ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/40 px-4 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, id, required, children }: { label: string; id: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/80 bg-background text-foreground/80 hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
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
          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}

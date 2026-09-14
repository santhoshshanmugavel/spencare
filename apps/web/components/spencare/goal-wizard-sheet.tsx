"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Target, AlertTriangle, ChevronRight } from "lucide-react";
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
import { parseMoneyInput } from "@/lib/money-input";
import { createGoalAction, createGoalContributionPlanAction } from "@/app/goals/actions";
import { cn } from "@/lib/utils";

/**
 * Goal creation sheet.
 *
 * Entry screen: user picks "Spensa AI" (navigates to /spensa/new with goal
 * creation intent) or "Create manually" (structured progressive form).
 *
 * Manual form follows progressive disclosure: sections appear as previous
 * ones are completed. The recurring contribution plan is a REMINDER SCHEDULE
 * only — no automatic money movement occurs.
 *
 * Financial correctness:
 * - "Existing savings" writes to saved_amount_minor at creation. It does NOT
 *   call addContribution or debit the account — that money already exists.
 * - The contribution plan is a PLANNING + REMINDER system, not a transfer.
 */

type Frequency = GoalContributionFrequencyInput;
type Mode = null | "spensa" | "manual";
type Term = "short" | "long";

interface FormState {
  name: string;
  targetDisplay: string;
  targetMinor: number;
  term: Term;
  hasSavings: boolean | null;
  savingsDisplay: string;
  savingsMinor: number;
  savingsAccountId: string;
  targetDate: string;
  hasRecurring: boolean | null;
  frequency: Frequency;
  anchorDay: number;
  fundingAccountId: string;
  recurringAmountDisplay: string;
  recurringAmountMinor: number | null; // null = use suggested
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
    recurringAmountDisplay: "",
    recurringAmountMinor: null,
  };
}

function parseAmount(raw: string): number {
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
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState<FormState>(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const today = useMemo(() => new Date(), []);

  // Three future date shortcuts relative to today
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
    setMode(null);
    setForm(initialState());
    setIsSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSpensaAI() {
    onOpenChange(false);
    // Navigate to Spensa new conversation with goal creation intent.
    // The ?intent=create_goal param pre-seeds a starter message so Spensa
    // opens in goal-creation mode immediately.
    router.push("/spensa/new?intent=create_goal");
  }

  // Section visibility — progressive disclosure
  const basicsComplete = form.name.trim().length > 0 && form.targetMinor > 0;
  const savingsComplete =
    form.hasSavings !== null &&
    (form.hasSavings === false || (form.savingsMinor > 0 && !!form.savingsAccountId));
  const dateComplete = !!form.targetDate;
  const recurringComplete =
    form.hasRecurring !== null &&
    (form.hasRecurring === false || !!form.fundingAccountId);
  const allComplete = basicsComplete && savingsComplete && dateComplete && recurringComplete;

  // Deterministic plan calculation
  const progress =
    form.targetMinor && form.targetDate
      ? calculateGoalProgress(
          form.targetMinor,
          form.hasSavings ? form.savingsMinor : 0,
          form.targetDate,
          today,
        )
      : null;

  const suggestedMinor =
    form.hasRecurring && form.frequency && form.targetMinor && form.targetDate
      ? suggestContributionAmount(
          form.targetMinor,
          form.hasSavings ? form.savingsMinor : 0,
          form.targetDate,
          form.frequency,
        )
      : null;

  // User can override; fall back to suggested if blank
  const effectiveAmountMinor = form.recurringAmountMinor ?? suggestedMinor ?? 0;

  const nextContribution =
    form.hasRecurring && form.frequency
      ? calculateNextOccurrence(form.frequency, form.anchorDay || null, null)
      : null;

  const showAnchorDay = form.frequency !== "daily";

  // Warn when target date is very close
  const challengingTimeline = progress && progress.monthsLeft !== null && progress.monthsLeft <= 2;

  async function handleCreate() {
    if (!allComplete || isSubmitting) return;
    setIsSubmitting(true);

    const goalInput: CreateGoalInput = createGoalSchema.parse({
      name: form.name.trim(),
      targetAmountMinor: form.targetMinor,
      targetDate: form.targetDate,
      fundingAccountId: form.hasRecurring
        ? form.fundingAccountId
        : (accounts[0]?.id ?? ""),
      term: form.term,
      initialSavedAmountMinor: form.hasSavings ? form.savingsMinor : 0,
    });

    const goalResult = await createGoalAction(goalInput);
    if (!goalResult.ok) {
      toastError(goalResult.error.message);
      setIsSubmitting(false);
      return;
    }

    const goalId = goalResult.value.id;

    if (form.hasRecurring && effectiveAmountMinor > 0) {
      const planInput = createGoalContributionPlanSchema.parse({
        goalId,
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
      form.name.trim()
        ? `"${form.name.trim()}" goal is ready!`
        : "Goal created!",
    );
    setIsSubmitting(false);
    reset();
    onCreated();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-border/60 px-4 py-3">
          <SheetTitle>Create Goal</SheetTitle>
          <SheetDescription>
            {mode === "manual"
              ? "Fill in your goal details and an optional contribution plan."
              : "Choose how you'd like to set up your savings goal."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* ── Entry screen ── */}
          {mode === null && (
            <div className="space-y-4 p-4">
              {/* Spensa AI option */}
              <button
                type="button"
                onClick={handleSpensaAI}
                className="flex w-full items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/10"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Sparkles className="size-5 text-primary" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">Create with Spensa AI</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Have a conversation. Tell Spensa what you're saving for — it'll
                    help you plan the goal, amount, and timeline.
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border/60" />
                <span>or</span>
                <span className="h-px flex-1 bg-border/60" />
              </div>

              {/* Manual option */}
              <button
                type="button"
                onClick={() => setMode("manual")}
                className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-background p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Target className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">Fill in manually</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Use a structured form to enter your goal name, amount, date, and
                    contribution plan.
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* ── Manual form ── */}
          {mode === "manual" && (
            <div className="space-y-0">
              {/* Section 1 — Basics */}
              <Section title="Goal details">
                {/* Term toggle */}
                <div className="mb-4">
                  <p className="mb-2 text-sm text-muted-foreground">Goal type</p>
                  <div className="flex gap-2">
                    <ToggleChip
                      active={form.term === "short"}
                      onClick={() => setForm((s) => ({ ...s, term: "short" }))}
                    >
                      Short term
                    </ToggleChip>
                    <ToggleChip
                      active={form.term === "long"}
                      onClick={() => setForm((s) => ({ ...s, term: "long" }))}
                    >
                      Long term
                    </ToggleChip>
                  </div>
                </div>

                <div className="space-y-4">
                  <Field
                    label="What are you saving for?"
                    id={`${formId}-name`}
                    required
                  >
                    <Input
                      id={`${formId}-name`}
                      placeholder="Emergency fund, Vietnam trip, new bike…"
                      value={form.name}
                      maxLength={120}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, name: e.target.value }))
                      }
                      autoFocus
                    />
                  </Field>

                  <Field
                    label="How much would you like to save? (₹)"
                    id={`${formId}-target`}
                    required
                  >
                    <Input
                      id={`${formId}-target`}
                      inputMode="decimal"
                      placeholder="e.g. 1,50,000"
                      value={form.targetDisplay}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9.]/g, "");
                        setForm((s) => ({
                          ...s,
                          targetDisplay: raw,
                          targetMinor: parseAmount(raw),
                        }));
                      }}
                    />
                  </Field>
                </div>
              </Section>

              {/* Section 2 — Existing savings */}
              {basicsComplete && (
                <Section title="Existing savings">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Do you already have some savings for this goal?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ToggleChip
                      active={form.hasSavings === false}
                      onClick={() =>
                        setForm((s) => ({
                          ...s,
                          hasSavings: false,
                          savingsMinor: 0,
                          savingsDisplay: "",
                        }))
                      }
                    >
                      No, starting fresh
                    </ToggleChip>
                    <ToggleChip
                      active={form.hasSavings === true}
                      onClick={() =>
                        setForm((s) => ({ ...s, hasSavings: true }))
                      }
                    >
                      Yes, I&apos;ve saved some
                    </ToggleChip>
                  </div>

                  {form.hasSavings === true && (
                    <div className="mt-4 space-y-4">
                      <Field
                        label="How much have you already saved? (₹)"
                        id={`${formId}-savings`}
                        required
                      >
                        <Input
                          id={`${formId}-savings`}
                          inputMode="decimal"
                          placeholder="e.g. 20,000"
                          value={form.savingsDisplay}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                            setForm((s) => ({
                              ...s,
                              savingsDisplay: raw,
                              savingsMinor: parseAmount(raw),
                            }));
                          }}
                        />
                      </Field>
                      <Field
                        label="Where is this money kept?"
                        id={`${formId}-savings-account`}
                        required
                      >
                        <AccountSelect
                          id={`${formId}-savings-account`}
                          accounts={accounts}
                          value={form.savingsAccountId}
                          onChange={(id) =>
                            setForm((s) => ({ ...s, savingsAccountId: id }))
                          }
                          placeholder="Choose account"
                        />
                      </Field>
                    </div>
                  )}
                </Section>
              )}

              {/* Section 3 — Target date */}
              {basicsComplete && savingsComplete && (
                <Section title="Target date">
                  <p className="mb-3 text-sm text-muted-foreground">
                    When would you like to reach this goal?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {dateSuggestions.map((d) => (
                      <ToggleChip
                        key={d.iso}
                        active={form.targetDate === d.iso}
                        onClick={() =>
                          setForm((s) => ({ ...s, targetDate: d.iso }))
                        }
                      >
                        {d.label}
                      </ToggleChip>
                    ))}
                    <ToggleChip
                      active={
                        !!form.targetDate &&
                        !dateSuggestions.find((d) => d.iso === form.targetDate)
                      }
                      onClick={() =>
                        document.getElementById(`${formId}-date`)?.focus()
                      }
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
                    onChange={(e) =>
                      setForm((s) => ({ ...s, targetDate: e.target.value }))
                    }
                    aria-label="Custom target date"
                  />
                  {progress && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {progress.monthsLeft !== null
                        ? `${progress.monthsLeft} month${progress.monthsLeft === 1 ? "" : "s"} to go`
                        : ""}
                      {progress.remainingMinor > 0
                        ? ` · ₹${(progress.remainingMinor / 100).toLocaleString("en-IN")} remaining`
                        : " · Goal already reached!"}
                    </p>
                  )}
                  {challengingTimeline && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        That&apos;s a tight timeline — your monthly contribution
                        will be high. Consider extending the date if needed.
                      </span>
                    </div>
                  )}
                </Section>
              )}

              {/* Section 4 — Contribution plan */}
              {basicsComplete && savingsComplete && dateComplete && (
                <Section title="Contribution plan">
                  <p className="mb-3 text-sm text-muted-foreground">
                    Would you like to set up a recurring reminder to save?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ToggleChip
                      active={form.hasRecurring === false}
                      onClick={() =>
                        setForm((s) => ({ ...s, hasRecurring: false }))
                      }
                    >
                      I&apos;ll add money myself
                    </ToggleChip>
                    <ToggleChip
                      active={form.hasRecurring === true}
                      onClick={() =>
                        setForm((s) => ({ ...s, hasRecurring: true }))
                      }
                    >
                      Yes, help me plan
                    </ToggleChip>
                  </div>

                  {form.hasRecurring === true && (
                    <div className="mt-4 space-y-4">
                      <Field
                        label="Saving frequency"
                        id={`${formId}-freq`}
                        required
                      >
                        <Select
                          value={form.frequency}
                          onValueChange={(v) =>
                            setForm((s) => ({
                              ...s,
                              frequency: v as Frequency,
                              anchorDay: 1,
                              recurringAmountMinor: null,
                              recurringAmountDisplay: "",
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
                      </Field>

                      {showAnchorDay && (
                        <Field
                          label={
                            form.frequency === "weekly"
                              ? "Day of week"
                              : "Contribution day"
                          }
                          id={`${formId}-anchor`}
                          required
                        >
                          {form.frequency === "weekly" ? (
                            <Select
                              value={String(form.anchorDay)}
                              onValueChange={(v) =>
                                setForm((s) => ({
                                  ...s,
                                  anchorDay: Number(v),
                                }))
                              }
                            >
                              <SelectTrigger id={`${formId}-anchor`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[
                                  "Monday",
                                  "Tuesday",
                                  "Wednesday",
                                  "Thursday",
                                  "Friday",
                                  "Saturday",
                                  "Sunday",
                                ].map((d, i) => (
                                  <SelectItem key={i + 1} value={String(i + 1)}>
                                    {d}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select
                              value={String(form.anchorDay)}
                              onValueChange={(v) =>
                                setForm((s) => ({
                                  ...s,
                                  anchorDay: Number(v),
                                }))
                              }
                            >
                              <SelectTrigger id={`${formId}-anchor`}>
                                <SelectValue placeholder="Day" />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 28 }, (_, i) => i + 1).map(
                                  (d) => (
                                    <SelectItem key={d} value={String(d)}>
                                      {d}
                                      {d === 28 ? " (or last day)" : ""}
                                    </SelectItem>
                                  ),
                                )}
                                <SelectItem value="29">
                                  29 (last day in Feb)
                                </SelectItem>
                                <SelectItem value="30">
                                  30 (last day in short months)
                                </SelectItem>
                                <SelectItem value="31">
                                  31 (last day when applicable)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </Field>
                      )}

                      <Field
                        label="Funding account"
                        id={`${formId}-funding`}
                        required
                      >
                        {accounts.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground">
                            No accounts yet.{" "}
                            <Link
                              href="/settings/accounts"
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              Add an account
                            </Link>
                          </div>
                        ) : (
                          <AccountSelect
                            id={`${formId}-funding`}
                            accounts={accounts}
                            value={form.fundingAccountId}
                            onChange={(id) =>
                              setForm((s) => ({ ...s, fundingAccountId: id }))
                            }
                            placeholder="Which account to save from?"
                          />
                        )}
                      </Field>

                      {/* Contribution amount — user can override the suggested amount */}
                      <Field
                        label={`How much to save each time? (₹)`}
                        id={`${formId}-amount`}
                      >
                        <div className="space-y-1">
                          <Input
                            id={`${formId}-amount`}
                            inputMode="decimal"
                            placeholder={
                              suggestedMinor
                                ? `Suggested: ₹${(suggestedMinor / 100).toLocaleString("en-IN")}`
                                : "Amount"
                            }
                            value={form.recurringAmountDisplay}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9.]/g, "");
                              const minor = parseAmount(raw);
                              setForm((s) => ({
                                ...s,
                                recurringAmountDisplay: raw,
                                recurringAmountMinor: raw ? minor : null,
                              }));
                            }}
                          />
                          {suggestedMinor && !form.recurringAmountMinor && (
                            <p className="text-xs text-muted-foreground">
                              Suggested:{" "}
                              <button
                                type="button"
                                className="text-primary underline-offset-4 hover:underline"
                                onClick={() => {
                                  const display = (suggestedMinor / 100).toLocaleString("en-IN");
                                  setForm((s) => ({
                                    ...s,
                                    recurringAmountDisplay: display,
                                    recurringAmountMinor: suggestedMinor,
                                  }));
                                }}
                              >
                                ₹{(suggestedMinor / 100).toLocaleString("en-IN")}
                              </button>{" "}
                              to reach your goal on time
                            </p>
                          )}
                        </div>
                      </Field>
                    </div>
                  )}
                </Section>
              )}

              {/* Section 5 — Plan preview + Create */}
              {allComplete && (
                <Section title="Your savings plan">
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
                    <SummaryRow label="Goal">{form.name}</SummaryRow>
                    <SummaryRow label="Target">
                      <Money value={DomainMoney.fromNumber(form.targetMinor, "INR")} />
                    </SummaryRow>
                    {form.hasSavings && form.savingsMinor > 0 && (
                      <>
                        <SummaryRow label="Already saved">
                          <Money value={DomainMoney.fromNumber(form.savingsMinor, "INR")} />
                        </SummaryRow>
                        {progress && (
                          <SummaryRow label="Remaining">
                            <Money value={DomainMoney.fromNumber(progress.remainingMinor, "INR")} />
                          </SummaryRow>
                        )}
                      </>
                    )}
                    {form.targetDate && (
                      <SummaryRow label="Target date">
                        {new Date(`${form.targetDate}T00:00:00Z`).toLocaleDateString(
                          "en-IN",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "UTC",
                          },
                        )}
                      </SummaryRow>
                    )}
                    {form.hasRecurring && effectiveAmountMinor > 0 ? (
                      <>
                        <SummaryRow
                          label={`Saving (${FREQUENCY_LABELS[form.frequency].toLowerCase()})`}
                        >
                          <Money value={DomainMoney.fromNumber(effectiveAmountMinor, "INR")} />
                        </SummaryRow>
                        {nextContribution && (
                          <SummaryRow label="Next contribution">
                            {nextContribution.toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </SummaryRow>
                        )}
                        {form.fundingAccountId &&
                          accounts.find((a) => a.id === form.fundingAccountId) && (
                            <SummaryRow label="Funding account">
                              {accounts.find((a) => a.id === form.fundingAccountId)!.name}
                            </SummaryRow>
                          )}
                      </>
                    ) : (
                      <SummaryRow label="Contribution plan">
                        Manual — add money when ready
                      </SummaryRow>
                    )}
                  </div>

                  {form.hasRecurring && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      This is a reminder plan. Spencare will never move money
                      automatically — you record each contribution when you&apos;re
                      ready.
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

                  <Button
                    variant="ghost"
                    className="mt-2 w-full"
                    size="sm"
                    onClick={() => setMode(null)}
                    disabled={isSubmitting}
                  >
                    Start over
                  </Button>
                </Section>
              )}

              <div className="h-6" />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Small layout helpers ── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/40 px-4 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  id,
  required,
  children,
}: {
  label: string;
  id: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}

function ToggleChip({
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
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}

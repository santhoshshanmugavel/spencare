"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { createGoalSchema, type CreateGoalInput } from "@spencare/validation";
import { Money as DomainMoney } from "@spencare/domain-core";
import { calculateGoalProgress } from "@spencare/domain-core";
import type { AccountRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Money } from "@/components/spencare/money";
import { toastError } from "@/lib/toast";
import {
  DEFAULT_GOAL_NAME,
  EXISTING_SAVINGS_CHIPS_MINOR,
  estimateGoalCost,
  suggestTargetDates,
  GOAL_CATEGORY_LABELS,
  type GoalCategory,
  type TripBand,
} from "@/lib/goal-wizard";
import { parseMoneyInput } from "@/lib/money-input";
import { createGoalAction } from "@/app/goals/actions";

/**
 * `<GoalWizardSheet>` — Phase 33 §10/§21's conversational Spensa goal
 * creation flow, replacing the plain multi-field form the codebase's own
 * comment history (`add-goal-sheet.tsx`, now removed) admitted was a
 * placeholder: "no non-AI form exists anywhere [in the source]." Re-read
 * directly from `Goal Creation.pdf`/`Goal Creation-1.pdf` this phase (NOT
 * assumed from a prior phase's report) — those two screens, not among the
 * 10 originally supplied this engagement, contain the actual designed
 * conversation this component reproduces question-for-question:
 * category -> (trip: destination band) -> name -> tiered cost estimate ->
 * existing savings -> target date -> funding account (or a "connect an
 * account" branch when none exist) -> summary -> create.
 *
 * See `@/lib/goal-wizard.ts`'s header comment for why this is a
 * deterministic decision tree, not a live call to the Spensa AI provider,
 * and for the disclosed scoping decisions (no free-text NLU parsing of a
 * typed destination; hedged, non-personalized cost tiers).
 *
 * Financial correctness note: "existing savings" is written directly to
 * `goals.saved_amount_minor` at creation (`initialSavedAmountMinor`, new
 * this phase) rather than through `addContribution` — that RPC debits the
 * funding account's real balance, which would be wrong here: this step
 * describes money already sitting in the account, not a new transfer into
 * it. See the schema/repo/command comments for the full reasoning.
 *
 * Values entered here are intentionally NEVER Privacy-Mode-masked (same
 * as every other create/edit form in the product, e.g. `AddExpenseSheet`)
 * — masking a number the user is actively choosing, in the same
 * conversation, back to themselves has no product purpose; Privacy Mode
 * masks the DISPLAY of already-committed data elsewhere in the app.
 */

type StepId = "category" | "tripBand" | "name" | "amount" | "savings" | "date" | "account" | "noAccount" | "summary" | "done";

interface Exchange {
  id: string;
  spensaText: string;
  userAnswer?: string;
}

interface WizardData {
  category?: GoalCategory;
  tripBand?: TripBand;
  name?: string;
  amountMinor?: number;
  savingsMinor?: number;
  targetDate?: string;
  targetDateLabel?: string;
  accountId?: string;
  accountName?: string;
}

function initialGoalWizardState() {
  return {
    step: "category" as StepId,
    history: [] as Exchange[],
    data: {} as WizardData,
  };
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
  const [{ step, history, data }, setState] = useState(initialGoalWizardState);
  const [customOpen, setCustomOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const composerId = useId();
  const today = useMemo(() => new Date(), []);
  const dateSuggestions = useMemo(() => suggestTargetDates(today), [today]);

  function reset() {
    setState(initialGoalWizardState());
    setCustomOpen(false);
    setIsSubmitting(false);
  }

  function pushExchange(userAnswer: string, nextStep: StepId, patch: Partial<WizardData>) {
    setState((s) => ({
      step: nextStep,
      history: [...s.history, { id: `${s.history.length}`, spensaText: currentPrompt(s.step, s.data), userAnswer }],
      data: { ...s.data, ...patch },
    }));
    setCustomOpen(false);
  }

  function currentPrompt(s: StepId, d: WizardData): string {
    switch (s) {
      case "category":
        return "What are you saving for?";
      case "tripBand":
        return "Nice. Where are you planning to go?";
      case "name":
        return d.category === "trip" ? "What should we call this trip?" : "What would you like to call this goal?";
      case "amount":
        return estimateGoalCost(d.category ?? "other", d.tripBand).hint;
      case "savings":
        return "Do you already have some savings for this?";
      case "date": {
        const prefix = d.savingsMinor === 0 ? "No worries — we'll start from zero and build it step by step. " : "Got it. ";
        return `${prefix}When are you planning to reach this goal?`;
      }
      case "account":
        return "Where should we save money for this goal?";
      case "noAccount":
        return `Almost there — connect a bank or cash account to start saving for ${d.name ?? "this goal"}.`;
      case "summary":
        return "Here's the plan:";
      case "done":
        return "";
    }
  }

  function selectCategory(category: GoalCategory) {
    const label = GOAL_CATEGORY_LABELS[category];
    if (category === "trip") {
      pushExchange(label, "tripBand", { category });
      return;
    }
    if (category === "emergency") {
      pushExchange(label, "amount", { category, name: DEFAULT_GOAL_NAME.emergency });
      return;
    }
    pushExchange(label, "name", { category });
  }

  function selectTripBand(band: TripBand, label: string) {
    pushExchange(label, "name", { tripBand: band });
  }

  function submitName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    pushExchange(trimmed, "amount", { name: trimmed });
  }

  function selectAmount(amountMinor: number, label: string) {
    pushExchange(label, "savings", { amountMinor });
  }

  function selectSavings(savingsMinor: number, label: string) {
    pushExchange(label, "date", { savingsMinor });
  }

  function selectDate(iso: string, label: string) {
    const nextStep: StepId = accounts.length === 0 ? "noAccount" : "account";
    pushExchange(label, nextStep, { targetDate: iso, targetDateLabel: label });
  }

  function selectAccount(account: AccountRow) {
    pushExchange(account.name, "summary", {
      accountId: account.id,
      accountName: account.name,
    });
  }

  function adjustPlan() {
    // Jump back to the amount step without discarding the earlier
    // category/name answers — "Adjust Plan" revises the money side of the
    // plan (amount, savings, date, account: always exactly the last 4
    // exchanges before "summary", regardless of category) rather than the
    // whole conversation.
    setState((s) => ({
      ...s,
      step: "amount",
      history: s.history.slice(0, -4),
      data: { ...s.data, amountMinor: undefined, savingsMinor: undefined, targetDate: undefined, targetDateLabel: undefined, accountId: undefined, accountName: undefined },
    }));
  }

  async function handleCreate() {
    if (!data.category || !data.name || !data.amountMinor || !data.targetDate || !data.accountId) return;
    setIsSubmitting(true);
    const input: CreateGoalInput = createGoalSchema.parse({
      name: data.name,
      targetAmountMinor: data.amountMinor,
      targetDate: data.targetDate,
      fundingAccountId: data.accountId,
      term: "short",
      initialSavedAmountMinor: data.savingsMinor ?? 0,
    });
    const result = await createGoalAction(input);
    setIsSubmitting(false);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    setState((s) => ({ ...s, step: "done" }));
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const progress =
    data.amountMinor && data.targetDate
      ? calculateGoalProgress(data.amountMinor, data.savingsMinor ?? 0, data.targetDate, today)
      : null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/60">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Create a goal with Spensa
          </SheetTitle>
          <SheetDescription>Answer a few quick questions and Spensa will set up the plan.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label="Goal creation conversation">
          {history.map((ex) => (
            <div key={ex.id} className="space-y-2">
              <SpensaBubble text={ex.spensaText} />
              {ex.userAnswer ? <UserBubble text={ex.userAnswer} /> : null}
            </div>
          ))}

          {step !== "done" ? <SpensaBubble text={currentPrompt(step, data)} /> : null}

          {step === "category" ? (
            <ChipRow>
              {(["emergency", "trip", "vehicle", "other"] as const).map((c) => (
                <Chip key={c} onClick={() => selectCategory(c)}>
                  {GOAL_CATEGORY_LABELS[c]}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "tripBand" ? (
            <ChipRow>
              <Chip onClick={() => selectTripBand("international", "International")}>International</Chip>
              <Chip onClick={() => selectTripBand("domestic", "Domestic")}>Domestic</Chip>
              <Chip onClick={() => selectTripBand("domestic", "Something else")}>Something else</Chip>
            </ChipRow>
          ) : null}

          {step === "name" ? (
            <CustomEntry
              id={`${composerId}-name`}
              label="Goal name"
              placeholder={data.category === "trip" ? "Eg: Vietnam Trip" : data.category === "vehicle" ? "Eg: Royal Enfield" : "Eg: Wedding Fund"}
              type="text"
              actionLabel="Continue"
              onSubmit={submitName}
              alwaysOpen
            />
          ) : null}

          {step === "amount" ? (
            <>
              <ChipRow>
                {estimateGoalCost(data.category ?? "other", data.tripBand).tiersMinor.map((minor, i) => (
                  <Chip key={minor} onClick={() => selectAmount(minor, estimateGoalCost(data.category ?? "other", data.tripBand).tierLabels[i])}>
                    {estimateGoalCost(data.category ?? "other", data.tripBand).tierLabels[i]}
                  </Chip>
                ))}
                <Chip onClick={() => setCustomOpen(true)} variant="ghost">
                  Enter my own
                </Chip>
              </ChipRow>
              {customOpen ? (
                <CustomEntry
                  id={`${composerId}-amount`}
                  label="Target amount (INR ₹)"
                  placeholder="100000"
                  type="money"
                  actionLabel="Use this amount"
                  onSubmit={(v) => {
                    const { minor, error } = parseMoneyInput(v, "INR");
                    if (error || minor <= 0) return;
                    selectAmount(minor, `₹${Number(v).toLocaleString("en-IN")}`);
                  }}
                />
              ) : null}
            </>
          ) : null}

          {step === "savings" ? (
            <>
              <ChipRow>
                {EXISTING_SAVINGS_CHIPS_MINOR.map((minor) => (
                  <Chip key={minor} onClick={() => selectSavings(minor, minor === 0 ? "₹0" : `₹${(minor / 100).toLocaleString("en-IN")}`)}>
                    {minor === 0 ? "₹0" : `₹${(minor / 100).toLocaleString("en-IN")}`}
                  </Chip>
                ))}
                <Chip onClick={() => setCustomOpen(true)} variant="ghost">
                  Enter my own
                </Chip>
              </ChipRow>
              {customOpen ? (
                <CustomEntry
                  id={`${composerId}-savings`}
                  label="Already saved (INR ₹)"
                  placeholder="0"
                  type="money"
                  actionLabel="Use this amount"
                  onSubmit={(v) => {
                    const { minor, error } = parseMoneyInput(v, "INR");
                    if (error || minor < 0) return;
                    selectSavings(minor, `₹${Number(v).toLocaleString("en-IN")}`);
                  }}
                />
              ) : null}
            </>
          ) : null}

          {step === "date" ? (
            <>
              <ChipRow>
                {dateSuggestions.map((d) => (
                  <Chip key={d.iso} onClick={() => selectDate(d.iso, d.label)}>
                    {d.label}
                  </Chip>
                ))}
                <Chip onClick={() => setCustomOpen(true)} variant="ghost">
                  Enter my own
                </Chip>
              </ChipRow>
              {customOpen ? (
                <CustomEntry
                  id={`${composerId}-date`}
                  label="Target date"
                  type="date"
                  actionLabel="Use this date"
                  onSubmit={(v) => {
                    if (!v) return;
                    const label = new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
                    selectDate(v, label);
                  }}
                />
              ) : null}
            </>
          ) : null}

          {step === "account" ? (
            <ChipRow>
              {accounts.map((a) => (
                <Chip key={a.id} onClick={() => selectAccount(a)}>
                  {a.name}
                </Chip>
              ))}
            </ChipRow>
          ) : null}

          {step === "noAccount" ? (
            <Button asChild size="touch" className="w-full">
              <Link href="/settings/accounts">Setup account</Link>
            </Button>
          ) : null}

          {step === "summary" ? (
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-base font-semibold text-foreground">{data.name}</p>
                <SummaryRow label="Target">
                  <Money value={DomainMoney.fromNumber(data.amountMinor ?? 0, "INR")} />
                </SummaryRow>
                <SummaryRow label="Already saved">
                  <Money value={DomainMoney.fromNumber(data.savingsMinor ?? 0, "INR")} />
                </SummaryRow>
                <SummaryRow label="Target date">{data.targetDateLabel}</SummaryRow>
                <SummaryRow label="Funding account">{data.accountName}</SummaryRow>
                {progress?.suggestedMonthlyContributionMinor ? (
                  <p className="pt-1 text-sm text-muted-foreground">
                    Saving <Money value={DomainMoney.fromNumber(progress.suggestedMonthlyContributionMinor, "INR")} />
                    /month from {data.accountName} will get you there.
                  </p>
                ) : null}
                <div className="flex gap-2 pt-2">
                  <Button size="touch" className="flex-1" onClick={handleCreate} disabled={isSubmitting}>
                    {isSubmitting ? "Creating…" : "Create Goal"}
                  </Button>
                  <Button size="touch" variant="outline" onClick={adjustPlan} disabled={isSubmitting}>
                    Adjust Plan
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === "done" ? (
            <div className="space-y-3">
              <SpensaBubble
                text={
                  progress?.suggestedMonthlyContributionMinor
                    ? `Your ${data.name} goal is ready! Saving ₹${(progress.suggestedMonthlyContributionMinor / 100).toLocaleString("en-IN")}/month will get you there by ${data.targetDateLabel}.`
                    : `Your ${data.name} goal is ready!`
                }
              />
              <Button
                size="touch"
                className="w-full"
                onClick={() => {
                  onCreated();
                  reset();
                }}
              >
                View goal
              </Button>
            </div>
          ) : null}
        </div>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}

function SpensaBubble({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="flex items-start gap-2">
      <Sparkles className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="whitespace-pre-wrap text-sm text-foreground">{text}</p>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <span className="max-w-[80%] rounded-2xl bg-primary px-3 py-1.5 text-sm text-primary-foreground">{text}</span>
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 pl-6">{children}</div>;
}

function Chip({ children, onClick, variant = "outline" }: { children: React.ReactNode; onClick: () => void; variant?: "outline" | "ghost" }) {
  return (
    <Button type="button" size="sm" variant={variant} className="rounded-full" onClick={onClick}>
      {children}
    </Button>
  );
}

function CustomEntry({
  id,
  label,
  placeholder,
  type,
  actionLabel,
  onSubmit,
  alwaysOpen,
}: {
  id: string;
  label: string;
  placeholder?: string;
  type: "text" | "money" | "date";
  actionLabel: string;
  onSubmit: (value: string) => void;
  alwaysOpen?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="ml-6 flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="flex-1 space-y-1">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <Input
          id={id}
          type={type === "date" ? "date" : type === "money" ? "text" : "text"}
          inputMode={type === "money" ? "decimal" : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={alwaysOpen}
        />
      </div>
      <Button type="submit" size="sm">
        {actionLabel}
      </Button>
    </form>
  );
}

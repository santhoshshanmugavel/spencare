"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CATEGORY_INTERESTS,
  GOAL_TYPE_INTERESTS,
  INCOME_FREQUENCIES,
  completeOnboardingSchema,
  type CompleteOnboardingInput,
  type IncomeFrequency,
} from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastError } from "@/lib/toast";
import { signOutAction } from "../(auth)/actions";
import { completeOnboardingAction, saveOnboardingStepAction } from "./actions";

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];
const STEP_LABELS = ["About you", "Income", "Spending", "Goals"] as const;
const TOTAL_STEPS = STEP_LABELS.length;

export interface OnboardingInitialValues {
  displayName: string;
  preferredCurrency: string;
  incomeAmountMinor: number | null;
  incomeFrequency: string | null;
  interestedCategories: string[];
  interestedGoalTypes: string[];
}

function ChipToggle({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="touch"
      aria-pressed={selected}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}

export function OnboardingWizard({ initial }: { initial: OnboardingInitialValues }) {
  const [step, setStep] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CompleteOnboardingInput>({
    resolver: zodResolver(completeOnboardingSchema),
    defaultValues: {
      displayName: initial.displayName,
      preferredCurrency: initial.preferredCurrency || "INR",
      incomeAmountMinor: initial.incomeAmountMinor,
      incomeFrequency: (initial.incomeFrequency as IncomeFrequency | null) ?? null,
      // `initial.*` comes back from the database as plain string[] --
      // narrow to the fixed, still-valid option set (also defensively
      // drops any stale value from a since-changed option list).
      interestedCategories: initial.interestedCategories.filter(
        (c): c is (typeof CATEGORY_INTERESTS)[number] =>
          (CATEGORY_INTERESTS as readonly string[]).includes(c),
      ),
      interestedGoalTypes: initial.interestedGoalTypes.filter(
        (g): g is (typeof GOAL_TYPE_INTERESTS)[number] =>
          (GOAL_TYPE_INTERESTS as readonly string[]).includes(g),
      ),
    },
  });

  const interestedCategories = watch("interestedCategories") ?? [];
  const interestedGoalTypes = watch("interestedGoalTypes") ?? [];

  function toggleCategory(name: (typeof CATEGORY_INTERESTS)[number]) {
    const current: (typeof CATEGORY_INTERESTS)[number][] = interestedCategories;
    setValue(
      "interestedCategories",
      current.includes(name) ? current.filter((c) => c !== name) : [...current, name],
    );
  }

  function toggleGoalType(name: (typeof GOAL_TYPE_INTERESTS)[number]) {
    const current: (typeof GOAL_TYPE_INTERESTS)[number][] = interestedGoalTypes;
    setValue(
      "interestedGoalTypes",
      current.includes(name) ? current.filter((g) => g !== name) : [...current, name],
    );
  }

  async function persistStepAndAdvance() {
    setServerError(null);
    if (step === 0) {
      const displayName = watch("displayName");
      const preferredCurrency = watch("preferredCurrency");
      const parsed = completeOnboardingSchema.shape.displayName.safeParse(displayName);
      if (!parsed.success) {
        setServerError(parsed.error.issues[0]?.message ?? "Enter your name.");
        return;
      }
      const result = await saveOnboardingStepAction({ displayName, preferredCurrency });
      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }
    } else if (step === 1) {
      const rupees = watch("incomeAmountMinor");
      const incomeFrequency = watch("incomeFrequency");
      const result = await saveOnboardingStepAction({
        incomeAmountMinor: rupees ?? null,
        incomeFrequency: incomeFrequency ?? null,
      });
      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }
    } else if (step === 2) {
      const result = await saveOnboardingStepAction({ interestedCategories });
      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function skipStep() {
    setServerError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  async function finish(data: CompleteOnboardingInput) {
    setServerError(null);
    const result = await completeOnboardingAction({ ...data, interestedGoalTypes });
    if (!result.ok) {
      setServerError(result.error.message);
      toastError(result.error.message);
      return;
    }
    setIsFinishing(true);
    // A hard navigation, not router.push: this is a real state-boundary
    // transition (onboarding just completed), and the client router's
    // soft-navigation cache can serve a stale RSC payload for a route
    // segment visited earlier in the session (observed live during this
    // phase's testing -- router.push silently no-op'd, no request ever
    // left the browser). A full navigation guarantees /home is rendered
    // from the just-written, fresh server state. The short delay lets the
    // branded interstitial (SP-005) actually be seen, not just flash.
    setTimeout(() => {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate: see comment above. router.push() was tried first and verified live to silently no-op here.
      window.location.href = "/home";
    }, 900);
  }

  if (isFinishing) {
    return (
      <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <div
          className="size-10 animate-spin rounded-full border-4 border-primary border-t-transparent"
          aria-hidden="true"
        />
        <p role="status" aria-live="polite" className="text-lg font-medium text-foreground">
          Setting up your personalized experience…
        </p>
        <p className="text-sm text-muted-foreground">
          Your financial data stays private and encrypted.
        </p>
      </div>
    );
  }

  const progressValue = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">Spencare</span>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      <div className="space-y-2">
        <Progress value={progressValue} aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`} />
        <p className="text-xs text-muted-foreground">
          Step {step + 1} of {TOTAL_STEPS}: {STEP_LABELS[step]}
        </p>
      </div>

      <form onSubmit={handleSubmit(finish)} noValidate>
        <Card>
          {step === 0 ? (
            <>
              <CardHeader>
                <CardTitle className="text-xl">Welcome to Spencare</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField id="displayName" label="What should we call you?" error={errors.displayName?.message}>
                  <Input
                    id="displayName"
                    autoComplete="name"
                    aria-invalid={!!errors.displayName}
                    aria-describedby={errors.displayName ? errorId("displayName") : undefined}
                    {...register("displayName")}
                  />
                </FormField>
                <FormField id="preferredCurrency" label="Preferred currency" error={errors.preferredCurrency?.message}>
                  <Controller
                    control={control}
                    name="preferredCurrency"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="preferredCurrency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              </CardContent>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <CardHeader>
                <CardTitle className="text-xl">What&apos;s your income like?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This helps personalize Spencare. It&apos;s just a starting signal, not tracked
                  as a transaction, and you can skip this.
                </p>
                <FormField id="incomeAmountMinor" label="Approximate income" error={errors.incomeAmountMinor?.message}>
                  <Controller
                    control={control}
                    name="incomeAmountMinor"
                    render={({ field }) => (
                      <Input
                        id="incomeAmountMinor"
                        inputMode="numeric"
                        placeholder="50000"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          field.onChange(raw === "" ? null : Number(raw) * 100);
                        }}
                      />
                    )}
                  />
                </FormField>
                <FormField id="incomeFrequency" label="How often?" error={errors.incomeFrequency?.message}>
                  <Controller
                    control={control}
                    name="incomeFrequency"
                    render={({ field }) => (
                      <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                        <SelectTrigger id="incomeFrequency">
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          {INCOME_FREQUENCIES.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f[0]!.toUpperCase() + f.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </FormField>
              </CardContent>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <CardHeader>
                <CardTitle className="text-xl">What do you spend on most?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pick as many as you like -- or skip this.
                </p>
                <div role="group" aria-label="Spending categories" className="flex flex-wrap gap-2">
                  {CATEGORY_INTERESTS.map((c) => (
                    <ChipToggle
                      key={c}
                      label={c}
                      selected={interestedCategories.includes(c)}
                      onToggle={() => toggleCategory(c)}
                    />
                  ))}
                </div>
              </CardContent>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <CardHeader>
                <CardTitle className="text-xl">Any goals on your mind?</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Pick as many as you like -- or skip this. You can set these up properly later.
                </p>
                <div role="group" aria-label="Financial goals" className="flex flex-wrap gap-2">
                  {GOAL_TYPE_INTERESTS.map((g) => (
                    <ChipToggle
                      key={g}
                      label={g}
                      selected={interestedGoalTypes.includes(g)}
                      onToggle={() => toggleGoalType(g)}
                    />
                  ))}
                </div>
              </CardContent>
            </>
          ) : null}

          {serverError ? (
            <p role="alert" className="px-6 pb-2 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <CardContent className="flex items-center justify-between gap-2 pt-0">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={() => setStep((s) => Math.max(s - 1, 0))}
              >
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {step > 0 ? (
                <Button type="button" variant="outline" size="touch" onClick={skipStep}>
                  Skip
                </Button>
              ) : null}
              {step < TOTAL_STEPS - 1 ? (
                <Button type="button" size="touch" onClick={persistStepAndAdvance}>
                  Continue
                </Button>
              ) : (
                <Button type="submit" size="touch" disabled={isSubmitting}>
                  {isSubmitting ? "Finishing…" : "Finish"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

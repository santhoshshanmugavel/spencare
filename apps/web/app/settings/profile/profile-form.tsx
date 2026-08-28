"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileUpdateSchema, type ProfileUpdateInput } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, errorId } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { updateProfileAction } from "../actions";

const CURRENCIES = ["INR", "USD", "EUR", "GBP"];
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "UTC"];

export function ProfileForm({
  initialDisplayName,
  initialCurrency,
  initialTimezone,
}: {
  initialDisplayName: string;
  initialCurrency: string;
  initialTimezone: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileUpdateInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: initialDisplayName,
      preferredCurrency: initialCurrency,
      timezone: initialTimezone,
    },
  });

  async function onSubmit(data: ProfileUpdateInput) {
    setServerError(null);
    const result = await updateProfileAction(data);
    if (!result.ok) {
      setServerError(result.error.message);
      toastError(result.error.message);
    } else {
      toastConfirmed("Profile updated.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <FormField id="displayName" label="Display name" error={errors.displayName?.message}>
        <Input
          id="displayName"
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
              <SelectTrigger id="preferredCurrency" aria-invalid={!!errors.preferredCurrency}>
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

      <FormField id="timezone" label="Timezone" error={errors.timezone?.message}>
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="timezone" aria-invalid={!!errors.timezone}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      {serverError ? (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="touch" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

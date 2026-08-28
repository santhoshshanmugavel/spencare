"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { backupCodeSchema, totpVerifySchema } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, errorId } from "@/components/spencare/form-field";
import { PinOtpInput } from "@/components/spencare/pin-otp-input";
import { verifyTwoFactorAction } from "./actions";

export function VerifyTwoFactorForm({ redirectTarget }: { redirectTarget: string | null }) {
  const [mode, setMode] = useState<"totp" | "backup_code">("totp");
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = mode === "totp" ? totpVerifySchema : backupCodeSchema;
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({ resolver: zodResolver(schema) });

  async function onSubmit(data: { code: string }) {
    setServerError(null);
    const result = await verifyTwoFactorAction(data.code, redirectTarget);
    if (result && !result.ok) setServerError(result.error ?? "That code isn't valid.");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {mode === "totp" ? (
          <FormField id="code" label="6-digit code" error={errors.code?.message}>
            <Controller
              control={control}
              name="code"
              defaultValue=""
              render={({ field }) => (
                <PinOtpInput
                  length={6}
                  value={field.value}
                  onChange={field.onChange}
                  error={!!errors.code}
                />
              )}
            />
          </FormField>
        ) : (
          <FormField id="code" label="Backup code" error={errors.code?.message}>
            <Input
              id="code"
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="XXXX-XXXX"
              aria-invalid={!!errors.code}
              aria-describedby={errors.code ? errorId("code") : undefined}
              {...register("code")}
            />
          </FormField>
        )}

        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}

        <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Verifying…" : "Verify"}
        </Button>
      </form>

      <Button
        type="button"
        variant="link"
        size="touch"
        className="w-full"
        onClick={() => {
          setMode((m) => (m === "totp" ? "backup_code" : "totp"));
          setServerError(null);
          reset();
        }}
      >
        {mode === "totp" ? "Use a backup code instead" : "Use your authenticator app instead"}
      </Button>
    </div>
  );
}

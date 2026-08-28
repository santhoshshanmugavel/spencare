"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { totpVerifySchema, type TotpVerifyInput } from "@spencare/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField, errorId } from "@/components/spencare/form-field";
import { PinOtpInput } from "@/components/spencare/pin-otp-input";
import { toastConfirmed, toastError } from "@/lib/toast";
import {
  confirmTotpEnrollmentAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  startTotpEnrollmentAction,
} from "../actions";

type ViewState =
  | { step: "idle" }
  | { step: "enrolling"; otpAuthUri: string; secretBase32: string; qrCodeDataUrl: string }
  | { step: "backup_codes"; codes: string[]; heading: string }
  | { step: "disabling" }
  | { step: "regenerating" };

function CodeChallengeForm({
  onSubmit,
  submitLabel,
}: {
  onSubmit: (code: string) => Promise<{ ok: boolean; error?: string }>;
  submitLabel: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpVerifyInput>({ resolver: zodResolver(totpVerifySchema) });

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        setServerError(null);
        const result = await onSubmit(data.code);
        if (!result.ok) setServerError(result.error ?? "That code isn't valid.");
      })}
      noValidate
      className="space-y-3"
    >
      <FormField id="challengeCode" label="Enter your 6-digit code or a backup code" error={errors.code?.message}>
        <Input
          id="challengeCode"
          autoComplete="one-time-code"
          aria-invalid={!!errors.code}
          aria-describedby={errors.code ? errorId("challengeCode") : undefined}
          {...register("code")}
        />
      </FormField>
      {serverError ? (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" size="touch" variant="destructive" disabled={isSubmitting}>
        {isSubmitting ? "Verifying…" : submitLabel}
      </Button>
    </form>
  );
}

export function TwoFactorManager({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [view, setView] = useState<ViewState>({ step: "idle" });

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TotpVerifyInput>({ resolver: zodResolver(totpVerifySchema), defaultValues: { code: "" } });

  async function beginEnrollment() {
    const result = await startTotpEnrollmentAction();
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    setView({
      step: "enrolling",
      otpAuthUri: result.value.otpAuthUri,
      secretBase32: result.value.secretBase32,
      qrCodeDataUrl: result.value.qrCodeDataUrl,
    });
  }

  async function confirmEnrollment(data: TotpVerifyInput) {
    const result = await confirmTotpEnrollmentAction(data.code);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    setEnabled(true);
    setView({ step: "backup_codes", codes: result.value.backupCodes, heading: "Two-factor authentication is on" });
  }

  if (view.step === "backup_codes") {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-medium text-success">
          {view.heading}
        </p>
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">
            Save these backup codes somewhere safe. Each one can be used once if you lose access
            to your authenticator app. They won&apos;t be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm tabular-nums">
            {view.codes.map((code) => (
              <li key={code} className="rounded bg-background px-2 py-1 text-center">
                {code}
              </li>
            ))}
          </ul>
        </div>
        <Button size="touch" onClick={() => setView({ step: "idle" })}>
          I&apos;ve saved these codes
        </Button>
      </div>
    );
  }

  if (view.step === "enrolling") {
    return (
      <div className="space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image */}
        <img
          src={view.qrCodeDataUrl}
          alt="QR code to scan with your authenticator app"
          width={220}
          height={220}
          className="rounded-lg border border-border"
        />
        <p className="text-sm text-muted-foreground">
          Can&apos;t scan? Enter this code manually:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{view.secretBase32}</code>
        </p>
        <form onSubmit={handleSubmit(confirmEnrollment)} noValidate className="space-y-3">
          <FormField id="enrollCode" label="Enter the 6-digit code from your app" error={errors.code?.message}>
            <Controller
              control={control}
              name="code"
              render={({ field }) => (
                <PinOtpInput length={6} value={field.value} onChange={field.onChange} error={!!errors.code} />
              )}
            />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="touch" disabled={isSubmitting}>
              {isSubmitting ? "Verifying…" : "Confirm"}
            </Button>
            <Button type="button" variant="ghost" size="touch" onClick={() => setView({ step: "idle" })}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  if (view.step === "disabling") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Confirm with your authenticator app or a backup code to turn off 2FA.
        </p>
        <CodeChallengeForm
          submitLabel="Disable 2FA"
          onSubmit={async (code) => {
            const result = await disableTwoFactorAction(code);
            if (result.ok) {
              setEnabled(false);
              setView({ step: "idle" });
              toastConfirmed("Two-factor authentication turned off.");
              return { ok: true };
            }
            return { ok: false, error: result.error.message };
          }}
        />
        <Button variant="ghost" size="touch" onClick={() => setView({ step: "idle" })}>
          Cancel
        </Button>
      </div>
    );
  }

  if (view.step === "regenerating") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Confirm with your authenticator app to generate a new set of backup codes. Your old
          codes will stop working.
        </p>
        <CodeChallengeForm
          submitLabel="Generate new codes"
          onSubmit={async (code) => {
            const result = await regenerateBackupCodesAction(code);
            if (result.ok) {
              setView({ step: "backup_codes", codes: result.value.backupCodes, heading: "New backup codes generated" });
              return { ok: true };
            }
            return { ok: false, error: result.error.message };
          }}
        />
        <Button variant="ghost" size="touch" onClick={() => setView({ step: "idle" })}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant={enabled ? "default" : "outline"}>{enabled ? "On" : "Off"}</Badge>
        <span className="text-sm text-muted-foreground">
          {enabled
            ? "Two-factor authentication is protecting your account."
            : "Add an authenticator app for an extra layer of security."}
        </span>
      </div>
      {enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="touch" onClick={() => setView({ step: "regenerating" })}>
            Regenerate backup codes
          </Button>
          <Button variant="destructive" size="touch" onClick={() => setView({ step: "disabling" })}>
            Disable 2FA
          </Button>
        </div>
      ) : (
        <Button size="touch" onClick={beginEnrollment}>
          Set up 2FA
        </Button>
      )}
    </div>
  );
}

"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * <PinOtpInput> — shared digit-entry composite for PIN (4 digits, masked)
 * and email/2FA verification codes (6 digits, visible), per
 * component-inventory.md §3. shadcn has no built-in OTP primitive, so this
 * is the one Foundation component built from scratch rather than adapted
 * from a shadcn primitive (design-system-specification.md §5).
 *
 * Behavior (component-inventory.md §3, accessibility-requirements.md §1):
 *  - auto-advances focus to the next box on digit entry
 *  - auto-retreats focus to the previous box on Backspace when the current
 *    box is already empty
 *  - supports pasting a full code across all boxes at once
 *  - each box has inputMode="numeric" and a per-box aria-label
 */

export interface PinOtpInputProps {
  length: 4 | 6;
  value: string;
  onChange: (value: string) => void;
  /** true = PIN (masked dots), false = OTP/2FA code (visible digits). */
  masked?: boolean;
  disabled?: boolean;
  error?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function PinOtpInput({
  length,
  value,
  onChange,
  masked = false,
  disabled = false,
  error = false,
  "aria-label": ariaLabelPrefix = masked ? "PIN digit" : "Verification code digit",
  className,
}: PinOtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.split("").slice(0, length);
  while (digits.length < length) digits.push("");

  function setDigitAt(index: number, digit: string) {
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) {
      setDigitAt(index, "");
      return;
    }
    setDigitAt(index, digit);
    if (index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setDigitAt(index - 1, "");
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted.padEnd(length, "").slice(0, length).replace(/\s/g, ""));
    const lastFilledIndex = Math.min(pasted.length, length) - 1;
    inputRefs.current[Math.max(lastFilledIndex, 0)]?.focus();
  }

  return (
    <div role="group" aria-label={masked ? "Enter your PIN" : "Enter verification code"} className={cn("flex gap-2", className)}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type={masked ? "password" : "text"}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`${ariaLabelPrefix} ${index + 1} of ${length}`}
          aria-invalid={error || undefined}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          className={cn(
            "size-12 rounded-lg border text-center text-lg tabular-nums outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            error ? "border-destructive" : "border-border",
            disabled && "pointer-events-none opacity-50",
          )}
        />
      ))}
    </div>
  );
}

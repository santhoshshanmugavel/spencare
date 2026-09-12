import { z } from "zod";

/**
 * Auth + Identity validation schemas, shared between the client-side forms
 * (react-hook-form + @hookform/resolvers/zod) and the server actions that
 * ultimately call Supabase Auth -- the same schema validates both sides,
 * per frontend-architecture.md §6 / design-system-specification.md §5.
 *
 * Password policy (8+ chars, upper/lower/digit): UNSPECIFIED in
 * security-architecture.md beyond "hashed with a modern KDF, handled by
 * Supabase Auth" -- no minimum length/complexity is documented anywhere in
 * the architecture. This is a build-time decision, applied consistently
 * here and in supabase/config.toml's `[auth] minimum_password_length`, and
 * called out as such rather than silently assumed.
 */

const PASSWORD_MIN_LENGTH = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  captchaToken: z.string().optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  captchaToken: z.string().optional(),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  captchaToken: z.string().optional(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// `Intl.supportedValuesOf('timeZone')` only returns ICU's CANONICAL zone
// IDs -- it excludes valid IANA link/alias names (e.g. it lists
// "Asia/Calcutta" but not "Asia/Kolkata", even though the latter is the
// modern IANA name and the one this product defaults new profiles to,
// per the auth-identity migration). Using it as an allowlist would reject
// our own default timezone. `Intl.DateTimeFormat` resolves aliases
// correctly, so constructing one (and catching the RangeError it throws
// for a genuinely invalid zone) is the correct validation, not a
// membership check against the canonical-only list.
function isValidTimeZone(tz: string): boolean {
  if (typeof Intl === "undefined") return true;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().max(80, "Name is too long.").optional(),
  preferredCurrency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code."),
  timezone: z.string().refine(isValidTimeZone, "Not a recognized timezone."),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Phase 32 -- deliberately its OWN narrow schema/command, not a reuse of
 * `profileUpdateSchema` above: that schema requires `preferredCurrency`/
 * `timezone` on every call (it's a whole-form save for Settings > Profile),
 * which would force every toggle click elsewhere in the product (nav rail,
 * Settings > Privacy) to first know and resend the user's current currency
 * and timezone just to flip one boolean. Same "narrow, single-purpose
 * schema beside a general one" precedent as `avatarUploadSchema` beside
 * `profileUpdateSchema`.
 */
export const updatePrivacyModeSchema = z.object({
  enabled: z.boolean(),
});
export type UpdatePrivacyModeInput = z.infer<typeof updatePrivacyModeSchema>;

export const totpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;

export const backupCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Enter a backup code in the form XXXX-XXXX."),
});
export type BackupCodeInput = z.infer<typeof backupCodeSchema>;

export const avatarUploadSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"], {
    message: "Only PNG, JPEG, or WebP images are supported.",
  }),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024, "Image must be under 5MB."),
});
export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;

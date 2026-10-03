import { z } from "zod";

/**
 * Account validation (database-architecture.md's `accounts` table +
 * domain-architecture.md §3). `account_type` is the DB enum verbatim --
 * bank | cash | credit_card | investment -- no invented subtypes (Phase 7
 * §3: bank "Savings/Current" and investment "Mutual Funds/Stocks/…" have
 * no schema column and are deliberately not implemented; DD-10 stays
 * unresolved, documented, not silently picked).
 */

export const ACCOUNT_TYPES = ["bank", "cash", "credit_card", "investment"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const nameSchema = z.string().trim().min(1, "Enter a name.").max(80, "Name is too long.");
const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code.");

// Money fields are entered by the user as whole-rupee input then converted
// to minor units before validation (same pattern as onboarding's income
// field) -- validated here as already-integer minor units, matching
// Money's own domain-core invariant (never floating point).
const minorUnitsSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .max(1_000_000_000_000, "That amount is too large.");

const nonNegativeMinorUnitsSchema = minorUnitsSchema.nonnegative("Amount can't be negative.");

// Named per-type variants -- exported individually so the UI's segmented
// tabs (SP-235: one shared component, 4 tabs, genuinely different fields
// per tab) can each own a small, simple form/resolver instead of fighting
// react-hook-form against one discriminated-union schema.
export const createBankAccountSchema = z.object({
  type: z.literal("bank"),
  name: nameSchema,
  currency: currencySchema,
  balanceMinor: minorUnitsSchema, // bank balances may legitimately be negative (overdraft)
});
export const createCashAccountSchema = z.object({
  type: z.literal("cash"),
  name: nameSchema,
  currency: currencySchema,
  balanceMinor: nonNegativeMinorUnitsSchema,
});
// Bill-due-day field uses the payment_day_rule sentinel: 1-28 = literal day,
// 29 = 29th, 30 = 30th, 31 = 31st (clamped to last valid day of a shorter
// month), 32 = last day of month. The paymentDueDay zod field maps to the
// `payment_due_day` DB column -- which, in the simplified single-date
// billing model, IS the card's bill due day. There is no longer a separate
// "statement closes on" input (that distinction and the grace-period shift
// rule it enabled are gone); the day the cycle closes IS the day the bill
// is due. The `statement_close_day` column still exists in the schema but
// is deprecated: the application command always writes NULL for it on new
// and updated rows.
const billingDaySchema = z
  .number()
  .int()
  .min(1, "Must be between 1 and 32.")
  .max(32, "Must be between 1 and 32.")
  .nullable()
  .optional();

export const createCreditCardAccountSchema = z.object({
  type: z.literal("credit_card"),
  name: nameSchema,
  currency: currencySchema,
  creditLimitMinor: nonNegativeMinorUnitsSchema,
  creditUsedMinor: nonNegativeMinorUnitsSchema,
  paymentDueDay: billingDaySchema,
});
export const createInvestmentAccountSchema = z.object({
  type: z.literal("investment"),
  name: nameSchema,
  currency: currencySchema,
  marketValueMinor: nonNegativeMinorUnitsSchema,
});

/**
 * Discriminated union on `type` -- each variant only accepts the fields
 * the check constraints require/forbid for that type
 * (database-architecture.md's `accounts_credit_fields_*`/
 * `accounts_market_value_*` constraints). This is what the application
 * command actually validates against; the UI submits into whichever named
 * variant matches the active tab.
 */
export const createAccountSchema = z.discriminatedUnion("type", [
  createBankAccountSchema,
  createCashAccountSchema,
  createCreditCardAccountSchema,
  createInvestmentAccountSchema,
]);
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/**
 * Update is intentionally narrower than create: only `name` and the
 * type-appropriate value field are editable. `type` and `currency` are not
 * -- changing an account's fundamental type or currency post-creation is
 * unspecified behavior (Phase 7 §7's "document as an implementation
 * decision instead of silently inventing a policy"); the safe, minimal
 * choice is not to allow it rather than guess a migration/conversion rule.
 */
export const updateAccountSchema = z.object({
  name: nameSchema.optional(),
  balanceMinor: minorUnitsSchema.optional(),
  creditLimitMinor: nonNegativeMinorUnitsSchema.optional(),
  creditUsedMinor: nonNegativeMinorUnitsSchema.optional(),
  marketValueMinor: nonNegativeMinorUnitsSchema.optional(),
  paymentDueDay: billingDaySchema,
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

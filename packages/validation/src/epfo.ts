import { z } from "zod";

/**
 * EPFO Phase 3 validation. User-input shapes for the Add EPFO Account
 * flow and the optional employment + contribution profile setups.
 *
 * Money fields are integer minor units -- validated as already-converted
 * integers, matching Money.ts's domain invariant (never floating point).
 * The web layer's rupee->minor conversion must happen BEFORE calling
 * these schemas.
 */

const nameSchema = z.string().trim().min(1, "Enter a name.").max(80, "Name is too long.");
const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code.");

const minorUnitsSchema = z.number().int("Amount must be a whole number of minor units.")
  .max(1_000_000_000_000, "That amount is too large.");

const nonNegativeMinorUnitsSchema = minorUnitsSchema.nonnegative("Amount can't be negative.");

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid YYYY-MM-DD date.");
const isoTimestampSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid timestamp.");

export const createEpfoAccountSchema = z.object({
  name: nameSchema,
  currency: currencySchema,
  // Opening balance may be positive, zero, or negative (negative covers
  // a user correcting a previously-overstated balance). Zero skips the
  // ledger entry at the RPC level.
  openingBalanceMinor: minorUnitsSchema,
  asOf: isoTimestampSchema,
});
export type CreateEpfoAccountInput = z.infer<typeof createEpfoAccountSchema>;

export const addEpfoEmploymentSchema = z.object({
  accountId: z.string().uuid(),
  employerName: z.string().trim().min(1, "Enter an employer name.").max(120, "Employer name is too long."),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().optional(),
  memberId: z.string().trim().max(40, "Member ID is too long.").nullable().optional(),
  notes: z.string().trim().max(500, "Notes are too long.").nullable().optional(),
}).refine(
  (v) => v.endDate == null || v.startDate <= v.endDate,
  { message: "End date must be on or after start date.", path: ["endDate"] },
);
export type AddEpfoEmploymentInput = z.infer<typeof addEpfoEmploymentSchema>;

export const endEpfoEmploymentSchema = z.object({
  employmentId: z.string().uuid(),
  endDate: isoDateSchema,
});
export type EndEpfoEmploymentInput = z.infer<typeof endEpfoEmploymentSchema>;

const contributionBase = z.object({
  accountId: z.string().uuid(),
  employmentId: z.string().uuid().nullable().optional(),
  kind: z.enum(["employee_epf", "employer_epf", "eps"]),
  effectiveFrom: isoDateSchema,
});

export const upsertEpfoContributionProfileSchema = z.discriminatedUnion("mode", [
  contributionBase.extend({ mode: z.literal("fixed"), amountMinor: nonNegativeMinorUnitsSchema }),
  contributionBase.extend({
    mode: z.literal("percent"),
    percentNum: z.number().int().positive("Percent numerator must be positive."),
    percentDen: z.number().int().positive("Percent denominator must be positive."),
    baseAmountMinor: nonNegativeMinorUnitsSchema,
  }),
  contributionBase.extend({ mode: z.literal("imported") }),
  contributionBase.extend({ mode: z.literal("none") }),
]);
export type UpsertEpfoContributionProfileInput = z.infer<typeof upsertEpfoContributionProfileSchema>;

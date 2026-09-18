import { z } from "zod";

export const PAYMENT_FREQUENCIES = [
  "one_time",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "every_2_months",
  "quarterly",
  "every_6_months",
  "yearly",
  "every_2_years",
  "every_3_years",
] as const;

export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const PAYMENT_FREQUENCY_LABELS: Record<PaymentFrequency, string> = {
  one_time: "One time",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  every_2_months: "Every 2 months",
  quarterly: "Quarterly",
  every_6_months: "Every 6 months",
  yearly: "Yearly",
  every_2_years: "Every 2 years",
  every_3_years: "Every 3 years",
};

export const SAVING_CADENCES = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
] as const;

export type SavingCadence = (typeof SAVING_CADENCES)[number];

export const SAVING_CADENCE_LABELS: Record<SavingCadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

const amountSchema = z
  .number({ error: "Enter a valid amount." })
  .int("Amount must be in minor units (no decimals).")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000, "Amount is too large.");

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date in YYYY-MM-DD format.");

export const createCommitmentSchema = z
  .object({
    name: z.string().trim().min(1, "Give this commitment a name.").max(120, "Name is too long."),
    categoryId: z.string().uuid("Invalid category.").nullable().optional(),
    amountMinor: amountSchema,
    amountIsEstimate: z.boolean().default(false),
    currency: z.string().length(3).default("INR"),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    nextPaymentDate: dateSchema,
    savingCadence: z.enum(SAVING_CADENCES).nullable().optional(),
    savingAmountMinor: amountSchema.nullable().optional(),
    firstSavingDate: dateSchema.nullable().optional(),
    fundingAccountId: z.string().uuid("Invalid account.").nullable().optional(),
    tenureType: z.enum(["none", "n_payments", "end_date"]).default("none"),
    tenurePayments: z.number().int().positive().nullable().optional(),
    tenureEndDate: dateSchema.nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tenureType === "n_payments" && !data.tenurePayments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the number of payments.",
        path: ["tenurePayments"],
      });
    }
    if (data.tenureType === "end_date" && !data.tenureEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter an end date.",
        path: ["tenureEndDate"],
      });
    }
    if (data.savingCadence && !data.savingAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a saving amount.",
        path: ["savingAmountMinor"],
      });
    }
    if (data.savingCadence && !data.firstSavingDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the first saving date.",
        path: ["firstSavingDate"],
      });
    }
  });

export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;

export const updateCommitmentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  amountMinor: amountSchema.optional(),
  amountIsEstimate: z.boolean().optional(),
  paymentFrequency: z.enum(PAYMENT_FREQUENCIES).optional(),
  nextPaymentDate: dateSchema.optional(),
  savingCadence: z.enum(SAVING_CADENCES).nullable().optional(),
  savingAmountMinor: amountSchema.nullable().optional(),
  firstSavingDate: dateSchema.nullable().optional(),
  fundingAccountId: z.string().uuid().nullable().optional(),
  tenureType: z.enum(["none", "n_payments", "end_date"]).optional(),
  tenurePayments: z.number().int().positive().nullable().optional(),
  tenureEndDate: dateSchema.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;

export const reserveCommitmentSchema = z.object({
  occurrenceId: z.string().uuid(),
  reserveAmountMinor: amountSchema,
});

export type ReserveCommitmentInput = z.infer<typeof reserveCommitmentSchema>;

export const skipOccurrenceSchema = z.object({
  occurrenceId: z.string().uuid(),
  reason: z.string().max(200).nullable().optional(),
});

export type SkipOccurrenceInput = z.infer<typeof skipOccurrenceSchema>;

export const markCommitmentPaidSchema = z.object({
  occurrenceId: z.string().uuid(),
  transactionId: z.string().uuid().nullable().optional(),
  paidAmountMinor: amountSchema.optional(),
});

export type MarkCommitmentPaidInput = z.infer<typeof markCommitmentPaidSchema>;

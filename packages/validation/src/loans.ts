import { z } from "zod";

export const LOAN_TYPES = [
  "personal",
  "home",
  "car",
  "bike",
  "education",
  "business",
  "other",
] as const;

export type LoanType = (typeof LOAN_TYPES)[number];

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  personal: "Personal",
  home: "Home",
  car: "Car",
  bike: "Bike",
  education: "Education",
  business: "Business",
  other: "Other",
};

const amountSchema = z
  .number({ error: "Enter a valid amount." })
  .int("Amount must be in minor units.")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000_000, "Amount is too large.");

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date in YYYY-MM-DD format.");

export const createLoanSchema = z.object({
  name: z.string().trim().min(1, "Give this loan a name.").max(120, "Name is too long."),
  lenderName: z.string().trim().max(120).nullable().optional(),
  loanType: z.enum(LOAN_TYPES).default("personal"),
  principalMinor: amountSchema,
  outstandingMinor: amountSchema.nullable().optional(),
  interestRatePct: z.number().min(0).max(100).nullable().optional(),
  currency: z.string().length(3).default("INR"),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  repaymentFrequency: z
    .enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"])
    .default("monthly"),
  installmentAmountMinor: amountSchema,
  nextPaymentDate: dateSchema.nullable().optional(),
  paymentAccountId: z.string().uuid("Invalid account.").nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;

export const updateLoanSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  lenderName: z.string().trim().max(120).nullable().optional(),
  loanType: z.enum(LOAN_TYPES).optional(),
  interestRatePct: z.number().min(0).max(100).nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  repaymentFrequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly"]).optional(),
  installmentAmountMinor: amountSchema.optional(),
  nextPaymentDate: dateSchema.nullable().optional(),
  paymentAccountId: z.string().uuid().nullable().optional(),
  outstandingMinor: amountSchema.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;

export const recordLoanPaymentSchema = z.object({
  loanId: z.string().uuid(),
  paidAmountMinor: amountSchema,
  paymentDate: dateSchema,
  transactionId: z.string().uuid().nullable().optional(),
});

export type RecordLoanPaymentInput = z.infer<typeof recordLoanPaymentSchema>;

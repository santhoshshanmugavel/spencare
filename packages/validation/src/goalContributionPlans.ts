import { z } from "zod";

export const GOAL_CONTRIBUTION_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
] as const;

export type GoalContributionFrequencyInput = (typeof GOAL_CONTRIBUTION_FREQUENCIES)[number];

const amountMinorSchema = z
  .number()
  .int("Amount must be a whole number of minor units.")
  .positive("Amount must be greater than zero.")
  .max(1_000_000_000_000, "That amount is too large.");

export const createGoalContributionPlanSchema = z.object({
  goalId: z.string().uuid(),
  frequency: z.enum(GOAL_CONTRIBUTION_FREQUENCIES),
  amountMinor: amountMinorSchema,
  /** For weekly: 1=Mon…7=Sun. For monthly+: day of month 1–28 (capped). */
  anchorDay: z.number().int().min(1).max(31).optional().nullable(),
  /** For yearly: month 1–12. */
  anchorMonth: z.number().int().min(1).max(12).optional().nullable(),
  timezone: z.string().max(64).optional(),
  startDate: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
    .optional(),
});
export type CreateGoalContributionPlanInput = z.infer<typeof createGoalContributionPlanSchema>;

export const updateGoalContributionPlanSchema = z.object({
  frequency: z.enum(GOAL_CONTRIBUTION_FREQUENCIES).optional(),
  amountMinor: amountMinorSchema.optional(),
  anchorDay: z.number().int().min(1).max(31).optional().nullable(),
  anchorMonth: z.number().int().min(1).max(12).optional().nullable(),
  timezone: z.string().max(64).optional(),
  startDate: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
    .optional(),
});
export type UpdateGoalContributionPlanInput = z.infer<typeof updateGoalContributionPlanSchema>;

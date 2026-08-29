import { z } from "zod";
import { createExpenseSchema, createIncomeSchema } from "./transactions.js";
import { addContributionSchema } from "./goals.js";
import { markPaidSchema } from "./bills.js";
import { createBudgetSchema } from "./budgets.js";
import { createGoalSchema } from "./goals.js";

/**
 * Phase 16 -- AI tool input schemas. Every write tool's input schema is
 * the SAME shared Zod schema its Web-UI command already validates against
 * (ai-architecture.md §4: "the *same* schema used by packages/domain/
 * application commands, never a re-declared parallel one") -- none of
 * these are redefined here, only re-exported/composed, so a change to a
 * command's validation rule can never silently drift between the Web form
 * and the AI tool that proposes the identical mutation.
 */

export const proposeAddExpenseSchema = createExpenseSchema;
export const proposeAddIncomeSchema = createIncomeSchema;
export const proposeGoalContributionSchema = addContributionSchema;
export const proposeMarkBillPaidSchema = markPaidSchema;
export const proposeCreateBudgetSchema = createBudgetSchema;
export const proposeCreateGoalSchema = createGoalSchema;

export type ProposeAddExpenseInput = z.infer<typeof proposeAddExpenseSchema>;
export type ProposeAddIncomeInput = z.infer<typeof proposeAddIncomeSchema>;
export type ProposeGoalContributionInput = z.infer<typeof proposeGoalContributionSchema>;
export type ProposeMarkBillPaidInput = z.infer<typeof proposeMarkBillPaidSchema>;
export type ProposeCreateBudgetInput = z.infer<typeof proposeCreateBudgetSchema>;
export type ProposeCreateGoalInput = z.infer<typeof proposeCreateGoalSchema>;

/** The five distinct `pending_confirmations.command_type` values Phase 16 writes -- kept as a literal union, not a free-form string, so an unsupported type is a compile-time error, not a runtime surprise. */
export const CONFIRMATION_COMMAND_TYPES = [
  "createTransaction",
  "addContribution",
  "markBillPaid",
  "createBudget",
  "createGoal",
] as const;
export type ConfirmationCommandType = (typeof CONFIRMATION_COMMAND_TYPES)[number];

export const confirmCommandSchema = z.object({
  confirmationId: z.string().uuid(),
});
export type ConfirmCommandInput = z.infer<typeof confirmCommandSchema>;

export const cancelCommandSchema = z.object({
  confirmationId: z.string().uuid(),
});
export type CancelCommandInput = z.infer<typeof cancelCommandSchema>;

/** Read-tool argument schemas -- all narrow, since every read tool's real filtering already lives in the query it wraps. */
export const searchTransactionsToolSchema = z.object({
  accountId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SearchTransactionsToolInput = z.infer<typeof searchTransactionsToolSchema>;

export const getUpcomingBillsToolSchema = z.object({
  limit: z.number().int().positive().max(20).default(5),
});
export type GetUpcomingBillsToolInput = z.infer<typeof getUpcomingBillsToolSchema>;

/** Conversation / message schemas. */
export const sendMessageSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  content: z.string().trim().min(1, "Message cannot be empty.").max(8000, "Message is too long."),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const regenerateReplySchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export type RegenerateReplyInput = z.infer<typeof regenerateReplySchema>;

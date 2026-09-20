import { z } from "zod";
import { createExpenseSchema, createIncomeSchema, updateTransactionSchema } from "./transactions.js";
import { addContributionSchema, withdrawContributionSchema, createGoalSchema, updateGoalSchema } from "./goals.js";
import { markPaidSchema, createBillSchema, updateBillSchema } from "./bills.js";
import { createBudgetSchema, updateBudgetSchema } from "./budgets.js";
import { updateAccountSchema } from "./accounts.js";
import { createCategorySchema } from "./categories.js";
import { profileUpdateSchema, updatePrivacyModeSchema } from "./auth.js";

/**
 * Phase 16 -- AI tool input schemas. Every write tool's input schema is
 * the SAME shared Zod schema its Web-UI command already validates against
 * (ai-architecture.md §4: "the *same* schema used by packages/domain/
 * application commands, never a re-declared parallel one") -- none of
 * these are redefined here, only re-exported/composed, so a change to a
 * command's validation rule can never silently drift between the Web form
 * and the AI tool that proposes the identical mutation.
 */

// ── Existing 6 propose schemas (Phase 16, unchanged) ──────────────────────
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

// ── 21 new propose schemas (Phase 6) ──────────────────────────────────────

// PATCH semantics: all update fields are optional; the MCP tool merges with
// the existing transaction so the AI only needs to supply what changed.
// The full merged payload is what gets stored in pending_confirmations.
export const proposeUpdateTransactionSchema = updateTransactionSchema.partial().extend({
  transactionId: z.string().uuid(),
});
export type ProposeUpdateTransactionInput = z.infer<typeof proposeUpdateTransactionSchema>;

export const proposeDeleteTransactionSchema = z.object({
  transactionId: z.string().uuid(),
});
export type ProposeDeleteTransactionInput = z.infer<typeof proposeDeleteTransactionSchema>;

// Transfer: define as a plain object (no cross-field refine) so .shape is
// accessible for MCP tool registration; the domain command enforces
// fromAccountId !== toAccountId before executing the SQL RPC.
export const proposeTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amountMinor: z.number().int("Amount must be a whole number of minor units.").positive("Amount must be greater than zero.").max(1_000_000_000_000, "That amount is too large."),
  occurredAt: z
    .string()
    .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00+05:30" : v))
    .pipe(z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date.")),
  description: z.string().trim().max(500).optional(),
});
export type ProposeTransferInput = z.infer<typeof proposeTransferSchema>;

// createAccountSchema is a discriminated union (no .shape). Define a flat
// superset object for MCP; the domain command re-validates with the
// discriminated schema before executing.
export const proposeCreateAccountSchema = z.object({
  type: z.enum(["bank", "cash", "credit_card", "investment"]),
  name: z.string().trim().min(1, "Enter a name.").max(80, "Name is too long."),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code."),
  balanceMinor: z.number().int().max(1_000_000_000_000).optional(),
  creditLimitMinor: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  creditUsedMinor: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  marketValueMinor: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
});
export type ProposeCreateAccountInput = z.infer<typeof proposeCreateAccountSchema>;

export const proposeUpdateAccountSchema = updateAccountSchema.extend({
  accountId: z.string().uuid(),
});
export type ProposeUpdateAccountInput = z.infer<typeof proposeUpdateAccountSchema>;

export const proposeArchiveAccountSchema = z.object({
  accountId: z.string().uuid(),
});
export type ProposeArchiveAccountInput = z.infer<typeof proposeArchiveAccountSchema>;

export const proposeCreateBillSchema = createBillSchema;
export type ProposeCreateBillInput = z.infer<typeof proposeCreateBillSchema>;

export const proposeUpdateBillSchema = updateBillSchema.extend({
  billId: z.string().uuid(),
});
export type ProposeUpdateBillInput = z.infer<typeof proposeUpdateBillSchema>;

export const proposeCreateCategorySchema = createCategorySchema;
export type ProposeCreateCategoryInput = z.infer<typeof proposeCreateCategorySchema>;

// No Zod schema exists for updateCategory in the domain; define inline,
// matching the command's own validation rules (name 1–50 chars).
export const proposeUpdateCategorySchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1, "Enter a category name.").max(50, "Name too long (max 50 characters).").optional(),
  icon: z.string().trim().max(50).nullable().optional(),
});
export type ProposeUpdateCategoryInput = z.infer<typeof proposeUpdateCategorySchema>;

export const proposeDeleteCategorySchema = z.object({
  categoryId: z.string().uuid(),
  reassignToCategoryId: z.string().uuid(),
});
export type ProposeDeleteCategoryInput = z.infer<typeof proposeDeleteCategorySchema>;

export const proposeUpdateGoalSchema = updateGoalSchema.extend({
  goalId: z.string().uuid(),
});
export type ProposeUpdateGoalInput = z.infer<typeof proposeUpdateGoalSchema>;

export const proposeArchiveGoalSchema = z.object({
  goalId: z.string().uuid(),
});
export type ProposeArchiveGoalInput = z.infer<typeof proposeArchiveGoalSchema>;

export const proposeWithdrawContributionSchema = withdrawContributionSchema;
export type ProposeWithdrawContributionInput = z.infer<typeof proposeWithdrawContributionSchema>;

export const proposeUpdateBudgetSchema = updateBudgetSchema.extend({
  budgetId: z.string().uuid(),
});
export type ProposeUpdateBudgetInput = z.infer<typeof proposeUpdateBudgetSchema>;

export const proposeDeleteBudgetSchema = z.object({
  budgetId: z.string().uuid(),
});
export type ProposeDeleteBudgetInput = z.infer<typeof proposeDeleteBudgetSchema>;

export const proposeUpdateProfileSchema = profileUpdateSchema;
export type ProposeUpdateProfileInput = z.infer<typeof proposeUpdateProfileSchema>;

export const proposeUpdatePrivacyModeSchema = updatePrivacyModeSchema;
export type ProposeUpdatePrivacyModeInput = z.infer<typeof proposeUpdatePrivacyModeSchema>;

export const proposeAcceptGmailCandidateSchema = z.object({
  candidateId: z.string().uuid(),
});
export type ProposeAcceptGmailCandidateInput = z.infer<typeof proposeAcceptGmailCandidateSchema>;

export const proposeRejectGmailCandidateSchema = z.object({
  candidateId: z.string().uuid(),
});
export type ProposeRejectGmailCandidateInput = z.infer<typeof proposeRejectGmailCandidateSchema>;

export const proposeRevokeMcpSessionSchema = z.object({
  sessionId: z.string().uuid(),
});
export type ProposeRevokeMcpSessionInput = z.infer<typeof proposeRevokeMcpSessionSchema>;

// ── Commitment and Loan propose schemas ───────────────────────────────────
import { createCommitmentSchema, updateCommitmentSchema, reserveCommitmentSchema, skipOccurrenceSchema, markCommitmentPaidSchema } from "./commitments.js";
import { createLoanSchema, updateLoanSchema } from "./loans.js";
export {
  createCommitmentSchema as proposeCreateCommitmentSchema,
  updateCommitmentSchema as proposeUpdateCommitmentSchema,
  reserveCommitmentSchema as proposeReserveCommitmentSchema,
  skipOccurrenceSchema as proposeSkipCommitmentOccurrenceSchema,
  markCommitmentPaidSchema as proposeMarkCommitmentPaidSchema,
  createLoanSchema as proposeCreateLoanSchema,
  updateLoanSchema as proposeUpdateLoanSchema,
};

const proposeCommitmentIdSchema = z.object({ commitmentId: z.string().uuid() });
export const proposePauseCommitmentSchema = proposeCommitmentIdSchema;
export const proposeResumeCommitmentSchema = proposeCommitmentIdSchema;
export const proposeDeleteCommitmentSchema = proposeCommitmentIdSchema;

const proposeLoanIdSchema = z.object({ loanId: z.string().uuid() });
export const proposeDeleteLoanSchema = proposeLoanIdSchema;

export const proposeMarkLoanPaidSchema = z.object({
  loanId: z.string().uuid(),
  paymentAccountId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  categoryId: z.string().uuid(),
  outstandingMinor: z.number().int().nonnegative().optional(),
});
export type ProposeMarkLoanPaidInput = z.infer<typeof proposeMarkLoanPaidSchema>;

export type ProposeCreateCommitmentInput = z.infer<typeof createCommitmentSchema>;
export type ProposeUpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;

// ── CONFIRMATION_COMMAND_TYPES ─────────────────────────────────────────────
/** All distinct `pending_confirmations.command_type` values -- kept as a literal union so an unsupported type is a compile-time error, not a runtime surprise. */
export const CONFIRMATION_COMMAND_TYPES = [
  // Phase 16 originals
  "createTransaction",
  "addContribution",
  "markBillPaid",
  "createBudget",
  "createGoal",
  // Phase 6 additions
  "updateTransaction",
  "deleteTransaction",
  "transfer",
  "createAccount",
  "updateAccount",
  "archiveAccount",
  "createBill",
  "updateBill",
  "createCategory",
  "updateCategory",
  "deleteCategory",
  "updateGoal",
  "archiveGoal",
  "withdrawContribution",
  "updateBudget",
  "deleteBudget",
  "updateProfile",
  "updatePrivacyMode",
  "acceptGmailCandidate",
  "rejectGmailCandidate",
  "revokeMcpSession",
  // Goal Contribution Plan (planning + reminder, no money movement)
  "createGoalContributionPlan",
  "updateGoalContributionPlan",
  "pauseGoalContributionPlan",
  "resumeGoalContributionPlan",
  "deleteGoalContributionPlan",
  // Planned Commitments (planning + reminder, no money movement)
  "createCommitment",
  "updateCommitment",
  "deleteCommitment",
  "pauseCommitment",
  "resumeCommitment",
  "reserveOccurrence",
  "skipOccurrence",
  "markOccurrencePaid",
  // Loans (tracking only, no money movement)
  "createLoan",
  "updateLoan",
  "deleteLoan",
  "markLoanPaid",
] as const;
export type ConfirmationCommandType = (typeof CONFIRMATION_COMMAND_TYPES)[number];

// ── Confirm / cancel schemas (unchanged) ──────────────────────────────────
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

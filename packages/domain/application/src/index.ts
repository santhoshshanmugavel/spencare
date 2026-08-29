export type { AuthContext, Command, Result, DomainError } from "./types.js";
export { ok, err } from "./types.js";

export { updateProfile } from "./commands/updateProfile.js";
export { updateAvatar, removeAvatar, type UpdateAvatarInput, type UpdateAvatarOutput } from "./commands/updateAvatar.js";
export {
  startTotpEnrollment,
  confirmTotpEnrollment,
  verifyTwoFactorChallenge,
  type StartTotpEnrollmentOutput,
  type ConfirmTotpEnrollmentOutput,
  type VerifyTwoFactorInput,
  type VerifyTwoFactorOutput,
} from "./commands/enrollTwoFactor.js";
export {
  disableTwoFactor,
  regenerateBackupCodes,
  type RegenerateBackupCodesOutput,
} from "./commands/disableTwoFactor.js";
export {
  saveOnboardingStep,
  completeOnboarding,
  getOnboardingStatusQuery,
  type OnboardingStatusOutput,
} from "./commands/onboarding.js";

export {
  createAccount,
  updateAccount,
  archiveAccount,
  type UpdateAccountCommandInput,
  type ArchiveAccountInput,
} from "./commands/accounts.js";

export {
  createTransaction,
  transfer,
  updateTransaction,
  deleteTransaction,
  type TransferCommandInput,
  type UpdateTransactionCommandInput,
  type DeleteTransactionInput,
} from "./commands/transactions.js";

export {
  createBudget,
  updateBudget,
  deleteBudget,
  type UpdateBudgetCommandInput,
  type DeleteBudgetInput,
} from "./commands/budgets.js";

export {
  createGoal,
  updateGoal,
  archiveGoal,
  restoreGoal,
  completeGoal,
  deleteGoal,
  addContribution,
  withdrawContribution,
  type UpdateGoalCommandInput,
  type ArchiveGoalInput,
  type DeleteGoalInput,
} from "./commands/goals.js";

export {
  createBill,
  updateBill,
  deleteBill,
  restoreBill,
  markPaid,
  undoPaid,
  matchTransaction,
  type UpdateBillCommandInput,
  type DeleteBillInput,
  type RestoreBillInput,
} from "./commands/bills.js";

export {
  createImportBatch,
  updateStagedTransaction,
  confirmImport,
  cancelImport,
  type CreateImportBatchCommandInput,
  type ConfirmImportOutput,
} from "./commands/imports.js";
export {
  extractText,
  parseTransactions,
  normalizeTransactions,
  identifyAccount,
  scoreRowConfidence,
  detectDuplicates,
  type ParsedStatement,
  type NormalizedTransaction,
} from "./commands/statementProcessing.js";
export { getImportBatch, listStagedTransactions } from "./queries/imports.js";

export { getProfile } from "./queries/getProfile.js";
export { getProfileForDisplay, type ProfileForDisplay } from "./queries/getProfileForDisplay.js";
export { getSecurityStatus } from "./queries/getSecurityStatus.js";
export {
  listAccounts,
  getAccount,
  getAccountBalance,
  type AccountBalance,
} from "./queries/accounts.js";
export {
  listTransactions,
  getTransaction,
  listCategories,
} from "./queries/transactions.js";
export {
  listBudgets,
  getBudget,
  calculateBudgetSpent,
  calculateBudgetRemaining,
  calculateBudgetStatus,
  listBudgetsWithUsage,
  type BudgetWithUsage,
} from "./queries/budgets.js";
export { getSafeToSpend } from "./queries/safeToSpend.js";
export {
  listGoals,
  getGoal,
  calculateProgress,
  listContributions,
} from "./queries/goals.js";
export { getBill, listBillPredictions } from "./queries/bills.js";
export {
  getCashFlowOverview,
  getCashFlowByCategory,
  compareCashFlowPeriods,
  getRecentTransactions,
  getUpcomingBills,
  type CashFlowPeriod,
  type CashFlowPeriodComparison,
  type GetRecentTransactionsOptions,
} from "./queries/cashFlow.js";
export type {
  AccountRow,
  TransactionRow,
  CategoryRow,
  TransferResult,
  BudgetRow,
  GoalRow,
  ListGoalsOptions,
  BillDefinitionRow,
  BillPredictionRow,
  BillPredictionWithDefinition,
  ListBillPredictionsOptions,
  ImportBatchRow,
  ImportSourceType,
  ImportStatus,
  StagedTransactionRow,
} from "@spencare/domain-infra";
export type { BudgetStatus, BudgetUsage, GoalProgress } from "@spencare/domain-core";
export { BUDGET_STATUS_THRESHOLDS } from "@spencare/domain-core";
export type { SafeToSpendState, SafeToSpendContext, SafeToSpendResult } from "@spencare/domain-core";
export type { StagedTransactionType, ImportSummary, DuplicateSignal } from "@spencare/domain-core";
export { LOW_CONFIDENCE_THRESHOLD } from "@spencare/domain-core";
export {
  predictNextOccurrence,
  detectRecurring,
  type RecurrenceInterval,
  type RecurringSignalInput,
  type RecurringCandidate,
} from "@spencare/domain-core";
export {
  type CashFlowTotals,
  type CashFlowBreakdownMode,
  type CategorySlice,
  type PeriodComparison,
} from "@spencare/domain-core";

export { getDashboardSummary, type DashboardSummary } from "./queries/dashboard.js";

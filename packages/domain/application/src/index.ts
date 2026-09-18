export type { AuthContext, Command, Result, DomainError } from "./types.js";
export { ok, err } from "./types.js";

export { updateProfile, updatePrivacyMode } from "./commands/updateProfile.js";
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
  createCategory,
  updateCategory,
  deleteCategory,
  type UpdateCategoryInput,
  type DeleteCategoryInput,
} from "./commands/categories.js";

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
  updateGoalImage,
  removeGoalImage,
  type UpdateGoalImageInput,
  type UpdateGoalImageOutput,
  type RemoveGoalImageInput,
} from "./commands/goalImage.js";

export {
  createGoalContributionPlan,
  updateGoalContributionPlan,
  pauseGoalContributionPlan,
  resumeGoalContributionPlan,
  deleteGoalContributionPlan,
  type UpdateGoalContributionPlanCommandInput,
  type PlanIdInput,
} from "./commands/goalContributionPlans.js";

export {
  registerOAuthClient,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  type RegisterOAuthClientInput,
  type RegisterOAuthClientOutput,
  type CreateAuthorizationCodeInput,
  type CreateAuthorizationCodeOutput,
  type ExchangeAuthorizationCodeInput,
  type ExchangeAuthorizationCodeOutput,
} from "./commands/oauth.js";
export { getOAuthClientPublicInfo, type OAuthClientPublicInfo } from "./queries/oauth.js";

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
export { getNetWorth } from "./queries/netWorth.js";
export {
  listGoals,
  getGoal,
  calculateProgress,
  listContributions,
  resolveGoalImageUrl,
  resolveGoalImageUrls,
} from "./queries/goals.js";
export { getGoalContributionPlan, getGoalContributionPlanById, listGoalContributionPlans } from "./queries/goalContributionPlans.js";
export { getBill, listBillPredictions } from "./queries/bills.js";
export {
  getCashFlowOverview,
  getCashFlowByCategory,
  compareCashFlowPeriods,
  getCashFlowTrend,
  getRecentTransactions,
  getUpcomingBills,
  type CashFlowPeriod,
  type CashFlowPeriodComparison,
  type CashFlowTrendPoint,
  type GetRecentTransactionsOptions,
} from "./queries/cashFlow.js";
export type {
  AccountRow,
  TransactionRow,
  CategoryRow,
  TransferResult,
  BudgetRow,
  GoalRow,
  GoalContributionPlanRow,
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

// Phase 18 (MCP Integration) relocation: the canonical propose/confirm
// confirmation cascade now lives here, not in packages/ai, so both Spensa
// and apps/mcp-server can share the one real implementation without
// apps/mcp-server needing to depend on packages/ai (which it is
// architecturally forbidden to do -- mcp-architecture.md §1).
export {
  proposeCommand,
  confirmCommand,
  cancelPendingCommand,
  getProposal,
  describeAmountForProvider,
  type ProposalResult,
  type ProposalPreviewField,
  type ConfirmResult,
  type ConfirmError,
} from "./commands/confirmation.js";
export type { ConfirmationSource } from "@spencare/domain-infra";

// The credit-safe account-to-AI-summary mapping, likewise relocated here
// so MCP's getAccounts tool and Spensa's context/tools use the identical
// mapping -- never a second, potentially-diverging implementation.
export { toAiAccountSummaryInput } from "./mappers/aiAccountSummary.js";

// MCP session lifecycle + the one path to an MCP AuthContext (Phase 18).
export {
  createMcpSession,
  listMcpSessions,
  revokeMcpSession,
  resolveMcpAuthContext,
  hasMcpScope,
  type CreateMcpSessionInput,
  type CreateMcpSessionOutput,
  type McpAuthContext,
  type McpAuthResult,
  type McpAuthFailureReason,
} from "./commands/mcpSessions.js";
export type { McpScope, McpSessionStatus } from "@spencare/domain-infra";
export { logMcpScopeDenial } from "./commands/mcpAudit.js";

// The narrow, provider-boundary redaction primitives (Phase 16, domain-core
// `ai.ts`) re-exported here so apps/mcp-server -- an external boundary
// exactly like Spensa's provider connection -- can apply the identical
// Privacy-Mode-safe representation to its own tool outputs, without
// needing to depend on @spencare/domain-core directly (which it
// architecturally could, since domain-core sits below domain-application,
// but re-exporting keeps "one place every AI-adjacent surface imports
// from" consistent with how toAiAccountSummaryInput/describeAmountForProvider
// are already re-exported here).
export {
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  calculateCreditUtilization,
  type PrivateAmount,
  type MaybePrivateAmount,
  type MaybePrivateRatio,
  type AiAccountSummaryInput,
  type AiAccountSummaryRedacted,
  type AiFinancialSnapshotInput,
  type AiFinancialSnapshotRedacted,
  type AiBudgetSummaryInput,
  type AiBudgetSummaryRedacted,
  type AiGoalSummaryInput,
  type AiGoalSummaryRedacted,
  type AiBillSummaryInput,
  type AiBillSummaryRedacted,
  type AiCashFlowSummaryInput,
  type AiCashFlowSummaryRedacted,
} from "@spencare/domain-core";

// Re-exported so apps/mcp-server (forbidden from importing
// packages/domain/infra or @supabase/supabase-js directly -- see
// mcp-architecture.md §6, testing-architecture.md §5, and this repo's own
// .dependency-cruiser.cjs "no-mcp-direct-database"/"no-mcp-direct-infra"
// rules) can still construct the one client it legitimately needs
// (Phase 18 locked decision #1's service-role AuthContext), the same way
// apps/web's own lib/supabase/service.ts already does.
export { createServiceRoleClient, type TypedSupabaseClient } from "@spencare/domain-infra";

export {
  beginGmailConnect,
  completeGmailConnect,
  getGmailStatus,
  disconnectGmail,
  MissingGmailOAuthConfigError,
  type GmailConnectInitiation,
  type CompleteGmailConnectInput,
} from "./commands/gmailConnection.js";

export { runGmailSync, safeSyncErrorMessage, type GmailSyncSummary } from "./commands/gmailSync.js";
export { runGmailSyncForAllConnectedUsers, type ScheduledSyncOutcome } from "./commands/gmailScheduledSync.js";

export {
  listGmailCandidatesQuery,
  getGmailCandidateQuery,
  editGmailCandidate,
  rejectGmailCandidate,
  markGmailCandidateMatchedExisting,
  acceptGmailCandidate,
  type EditGmailCandidateInput,
} from "./commands/gmailCandidates.js";

export {
  type GmailConnectionStatus,
  type GmailSyncStatus,
  type GmailCandidateRow,
  type GmailCandidateType,
  type GmailCandidateReviewStatus,
  type GmailCandidateDirection,
} from "@spencare/domain-infra";

export { exportUserData, type ExportBundle } from "./commands/exportData.js";
export { calculateNextOccurrence, FREQUENCY_LABELS, type GoalContributionFrequency } from "@spencare/domain-core";
export { deleteAccount, type DeleteAccountInput } from "./commands/deleteAccount.js";
export { checkRateLimit, RATE_LIMITS } from "./commands/rateLimit.js";

// Notification platform
export {
  markNotificationRead,
  markAllNotificationsRead,
  saveNotificationPreference,
  disconnectNotificationChannel,
  generateTelegramLinkToken,
} from "./commands/notifications.js";
export {
  listNotificationsQuery,
  getUnreadCountQuery,
  listChannelConnectionsQuery,
  getChannelConnectionQuery,
  listNotificationPreferencesQuery,
  type ListNotificationsOptions,
} from "./queries/notifications.js";
export {
  setCardPaymentSource,
  removeCardPaymentSource,
  listCardPaymentSources,
  type SetCardPaymentSourceInput,
  type RemoveCardPaymentSourceInput,
} from "./commands/creditCardPaymentSources.js";
export {
  composeNotificationMessage,
  type NotificationMessage,
  type NotificationEventType,
} from "./notifications/messageComposer.js";
export type {
  NotificationRow,
  NotificationDeliveryRow,
  CreateNotificationInput,
  NotificationSeverity,
  NotificationCategory,
  NotificationChannel,
  DeliveryStatus,
  ChannelConnectionRow,
  TelegramMetadata,
  SlackMetadata,
  NotificationPreferenceRow,
  UpsertPreferenceInput,
} from "@spencare/domain-infra";
export type {
  CreditCardPaymentSourceRow,
  CardPaymentReserveState,
  CardReserveDetail,
} from "@spencare/domain-infra";
export {
  listCommitments,
  listUpcoming,
  addCommitment,
  editCommitment,
  removeCommitment,
  payOccurrence,
  markOccurrencePaidManually,
  skipCommitmentOccurrence,
  reserveForOccurrence,
  pauseCommitment,
  resumeCommitment,
  getPlannedCommitmentById,
  getCommitmentOccurrence,
  type PlannedCommitmentRow,
  type PlannedCommitmentOccurrenceRow,
  type PlannedCommitmentOccurrenceWithCommitment,
} from "./queries/plannedCommitments.js";
export {
  listAllLoans,
  addLoan,
  editLoan,
  removeLoan,
  getLoanById,
  type LoanRow,
} from "./queries/loans.js";
export type {
  CommitmentStatus,
  CommitmentTenureType,
  CommitmentOccurrenceStatus,
  LoanType,
  LoanStatus,
} from "@spencare/domain-infra";

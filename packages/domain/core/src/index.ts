// NOTE: calculateSafeToSpend (api-architecture.md §8) is intentionally NOT
// implemented yet. It is step 8 in the approved implementation order
// (design-decision-gate.md §I), after Accounts (6) and Transactions (7) --
// neither of which are part of this Foundation batch either. Building it
// now would jump ahead of its dependencies. When that phase begins, it
// belongs here in packages/domain/core (pure, zero I/O) per the explicit
// "Safe to Spend" instruction: never in the UI, full test matrix before any
// feature screen depends on it.

export {
  Money,
  InvalidMoneyError,
  CurrencyMismatchError,
  type CurrencyCode,
  type MoneyJSON,
} from "./Money.js";

export {
  generateTotpEnrollment,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
  consumeBackupCode,
  type TotpEnrollment,
} from "./twoFactor.js";

export { sniffImageMimeType, type SniffedImageType } from "./fileSniff.js";

export {
  calculateBudgetUsage,
  lastDayOfMonth,
  addMonthsToPeriodStart,
  BUDGET_STATUS_THRESHOLDS,
  type BudgetStatus,
  type BudgetUsage,
} from "./budgets.js";

export {
  calculateSafeToSpend,
  type SafeToSpendState,
  type SafeToSpendContext,
  type SafeToSpendResult,
} from "./safeToSpend.js";

export { calculateGoalProgress, type GoalProgress, calculateGoalPaceStatus, type GoalPaceStatus } from "./goals.js";

export {
  calculateNextOccurrence,
  suggestContributionAmount,
  projectCompletionDate,
  FREQUENCY_LABELS,
  type GoalContributionFrequency,
  type GoalPlanStatus,
  type GoalContributionPlanRow,
} from "./goalContributionPlan.js";

export {
  ACCOUNT_CAPABILITIES,
  ACCOUNT_TYPE_LABELS,
  hasCapability,
  filterByCapability,
  getSpendableMinor,
  type AccountType,
  type AccountCapability,
} from "./accountCapabilities.js";

export { calculateNetWorth, type NetWorthInput, type NetWorthResult } from "./netWorth.js";

export {
  predictNextOccurrence,
  detectRecurring,
  type RecurrenceInterval,
  type RecurringSignalInput,
  type RecurringCandidate,
} from "./bills.js";

export {
  sniffStatementFileType,
  type SniffedStatementFileType,
  LOW_CONFIDENCE_THRESHOLD,
  normalizeStagedAmount,
  directionFromSignedAmount,
  directionFromDebitCredit,
  directionFromMarker,
  normalizeStagedDate,
  scoreConfidence,
  calculateDuplicateSignals,
  calculateImportSummary,
  type StagedTransactionType,
  type ConfidenceInput,
  type DuplicateCandidateInput,
  type ExistingTransactionForMatch,
  type DuplicateSignal,
  type ImportSummaryInput,
  type ImportSummary,
} from "./imports.js";

export { classifyEmailRelevance, isKnownFinancialSenderDomain, type EmailRelevance, type EmailRelevanceInput } from "./gmailClassification.js";

export {
  extractAmount,
  extractCardOrAccountLastFour,
  extractDirection,
  extractMerchant,
  extractItemName,
  extractDate,
  extractReferenceId,
  classifyCandidateType,
  type ExtractedAmount,
  type GmailCandidateType,
} from "./gmailExtraction.js";

export { scoreGmailConfidence, GMAIL_LOW_CONFIDENCE_THRESHOLD, type GmailConfidenceInput } from "./gmailConfidence.js";

export { findTransferPairs, type TransferMatchCandidate, type TransferPairMatch } from "./transferMatching.js";

export { matchGmailAccount, type AccountMatchCandidate, type GmailAccountMatchInput, type GmailAccountMatchResult } from "./gmailAccountMatching.js";

export {
  calculateCashFlowTotals,
  calculateCategoryBreakdown,
  comparePeriods,
  type CashFlowTransactionType,
  type CashFlowTransactionInput,
  type CashFlowTotals,
  type CashFlowBreakdownMode,
  type CategorySlice,
  type PeriodComparison,
} from "./cashFlow.js";

export { generateMcpToken, hashMcpToken } from "./mcpToken.js";

export {
  savingDatesForOccurrence,
  expectedReservedMinor,
  predictCommitmentNextOccurrence,
  projectOccurrenceDates,
  type PaymentFrequency,
} from "./commitments.js";

export { getTransactionDisplay, type TransactionDisplayFields } from "./transactionDisplay.js";

export {
  generateAuthorizationCode,
  hashAuthorizationCode,
  generateOAuthClientId,
  verifyPkceChallenge,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
} from "./oauth.js";

export {
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  describeAmountForProvider,
  redactFinancialText,
  calculateCreditUtilization,
  MAX_TOOL_CALL_DEPTH,
  MAX_CONTEXT_MESSAGE_COUNT,
  MAX_MESSAGE_LENGTH_CHARS,
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
} from "./ai.js";

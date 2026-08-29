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

export { calculateGoalProgress, type GoalProgress } from "./goals.js";

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

export {
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  describeAmountForProvider,
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

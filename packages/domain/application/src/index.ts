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

export type {
  ImportBatchRow,
  ImportSourceType,
  ImportStatus,
  StagedTransactionRow,
} from "@spencare/domain-infra";
export type { StagedTransactionType, ImportSummary, DuplicateSignal } from "@spencare/domain-core";
export { LOW_CONFIDENCE_THRESHOLD } from "@spencare/domain-core";

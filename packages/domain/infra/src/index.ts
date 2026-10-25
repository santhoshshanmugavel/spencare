export type { Database } from "./generated/database.types.js";
export { createServiceRoleClient, type TypedSupabaseClient } from "./supabaseClients.js";
export { encryptSecret, decryptSecret, MissingEncryptionKeyError } from "./crypto.js";
export * from "./profilesRepo.js";
export * from "./securitySettingsRepo.js";
export * from "./avatarStorageRepo.js";
export * from "./accountsRepo.js";
export * from "./transactionsRepo.js";
export * from "./budgetsRepo.js";
export * from "./goalsRepo.js";
export * from "./goalContributionPlansRepo.js";
export * from "./goalImageStorageRepo.js";
export * from "./planImageStorageRepo.js";
export * from "./billsRepo.js";
export * from "./importsRepo.js";
export * from "./importStagedTransactionsRepo.js";
export * from "./importStorageRepo.js";
export * from "./statementParsers/registry.js";
export * from "./aiConversationsRepo.js";
export * from "./aiProviderCredentialsRepo.js";
export * from "./pendingConfirmationsRepo.js";
export * from "./mcpSessionsRepo.js";
export * from "./oauthRepo.js";
export * from "./gmailApiClient.js";
export * from "./gmailConnectionsRepo.js";
export * from "./gmailFinancialCandidatesRepo.js";
export * from "./accountDeletionRepo.js";
export * from "./rateLimitRepo.js";
export * from "./notificationsRepo.js";
export * from "./channelConnectionsRepo.js";
export * from "./notificationPreferencesRepo.js";
export * from "./vehiclesRepo.js";
export * from "./vehiclePhotoStorageRepo.js";
export * from "./creditCardPaymentSourcesRepo.js";
export * from "./financialPlansRepo.js";
export {
  createPlannedCommitment,
  updatePlannedCommitment,
  deletePlannedCommitment,
  getPlannedCommitment,
  listPlannedCommitments,
  listUpcomingOccurrences,
  getCommitmentReservedTotal,
  markOccurrencePaid,
  markOccurrencePaidNoTransaction,
  skipOccurrence,
  updateOccurrenceReserve,
  setCommitmentStatus,
  getOccurrence,
  callPayCommitmentOccurrenceAtomic,
  insertPlannedCommitmentOccurrence,
  type CommitmentStatus,
  type CommitmentTenureType,
  type CommitmentOccurrenceStatus,
  type PlannedCommitmentRow,
  type PlannedCommitmentOccurrenceRow,
  type PlannedCommitmentOccurrenceWithCommitment,
  type CreatePlannedCommitmentPatch,
  type UpdatePlannedCommitmentPatch,
} from "./plannedCommitmentsRepo.js";
export {
  listEpfoLedgerEntries,
  type ListEpfoLedgerFilter,
} from "./epfoLedgerRepo.js";

export {
  callCreateEpfoAccount,
  callAddEpfoEmployment,
  callEndEpfoEmployment,
  callUpsertEpfoContributionProfile,
  callRecordEpfoContribution,
  callCorrectEpfoBalance,
  listEpfoEmployments,
  listEpfoContributionProfiles,
  type EpfoEmploymentRow,
  type EpfoContributionProfileRow,
  type CreateEpfoAccountInput,
  type AddEpfoEmploymentInput,
  type UpsertEpfoContributionProfileInput,
  type RecordEpfoContributionInput,
  type CorrectEpfoBalanceInput,
  type ConfirmEpfoPassbookBatchResult,
  callConfirmEpfoPassbookBatch,
} from "./epfoRepo.js";

// ATC Phase 2
export {
  insertCaptureEvent,
  updateCaptureEventStatus,
  listPendingCaptureEvents,
  upsertDeviceRegistration,
  getActiveDeviceRegistration,
  listDeviceRegistrations,
  revokeDeviceRegistration,
  type CaptureSource,
  type CaptureProcessingStatus,
  type CaptureEventRow,
  type DeviceRegistrationRow,
  type InsertCaptureEventInput,
  type UpsertDeviceRegistrationInput,
} from "./captureEventsRepo.js";

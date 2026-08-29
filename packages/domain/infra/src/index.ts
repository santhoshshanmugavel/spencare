export type { Database } from "./generated/database.types.js";
export { createServiceRoleClient, type TypedSupabaseClient } from "./supabaseClients.js";
export { encryptSecret, decryptSecret, MissingEncryptionKeyError } from "./crypto.js";
export * from "./profilesRepo.js";
export * from "./securitySettingsRepo.js";
export * from "./avatarStorageRepo.js";
// transactionsRepo.js is already committed (Phase 8, b321ef5) -- re-exported
// here because Phase 15's detectDuplicates command has a genuine, real
// dependency on `listTransactions` to compare staged rows against a
// user's existing transactions. This does not pull in any Phase 7-13 code
// that isn't already committed; it only exposes an already-existing,
// already-shipped capability that this phase legitimately needs.
export * from "./transactionsRepo.js";
export * from "./importsRepo.js";
export * from "./importStagedTransactionsRepo.js";
export * from "./importStorageRepo.js";
export * from "./statementParsers/registry.js";

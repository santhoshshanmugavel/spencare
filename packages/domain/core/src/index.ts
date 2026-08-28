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

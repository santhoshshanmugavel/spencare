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

export { getProfile } from "./queries/getProfile.js";
export { getProfileForDisplay, type ProfileForDisplay } from "./queries/getProfileForDisplay.js";
export { getSecurityStatus } from "./queries/getSecurityStatus.js";

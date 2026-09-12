"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import {
  confirmTotpEnrollment,
  disableTwoFactor,
  getProfile,
  getSecurityStatus,
  regenerateBackupCodes,
  removeAvatar,
  startTotpEnrollment,
  updateAvatar,
  updateProfile,
  updatePrivacyMode,
  createMcpSession,
  listMcpSessions,
  revokeMcpSession,
  beginGmailConnect,
  getGmailStatus,
  disconnectGmail,
  runGmailSync,
  listGmailCandidatesQuery,
  acceptGmailCandidate,
  rejectGmailCandidate,
  markGmailCandidateMatchedExisting,
  editGmailCandidate,
  MissingGmailOAuthConfigError,
  listAccounts,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  exportUserData,
  deleteAccount,
  type AuthContext,
  type McpScope,
  type GmailCandidateReviewStatus,
  type EditGmailCandidateInput,
  type DeleteAccountInput,
  type UpdateCategoryInput,
  type DeleteCategoryInput,
} from "@spencare/domain-application";
import type { ProfileUpdateInput, UpdatePrivacyModeInput } from "@spencare/validation";
import { connectProvider, switchProvider, updateProviderKey, disconnectProvider, getProviderStatus } from "@spencare/ai";
import type { ConnectProviderInput, SwitchProviderInput, UpdateProviderKeyInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { requestOrigin } from "@/lib/request-origin";

/** Every settings action resolves AuthContext from the verified session -- never a client-supplied user id (system model §22). */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function getProfileAction() {
  const ctx = await requireAuthContext();
  return getProfile(ctx);
}

export async function getSecurityStatusAction() {
  const ctx = await requireAuthContext();
  return getSecurityStatus(ctx);
}

export async function updateProfileAction(input: ProfileUpdateInput) {
  const ctx = await requireAuthContext();
  const result = await updateProfile.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

/**
 * Phase 32 -- the single entry point every Privacy Mode control calls
 * (nav rail toggle, Settings > Privacy). `revalidatePath("/", "layout")`
 * invalidates the ROOT layout and everything under it -- deliberate,
 * since privacy_mode_enabled is read by ~10 different routes (Home, Cash
 * Flow and its 4 sub-routes, Goals, Accounts, ...) and hand-listing every
 * one here would silently rot the day a new masked page is added. This
 * is the one action in the product that intentionally invalidates
 * everything, because Privacy Mode is the one setting that legitimately
 * affects everything.
 */
export async function updatePrivacyModeAction(input: UpdatePrivacyModeInput) {
  const ctx = await requireAuthContext();
  const result = await updatePrivacyMode.execute(ctx, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateAvatarAction(formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("avatar");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "no_file", message: "Choose an image first." } };
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const result = await updateAvatar.execute(ctx, {
    fileBytes,
    declaredMimeType: file.type,
  });
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

export async function removeAvatarAction() {
  const ctx = await requireAuthContext();
  const result = await removeAvatar.execute(ctx, {});
  if (result.ok) revalidatePath("/settings/profile");
  return result;
}

export async function startTotpEnrollmentAction() {
  const ctx = await requireAuthContext();
  const result = await startTotpEnrollment.execute(ctx, {});
  if (!result.ok) return result;
  const qrCodeDataUrl = await QRCode.toDataURL(result.value.otpAuthUri, { margin: 1, width: 220 });
  return { ok: true as const, value: { ...result.value, qrCodeDataUrl } };
}

export async function confirmTotpEnrollmentAction(code: string) {
  const ctx = await requireAuthContext();
  const result = await confirmTotpEnrollment.execute(ctx, { code });
  if (result.ok) revalidatePath("/settings/security");
  return result;
}

export async function disableTwoFactorAction(code: string) {
  const ctx = await requireAuthContext();
  const result = await disableTwoFactor.execute(ctx, { code });
  if (result.ok) revalidatePath("/settings/security");
  return result;
}

export async function regenerateBackupCodesAction(code: string) {
  const ctx = await requireAuthContext();
  return regenerateBackupCodes.execute(ctx, { code });
}

/**
 * BYO AI provider settings (Phase 17). Every action here resolves
 * AuthContext from the verified session exactly like every action above
 * -- no client-supplied user id, no exception for credential-bearing
 * inputs. The plaintext API key passed into `connectProviderAction`/
 * `switchProviderAction`/`updateProviderKeyAction` is used once, server-
 * side, to validate-then-encrypt-then-store; none of these actions ever
 * return it (or the encrypted form) back to the caller -- only the safe
 * `AiProviderStatus` shape (provider, keyLastFour, isActive,
 * lastValidatedAt, lastValidationError).
 */
export async function getProviderStatusAction() {
  const ctx = await requireAuthContext();
  return getProviderStatus(ctx);
}

export async function connectProviderAction(input: ConnectProviderInput) {
  const ctx = await requireAuthContext();
  const result = await connectProvider(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function switchProviderAction(input: SwitchProviderInput) {
  const ctx = await requireAuthContext();
  const result = await switchProvider(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function updateProviderKeyAction(input: UpdateProviderKeyInput) {
  const ctx = await requireAuthContext();
  const result = await updateProviderKey(ctx, input);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}

export async function disconnectProviderAction() {
  const ctx = await requireAuthContext();
  await disconnectProvider(ctx);
  revalidatePath("/settings/ai");
  revalidatePath("/spensa");
}

/**
 * MCP session management (Phase 18). `createMcpSessionAction` is the ONLY
 * place a plaintext MCP token ever exists outside the user's own copy of
 * it -- it crosses the Server Action boundary exactly once, in the
 * response to this one call, and is never returned by
 * `listMcpSessionsAction` or persisted anywhere in plaintext.
 */
export async function createMcpSessionAction(input: { clientName: string; scopes: McpScope[] }) {
  const ctx = await requireAuthContext();
  const result = await createMcpSession(ctx, input);
  revalidatePath("/settings/mcp");
  return result;
}

export async function listMcpSessionsAction() {
  const ctx = await requireAuthContext();
  return listMcpSessions(ctx);
}

export async function revokeMcpSessionAction(sessionId: string) {
  const ctx = await requireAuthContext();
  await revokeMcpSession(ctx, sessionId);
  revalidatePath("/settings/mcp");
}

/**
 * Gmail financial ingestion (Phase 19). Every action resolves AuthContext
 * from the verified session exactly like every action above -- no
 * exception for Gmail's OAuth-adjacent actions. `beginGmailConnectAction`
 * is a DEDICATED flow from Google Sign-In (locked decision #5): it never
 * touches Supabase Auth, only Google's own OAuth endpoints via
 * `domain-application`'s `beginGmailConnect`/`completeGmailConnect`.
 */
const GMAIL_OAUTH_STATE_COOKIE = "spencare_gmail_oauth_state";

export async function beginGmailConnectAction(): Promise<void> {
  await requireAuthContext();
  const redirectUri = `${await requestOrigin()}/auth/gmail/callback`;

  let initiation: { authUrl: string; state: string } | null;
  try {
    initiation = beginGmailConnect(redirectUri);
  } catch (e) {
    const message = e instanceof MissingGmailOAuthConfigError ? "Gmail isn't configured in this environment yet." : "Couldn't start connecting Gmail.";
    redirect(`/settings/gmail?error=${encodeURIComponent(message)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, initiation.state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(initiation.authUrl);
}

export async function getGmailStatusAction() {
  const ctx = await requireAuthContext();
  return getGmailStatus(ctx);
}

export async function disconnectGmailAction() {
  const ctx = await requireAuthContext();
  await disconnectGmail(ctx);
  revalidatePath("/settings/gmail");
}

export async function syncGmailNowAction() {
  const ctx = await requireAuthContext();
  const result = await runGmailSync(ctx);
  revalidatePath("/settings/gmail");
  return result;
}

export async function listGmailCandidatesAction(reviewStatus?: GmailCandidateReviewStatus) {
  const ctx = await requireAuthContext();
  return listGmailCandidatesQuery(ctx, reviewStatus);
}

export async function acceptGmailCandidateAction(candidateId: string) {
  const ctx = await requireAuthContext();
  const result = await acceptGmailCandidate(ctx, candidateId);
  revalidatePath("/settings/gmail");
  return result;
}

export async function rejectGmailCandidateAction(candidateId: string) {
  const ctx = await requireAuthContext();
  const result = await rejectGmailCandidate(ctx, candidateId);
  revalidatePath("/settings/gmail");
  return result;
}

export async function markGmailCandidateDuplicateAction(candidateId: string) {
  const ctx = await requireAuthContext();
  const result = await markGmailCandidateMatchedExisting(ctx, candidateId);
  revalidatePath("/settings/gmail");
  return result;
}

export async function editGmailCandidateAction(candidateId: string, input: EditGmailCandidateInput) {
  const ctx = await requireAuthContext();
  const result = await editGmailCandidate(ctx, candidateId, input);
  revalidatePath("/settings/gmail");
  return result;
}

export async function listAccountsForGmailReviewAction() {
  const ctx = await requireAuthContext();
  return listAccounts(ctx);
}

export async function listCategoriesForGmailReviewAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

/**
 * Data & Backup (Phase 20, SP-317/SP-319/SP-320). `exportUserDataAction`
 * returns the bundle directly to the browser for an immediate download --
 * a deliberate, disclosed deviation from SP-320's "email in 5-6 days"
 * async design (see exportData.ts's own doc comment for why: no
 * background-job/email-attachment infrastructure exists anywhere in this
 * deployment, and fabricating that promise would violate the same
 * "never claim infrastructure that doesn't exist" rule Phase 19 already
 * established for Gmail sync).
 *
 * `deleteAccountAction` signs the browser out immediately after a
 * successful deletion -- the `auth.users` row is gone, so any lingering
 * session cookie is already orphaned; `signOut()` clears it cleanly
 * rather than leaving the client to discover this on its next request.
 */
export async function exportUserDataAction() {
  const ctx = await requireAuthContext();
  return exportUserData(ctx);
}

export async function deleteAccountAction(input: DeleteAccountInput) {
  const supabase = await createServerSupabaseClient();
  const ctx = await requireAuthContext();
  const result = await deleteAccount.execute(ctx, input);
  if (result.ok) {
    await supabase.auth.signOut();
  }
  return result;
}

// ── Category management ────────────────────────────────────────────────────

export async function listCategoriesAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

export async function createCategoryAction(input: { name: string; icon: string | null }) {
  const ctx = await requireAuthContext();
  const result = await createCategory.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/categories");
  return result;
}

export async function updateCategoryAction(input: UpdateCategoryInput) {
  const ctx = await requireAuthContext();
  const result = await updateCategory.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/categories");
  return result;
}

export async function deleteCategoryAction(input: DeleteCategoryInput) {
  const ctx = await requireAuthContext();
  const result = await deleteCategory.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/categories");
  return result;
}

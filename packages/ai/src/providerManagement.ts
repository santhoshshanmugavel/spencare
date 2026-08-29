import {
  getActiveProviderStatus,
  replaceActiveCredential,
  disconnectCredential,
  encryptSecret,
  type AiProvider,
  type AiProviderStatus,
} from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import {
  connectProviderSchema,
  switchProviderSchema,
  validateProviderKeySchema,
  updateProviderKeySchema,
  type ConnectProviderInput,
  type SwitchProviderInput,
  type ValidateProviderKeyInput,
  type UpdateProviderKeyInput,
} from "@spencare/validation";
import { buildAdapterForProvider, isProviderImplemented } from "./resolver.js";

/**
 * BYO AI provider management commands (Phase 17; domain-architecture.md
 * §14's `connectProvider`/`validateProviderKey`/`switchProvider`/
 * `disconnectProvider` commands, `getActiveProvider`/`getProviderStatus`
 * queries).
 *
 * PACKAGE PLACEMENT: implemented in `packages/ai`, not
 * `packages/domain/application`, for the identical reason `sendMessage`/
 * `regenerateReply`/`getConversation`/`listConversations` were placed here
 * in Phase 16 -- every one of these functions must build a real
 * `AiProviderAdapter` to validate a key (`buildAdapterForProvider`,
 * `resolver.ts`), and `packages/ai` depends on `domain-application`
 * one-directionally; `domain-application` importing back from
 * `packages/ai` would be circular. This is a deliberate architectural
 * mirroring of that precedent, not a new pattern.
 */

export interface ProviderMutationError {
  code: "provider_not_implemented" | "invalid_key" | "provider_unavailable" | "no_active_provider";
  message: string;
}

export type ProviderMutationResult = { ok: true; status: AiProviderStatus } | { ok: false; error: ProviderMutationError };

/**
 * Maps a provider adapter's raw validation error into one of a small,
 * fixed set of safe, user-facing categories (Phase 17 locked requirement:
 * "map provider errors into safe user-facing error categories... never
 * expose raw provider exceptions"). The adapter's own `validateKey`
 * returns whatever raw detail the provider SDK gave it -- sanitizing
 * happens here, at the one place that detail becomes user-facing, never
 * inside the adapter itself.
 */
function toSafeValidationMessage(rawError: string | undefined): string {
  const text = (rawError ?? "").toLowerCase();
  if (text.includes("401") || text.includes("unauthorized") || text.includes("authentication") || text.includes("invalid")) {
    return "That API key appears to be invalid.";
  }
  if (text.includes("429") || text.includes("rate limit")) {
    return "The provider is rate-limiting validation attempts right now. Try again in a moment.";
  }
  if (text.includes("timeout") || text.includes("network") || text.includes("connection") || text.includes("econnrefused") || text.includes("5")) {
    return "Couldn't reach the provider right now. Try again shortly.";
  }
  return "That API key couldn't be validated.";
}

/**
 * The one place a candidate key is validated against the real provider,
 * then (only on success) written to the database via the atomic
 * replace-RPC. Shared by `connectProvider`/`switchProvider`/
 * `updateProviderKey` -- all three are the same operation
 * (security-architecture.md §7: "connectProvider on an already-connected
 * provider replaces the row"). The validation call and the database write
 * are never in the same transaction (the validation is a live network
 * call to a third party); ordering them "validate first, write second" is
 * what guarantees an invalid new key can never destroy a valid existing
 * one -- if validation fails, this returns before `replaceActiveCredential`
 * is ever called.
 */
async function validateAndReplace(ctx: AuthContext, provider: AiProvider, apiKey: string): Promise<ProviderMutationResult> {
  if (!isProviderImplemented(provider)) {
    return { ok: false, error: { code: "provider_not_implemented", message: `${provider} isn't available to connect yet.` } };
  }

  const adapter = buildAdapterForProvider(provider, apiKey);
  const validation = await adapter.validateKey(apiKey);
  if (!validation.valid) {
    return { ok: false, error: { code: "invalid_key", message: toSafeValidationMessage(validation.error) } };
  }

  const encrypted = encryptSecret(apiKey, process.env.AI_PROVIDER_ENCRYPTION_KEY);
  const keyLastFour = apiKey.slice(-4);
  await replaceActiveCredential(ctx.serviceRoleSupabase, ctx.userId, provider, encrypted, keyLastFour);

  const status = await getActiveProviderStatus(ctx.supabase, ctx.userId);
  if (!status) {
    // Unreachable in practice (the row was just written by the call
    // above) -- a defensive, honest failure rather than asserting a
    // fabricated status if it ever somehow were.
    return { ok: false, error: { code: "provider_unavailable", message: "Something went wrong saving your connection. Try again." } };
  }
  return { ok: true, status };
}

/** First-time connection, OR reconnecting a different/same provider -- see `validateAndReplace`'s doc comment. */
export async function connectProvider(ctx: AuthContext, rawInput: ConnectProviderInput): Promise<ProviderMutationResult> {
  const input = connectProviderSchema.parse(rawInput);
  return validateAndReplace(ctx, input.provider, input.apiKey);
}

/**
 * Identical mechanism to `connectProvider` -- exposed as its own named
 * export because domain-architecture.md §14 lists it as its own command,
 * and because the UI flow it backs (SP-315: picking a different provider
 * card while one is already connected) is conceptually distinct from
 * first-time connection even though the underlying operation is the same.
 */
export async function switchProvider(ctx: AuthContext, rawInput: SwitchProviderInput): Promise<ProviderMutationResult> {
  const input = switchProviderSchema.parse(rawInput);
  return validateAndReplace(ctx, input.provider, input.apiKey);
}

/**
 * Rotation (Phase 17 locked decision #2): the provider is never
 * re-specified -- it's read from the currently-active credential. Fails
 * cleanly with `no_active_provider` if there's nothing to rotate, rather
 * than silently connecting a new one under a guessed provider.
 */
export async function updateProviderKey(ctx: AuthContext, rawInput: UpdateProviderKeyInput): Promise<ProviderMutationResult> {
  const input = updateProviderKeySchema.parse(rawInput);
  const current = await getActiveProviderStatus(ctx.supabase, ctx.userId);
  if (!current) {
    return { ok: false, error: { code: "no_active_provider", message: "There's no connected provider to update. Connect one first." } };
  }
  return validateAndReplace(ctx, current.provider, input.apiKey);
}

/**
 * Pure validation, no persistence -- the same `validateAndReplace`
 * validation step, exposed standalone (domain-architecture.md §14 lists
 * `validateProviderKey` as its own command). `ctx` is required for
 * structural consistency with every other exported command in this
 * system (never callable without a resolved `AuthContext`), even though
 * this specific function performs no I/O of its own beyond the live
 * provider call.
 */
export async function validateProviderKey(_ctx: AuthContext, rawInput: ValidateProviderKeyInput): Promise<{ valid: boolean; error?: string }> {
  const input = validateProviderKeySchema.parse(rawInput);
  if (!isProviderImplemented(input.provider)) {
    return { valid: false, error: `${input.provider} isn't available to connect yet.` };
  }
  const adapter = buildAdapterForProvider(input.provider, input.apiKey);
  const result = await adapter.validateKey(input.apiKey);
  return result.valid ? result : { valid: false, error: toSafeValidationMessage(result.error) };
}

/**
 * `disconnectProvider` (Phase 17 locked decision #3): a complete purge,
 * never a deactivation -- see `disconnectCredential`'s own doc comment for
 * why this can only mean deleting the row.
 */
export async function disconnectProvider(ctx: AuthContext): Promise<void> {
  await disconnectCredential(ctx.supabase, ctx.userId);
}

export async function getActiveProvider(ctx: AuthContext): Promise<AiProvider | null> {
  const status = await getActiveProviderStatus(ctx.supabase, ctx.userId);
  return status?.provider ?? null;
}

export async function getProviderStatus(ctx: AuthContext): Promise<AiProviderStatus | null> {
  return getActiveProviderStatus(ctx.supabase, ctx.userId);
}

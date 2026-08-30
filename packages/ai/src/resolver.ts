import { decryptSecret, getActiveEncryptedCredential, type AiProvider } from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import { AnthropicAdapter } from "./adapters/anthropicAdapter.js";
import { OpenAiAdapter } from "./adapters/openaiAdapter.js";
import { GeminiAdapter } from "./adapters/geminiAdapter.js";
import { NoProviderConfiguredError, ProviderNotImplementedError } from "./provider.js";
import type { AiProviderAdapter } from "./provider.js";

/**
 * Providers with a real, working adapter today (Phase 17 locked decision
 * #1, extended Phase 29 Section 12-16: Spensa is now genuinely
 * provider-agnostic across Claude/OpenAI/Gemini, all built against the
 * SAME `AiProviderAdapter` interface -- no separate AI system per
 * provider). `openrouter`/`other` remain on the approved roster -- never
 * removed from the enum or the UI's provider list -- but are not
 * connectable yet. Adding one later is purely additive: a new adapter
 * file plus one entry here, no orchestration change (ADR-0008) -- exactly
 * how openai/google were just added, with zero changes to
 * orchestrator.ts, context.ts, or any tool.
 */
export const IMPLEMENTED_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai", "google"];

export function isProviderImplemented(provider: AiProvider): boolean {
  return IMPLEMENTED_PROVIDERS.includes(provider);
}

/**
 * Builds an adapter for an explicit `(provider, apiKey)` pair -- used by
 * `validateProviderKey`/`connectProvider`/`switchProvider`/
 * `updateProviderKey` (`providerManagement.ts`) to validate a NOT-yet-
 * stored candidate key against the real provider, before anything is
 * written to the database. Distinct from `resolveProviderAdapter` below,
 * which reads the user's already-stored, already-validated credential --
 * this function never touches the database at all.
 */
export function buildAdapterForProvider(provider: AiProvider, apiKey: string): AiProviderAdapter {
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter(apiKey);
    case "openai":
      return new OpenAiAdapter(apiKey);
    case "google":
      return new GeminiAdapter(apiKey);
    case "openrouter":
    case "other":
      throw new ProviderNotImplementedError(provider);
    default: {
      const exhaustive: never = provider;
      throw new ProviderNotImplementedError(String(exhaustive));
    }
  }
}

/**
 * Model Resolver (ai-architecture.md §1): reads the user's stored,
 * encrypted credential, decrypts it server-side ONLY (never returned,
 * never logged), and picks the matching adapter.
 */
export async function resolveProviderAdapter(ctx: AuthContext): Promise<AiProviderAdapter> {
  const credential = await getActiveEncryptedCredential(ctx.serviceRoleSupabase, ctx.userId);
  if (!credential) {
    throw new NoProviderConfiguredError();
  }

  // Named per-secret-type env var, matching the established
  // TOTP_ENCRYPTION_KEY convention (Phase 5) rather than sharing a key
  // across unrelated secret types.
  const apiKey = decryptSecret(credential.encryptedApiKey, process.env.AI_PROVIDER_ENCRYPTION_KEY);

  try {
    return buildAdapterForProvider(credential.provider, apiKey);
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      // A stored credential for a not-yet-implemented provider should be
      // structurally unreachable now (Phase 17's connect/switch flow
      // rejects unimplemented providers before ever writing one) -- this
      // branch exists only as a safe fallback, surfaced as the same
      // "provider unavailable" product state a genuine outage would show,
      // never a fabricated reply (ai-architecture.md §6).
      throw new NoProviderConfiguredError(err.message);
    }
    throw err;
  }
}

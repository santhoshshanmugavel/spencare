import { decryptSecret, getActiveEncryptedCredential } from "@spencare/domain-infra";
import type { AuthContext } from "@spencare/domain-application";
import { AnthropicAdapter } from "./adapters/anthropicAdapter.js";
import { NoProviderConfiguredError } from "./provider.js";
import type { AiProviderAdapter } from "./provider.js";

/**
 * Model Resolver (ai-architecture.md §1): reads the user's stored,
 * encrypted credential, decrypts it server-side ONLY (never returned,
 * never logged), and picks the matching adapter. Only OpenAI/Google/
 * OpenRouter adapters remain unbuilt this phase (Anthropic is the one real
 * adapter Phase 16 ships, per the authorization's "at least one real
 * adapter... if this can be done without requiring Phase 17 UI" -- adding
 * the remaining three later is purely additive, one new adapter file each,
 * no orchestration change, matching ADR-0008's own stated consequence).
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

  switch (credential.provider) {
    case "anthropic":
      return new AnthropicAdapter(apiKey);
    case "openai":
    case "google":
    case "openrouter":
    case "other":
      // Additive per ADR-0008 -- not built this phase (locked scope: one
      // real adapter). Surfacing this as the same "provider unavailable"
      // product state a genuine outage would show, never a fabricated
      // reply, per ai-architecture.md §6's failure-handling table.
      throw new NoProviderConfiguredError(
        `The ${credential.provider} provider isn't connected yet in this build. Connect Anthropic/Claude, or check back after this provider is added.`,
      );
    default: {
      const exhaustive: never = credential.provider;
      throw new NoProviderConfiguredError(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

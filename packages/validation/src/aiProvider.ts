import { z } from "zod";

/**
 * BYO AI provider roster (Phase 17 locked decision #1). Matches the
 * `ai_provider` DB enum exactly. Perplexity is explicitly NOT approved --
 * the enum is never modified to add it (screens show it; architecture
 * does not; the architecture's roster is authoritative here per CF-02's
 * stated default).
 */
export const AI_PROVIDERS = ["anthropic", "openai", "google", "openrouter", "other"] as const;
export type AiProviderValue = (typeof AI_PROVIDERS)[number];

/**
 * Real defect found live: a password-manager/autofill extension can
 * inject a masked placeholder (literal "•" bullet characters, U+2022)
 * into a `type="password"` field instead of the real typed value. A real
 * provider API key is always printable ASCII -- rejecting anything
 * outside that range here catches this (and any other non-key paste)
 * with a clear, actionable message, instead of the request reaching the
 * provider SDK and crashing deep inside the HTTP layer with a cryptic
 * "Cannot convert argument to a ByteString" error that gets misreported
 * as a generic provider failure.
 */
const apiKeySchema = z
  .string()
  .trim()
  .min(1, "Enter an API key.")
  .max(500, "That key is too long.")
  .regex(/^[\x20-\x7E]+$/, "That doesn't look like a valid API key -- it contains a character a real key wouldn't. If a password manager filled this field, clear it and paste the key manually.");

export const connectProviderSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: apiKeySchema,
});
export type ConnectProviderInput = z.infer<typeof connectProviderSchema>;

/**
 * Identical shape to `connectProviderSchema` -- switching to a different
 * provider and connecting for the first time are the same operation
 * (security-architecture.md §7). Kept as a separate export because
 * domain-architecture.md §14 names `switchProvider` as its own command.
 */
export const switchProviderSchema = connectProviderSchema;
export type SwitchProviderInput = ConnectProviderInput;

export const validateProviderKeySchema = connectProviderSchema;
export type ValidateProviderKeyInput = ConnectProviderInput;

/**
 * Rotation (Phase 17 locked decision #2): the provider is implied by the
 * currently-active credential, never re-specified by the caller -- only a
 * new key is needed.
 */
export const updateProviderKeySchema = z.object({
  apiKey: apiKeySchema,
});
export type UpdateProviderKeyInput = z.infer<typeof updateProviderKeySchema>;

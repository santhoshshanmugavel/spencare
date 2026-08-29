/**
 * Provider abstraction (ai-architecture.md §1). Orchestration code is
 * written entirely against this interface -- it never imports a provider
 * SDK directly (dependency-cruiser enforces this, see .dependency-
 * cruiser.cjs). Only files under `adapters/` may import a provider SDK.
 */

export type AiProviderName = "anthropic" | "openai" | "google" | "openrouter" | "other";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-shaped input description handed to the provider -- generated from the tool's Zod schema, never hand-duplicated. */
  inputSchema: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  /** Plain text for user/assistant turns; a tool-result payload for role "tool". */
  content: string;
  /** Present only on a "tool" role message -- which tool call this result answers. */
  toolCallId?: string;
}

export type AiEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "message_stop" }
  | { type: "error"; message: string };

export interface AiProviderAdapter {
  provider: AiProviderName;
  /**
   * `system` is a plain, provider-agnostic instruction string (Spensa
   * Spec v1.0 Correction Pass, Conflict-2: `systemPrompt.ts`'s
   * `SPENSA_SYSTEM_PROMPT`, defined once at the orchestration layer).
   * Each adapter maps it into whatever its own SDK expects -- Anthropic's
   * top-level `system` field, or a future OpenAI/Gemini/OpenRouter
   * adapter's own equivalent -- so the prompt content itself is never
   * duplicated per provider.
   */
  chat(messages: ChatMessage[], tools: ToolDefinition[], system?: string): AsyncIterable<AiEvent>;
  validateKey(key: string): Promise<{ valid: boolean; error?: string }>;
}

export class ProviderOutageError extends Error {
  constructor(message = "Spensa is unavailable right now.") {
    super(message);
    this.name = "ProviderOutageError";
  }
}

export class ProviderRateLimitError extends Error {
  constructor(message = "Spensa is receiving a lot of requests right now. Please wait a moment and try again.") {
    super(message);
    this.name = "ProviderRateLimitError";
  }
}

export class MalformedProviderResponseError extends Error {
  constructor(message = "Spensa received an unexpected response and could not continue.") {
    super(message);
    this.name = "MalformedProviderResponseError";
  }
}

export class NoProviderConfiguredError extends Error {
  constructor(message = "Connect an AI provider in Settings to start using Spensa.") {
    super(message);
    this.name = "NoProviderConfiguredError";
  }
}

/**
 * Distinct from `NoProviderConfiguredError` (which means "nothing is
 * connected yet"): this means "this specific provider isn't buildable yet
 * in this release" (Phase 17 locked decision #1 -- OpenAI/Google/
 * OpenRouter/Other are on the approved roster but have no adapter). Thrown
 * by `buildAdapterForProvider` for any provider outside
 * `IMPLEMENTED_PROVIDERS`; the settings UI must never let a user reach
 * this path at all (those roster cards are disabled/"Coming soon"), so
 * this is a defense-in-depth, server-side backstop, not the primary
 * enforcement.
 */
export class ProviderNotImplementedError extends Error {
  constructor(provider: string) {
    super(`${provider} isn't available to connect yet. Coming soon.`);
    this.name = "ProviderNotImplementedError";
  }
}

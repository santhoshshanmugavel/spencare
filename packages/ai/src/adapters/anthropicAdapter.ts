import Anthropic from "@anthropic-ai/sdk";
import {
  MalformedProviderResponseError,
  ProviderAuthenticationError,
  ProviderInvalidRequestError,
  ProviderModelNotFoundError,
  ProviderOutageError,
  ProviderPermissionError,
  ProviderRateLimitError,
} from "../provider.js";
import type { AiEvent, AiProviderAdapter, ChatMessage, ToolDefinition } from "../provider.js";

/**
 * The one file in this package allowed to import a provider SDK
 * (ai-architecture.md §1: "Spensa's core orchestration logic never
 * imports an Anthropic, OpenAI, Google, or OpenRouter SDK directly --
 * only the Provider Abstraction does"). Enforced by
 * .dependency-cruiser.cjs, not just this comment.
 */
export class AnthropicAdapter implements AiProviderAdapter {
  provider = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * A real defect found live: this used to catch every error type
   * (auth failure, unavailable model, network outage, rate limit -- see
   * `chat()`'s own taxonomy below, which this didn't share) into one
   * bucket and hand the raw SDK message straight to
   * `providerManagement.ts`'s `toSafeValidationMessage`, which classifies
   * by crude substring match ("invalid", "401", etc.). An `AuthenticationError`
   * genuinely contains those words -- but so does Anthropic's own
   * `invalid_request_error` type string, which is what a stale/renamed
   * model ID (unrelated to whether the key itself is valid) produces.
   * That collision reported a perfectly valid key as "invalid" while the
   * real fault was an outdated hardcoded model name. Now only a genuine
   * `Anthropic.AuthenticationError` is reported as a key problem; every
   * other error type is prefixed so it can never be mistaken for one.
   */
  async validateKey(key: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new Anthropic({ apiKey: key });
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return { valid: true };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return { valid: false, error: err.message };
      }
      const detail = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `provider_error (not a key problem): ${detail}` };
    }
  }

  async *chat(messages: ChatMessage[], tools: ToolDefinition[], system?: string): AsyncIterable<AiEvent> {
    try {
      const anthropicMessages = messages.map((m) => ({
        role: m.role === "tool" ? ("user" as const) : m.role,
        content: m.content,
      }));

      const anthropicTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));

      const stream = this.client.messages.stream({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          // Anthropic streams tool-call arguments incrementally; the SDK's
          // final message (below) carries the fully-assembled input, so
          // the incremental deltas here are intentionally not surfaced --
          // only the final, complete tool call is ever handed to
          // orchestration, never a partial/malformed argument object.
        }
      }

      const finalMessage = await stream.finalMessage();
      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          yield { type: "tool_call", id: block.id, name: block.name, arguments: block.input as Record<string, unknown> };
        }
      }
      yield { type: "message_stop" };
    } catch (err) {
      // Phase 27 §7: distinguish WHY the provider rejected the request --
      // never collapse a bad/revoked key, a permission/billing problem, a
      // missing model, and a genuinely malformed response into one
      // generic bucket. Anthropic's own SDK already exposes exactly this
      // status-code taxonomy as distinct classes; this just maps them
      // onto Spensa's provider-agnostic equivalents (provider.ts) rather
      // than inventing a new one.
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderRateLimitError();
      }
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderAuthenticationError(err.message);
      }
      if (err instanceof Anthropic.PermissionDeniedError) {
        throw new ProviderPermissionError(err.message);
      }
      if (err instanceof Anthropic.NotFoundError) {
        throw new ProviderModelNotFoundError(err.message);
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) {
        throw new ProviderInvalidRequestError(err.message);
      }
      if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
        throw new ProviderOutageError();
      }
      if (err instanceof Anthropic.APIError) {
        throw new MalformedProviderResponseError(err.message);
      }
      throw err;
    }
  }
}

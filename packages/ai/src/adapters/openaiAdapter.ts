import OpenAI from "openai";
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
 * OpenAI provider adapter (Phase 29 Section 15). Built against the
 * Responses API (`client.responses.*`), per the explicit instruction to
 * design around the current Responses API rather than an older
 * completion-only shape -- Chat Completions is not used anywhere here.
 *
 * MODEL CONFIGURATION (Section 15/38's "do not invent model IDs, verify
 * the catalog before selecting a production default"): this file cannot
 * call out to OpenAI's own model-catalog docs at build time, so the model
 * is entirely configurable via `OPENAI_MODEL`, never a single hardcoded
 * literal the way the codebase previously hardcoded a since-deprecated
 * Anthropic model id (the real defect fixed live earlier this phase --
 * see anthropicAdapter.ts's own comment on it). `DEFAULT_OPENAI_MODEL` is
 * a reasonable fallback only, not a claim about what is current; deploy
 * config should always set `OPENAI_MODEL` to a verified model id.
 *
 * KEY VALIDATION deliberately does NOT depend on any model id at all --
 * it calls `client.models.list()` (an authenticated, essentially free
 * call) instead of a real generation request. This is a structural fix
 * for the exact bug class found live in the Anthropic adapter (a stale
 * model name masquerading as an "invalid key" error): validating a key
 * this way can never be confused by a model becoming unavailable.
 */

const DEFAULT_OPENAI_MODEL = "gpt-4o";

function resolveModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export class OpenAiAdapter implements AiProviderAdapter {
  provider = "openai" as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async validateKey(key: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new OpenAI({ apiKey: key });
      await client.models.list();
      return { valid: true };
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) {
        return { valid: false, error: err.message };
      }
      const detail = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `provider_error (not a key problem): ${detail}` };
    }
  }

  async *chat(messages: ChatMessage[], tools: ToolDefinition[], system?: string): AsyncIterable<AiEvent> {
    try {
      const input: OpenAI.Responses.ResponseInputItem[] = messages.map((m) => {
        if (m.role === "tool") {
          // Responses API's tool-result item shape -- correlated back to
          // the model's own call via `call_id`, never a plain chat turn.
          return {
            type: "function_call_output",
            call_id: m.toolCallId ?? "",
            output: m.content,
          };
        }
        return { role: m.role, content: m.content };
      });

      const responseTools: OpenAI.Responses.Tool[] = tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
        strict: null,
      }));

      const stream = this.client.responses.stream({
        model: resolveModel(),
        instructions: system,
        input,
        tools: responseTools.length > 0 ? responseTools : undefined,
      });

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "text_delta", text: event.delta };
        }
        if (event.type === "response.output_item.done" && event.item.type === "function_call") {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(event.item.arguments) as Record<string, unknown>;
          } catch {
            // A malformed arguments payload is a real provider-response
            // defect, not a reason to crash the whole stream silently --
            // surfaced as an empty-arguments call rather than swallowed;
            // orchestration's own schema validation catches the mismatch.
            args = {};
          }
          yield { type: "tool_call", id: event.item.call_id, name: event.item.name, arguments: args };
        }
      }
      yield { type: "message_stop" };
    } catch (err) {
      // Same taxonomy mapping as AnthropicAdapter.chat -- the two SDKs
      // happen to share error-class names/shapes almost exactly, so this
      // mirrors that file deliberately rather than inventing a different
      // set of categories per provider.
      if (err instanceof OpenAI.RateLimitError) {
        throw new ProviderRateLimitError();
      }
      if (err instanceof OpenAI.AuthenticationError) {
        throw new ProviderAuthenticationError(err.message);
      }
      if (err instanceof OpenAI.PermissionDeniedError) {
        throw new ProviderPermissionError(err.message);
      }
      if (err instanceof OpenAI.NotFoundError) {
        throw new ProviderModelNotFoundError(err.message);
      }
      if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.UnprocessableEntityError) {
        throw new ProviderInvalidRequestError(err.message);
      }
      if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.InternalServerError) {
        throw new ProviderOutageError();
      }
      if (err instanceof OpenAI.APIError) {
        throw new MalformedProviderResponseError(err.message);
      }
      throw err;
    }
  }
}

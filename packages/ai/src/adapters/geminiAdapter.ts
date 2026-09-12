import { GoogleGenAI, ApiError } from "@google/genai";
import type { Content, Tool as GeminiTool } from "@google/genai";
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
 * Google Gemini provider adapter (Phase 29 Section 16), built against the
 * current unified `@google/genai` SDK (the maintained successor to the
 * deprecated `@google/generative-ai` package) -- `ai.models.*`, never the
 * older package.
 *
 * MODEL CONFIGURATION: same philosophy as openaiAdapter.ts -- entirely
 * configurable via `GEMINI_MODEL`, never a single hardcoded literal this
 * file asserts is "the current model." `DEFAULT_GEMINI_MODEL` is a
 * reasonable fallback only; deploy config should set `GEMINI_MODEL` to a
 * verified, currently-stable model id, never an experimental/preview one
 * as the production default (Section 16's explicit instruction).
 *
 * KEY VALIDATION uses `ai.models.list()` -- an authenticated call with no
 * dependency on any model id at all, the same structural fix
 * openaiAdapter.ts uses, for the same reason (a stale/unavailable model
 * name must never be misreported as an invalid key).
 */

// All Gemini model selection flows through resolveModel() -- the GEMINI_MODEL
// env var is the single override point for production deploys. The default
// is gemini-3.8-flash (GA, designed for agentic workflows, Phase 29 §6);
// override with GEMINI_MODEL to pin a specific model in production.
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

// Canonical model registry -- ordered by preference (most capable / most
// current first). This is the single source of truth for what Spensa
// supports; the adapter passes whatever resolveModel() returns directly
// to the API without further validation.
export const SUPPORTED_GEMINI_MODELS = [
  "gemini-3.8-flash",    // GA, agentic-optimised -- default
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

export type SupportedGeminiModel = (typeof SUPPORTED_GEMINI_MODELS)[number];

function resolveModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/** Gemini's API-level error only carries an HTTP status, not a typed subclass hierarchy the way Anthropic/OpenAI's SDKs do -- classified by status code onto the same provider-agnostic taxonomy every adapter maps onto. */
function classifyApiError(err: ApiError): Error {
  const status = err.status;
  if (status === 401) return new ProviderAuthenticationError(err.message);
  if (status === 403) return new ProviderPermissionError(err.message);
  if (status === 404) return new ProviderModelNotFoundError(err.message);
  if (status === 429) return new ProviderRateLimitError();
  if (status === 400 || status === 422) return new ProviderInvalidRequestError(err.message);
  if (status !== undefined && status >= 500) return new ProviderOutageError();
  return new MalformedProviderResponseError(err.message);
}

export class GeminiAdapter implements AiProviderAdapter {
  provider = "google" as const;
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async validateKey(key: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new GoogleGenAI({ apiKey: key });
      await client.models.list();
      return { valid: true };
    } catch (err) {
      if (err instanceof ApiError) {
        const { status, message } = err;
        // 401 = invalid key; 403 = key restricted/blocked; 400 = unrestricted
        // standard key rejected (Gemini stopped accepting them Sep 2026 --
        // users need an auth key from aistudio.google.com/api-keys).
        // All three mean "this key will not work" -- never tag as provider_error.
        if (status === 401 || status === 403 || status === 400) {
          return { valid: false, error: message };
        }
      }
      const detail = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `provider_error (not a key problem): ${detail}` };
    }
  }

  async *chat(messages: ChatMessage[], tools: ToolDefinition[], system?: string): AsyncIterable<AiEvent> {
    try {
      const contents: Content[] = messages.map((m) => {
        if (m.role === "tool") {
          // Correlated back to the model's own call by id, the same
          // id-only correlation Anthropic's tool_result and OpenAI's
          // function_call_output use -- Gemini's FunctionResponse
          // supports this directly (its own `name` field stays optional;
          // Spencare's ChatMessage never carries the original tool name).
          return {
            role: "user",
            parts: [{ functionResponse: { id: m.toolCallId, name: m.toolName ?? m.toolCallId ?? "tool", response: { output: m.content } } }],
          };
        }
        return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
      });

      const geminiTools: GeminiTool[] =
        tools.length > 0
          ? [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema as never,
                })),
              },
            ]
          : [];

      const stream = await this.client.models.generateContentStream({
        model: resolveModel(),
        contents,
        config: {
          systemInstruction: system,
          tools: geminiTools.length > 0 ? geminiTools : undefined,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          yield { type: "text_delta", text };
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.functionCall) {
            yield {
              type: "tool_call",
              // Gemini's FunctionCall.id is optional (unlike Anthropic's
              // tool_use.id/OpenAI's call_id, always present) -- falls
              // back to the name when the model doesn't supply one,
              // never a fabricated/random id that couldn't be correlated
              // back on the next turn.
              id: part.functionCall.id ?? part.functionCall.name ?? "unknown",
              name: part.functionCall.name ?? "unknown",
              arguments: part.functionCall.args ?? {},
            };
          }
        }
      }
      yield { type: "message_stop" };
    } catch (err) {
      if (err instanceof ApiError) {
        throw classifyApiError(err);
      }
      throw err;
    }
  }
}

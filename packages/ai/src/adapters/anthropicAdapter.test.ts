import { describe, expect, it, vi } from "vitest";
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

/**
 * Phase 27 §7 -- the exact taxonomy the mandate calls out: 401/403/404/
 * 429/5xx/timeout must never collapse into one generic "invalid API key"
 * bucket. This file lives inside `adapters/` (the one directory
 * .dependency-cruiser.cjs allows to import a provider SDK directly), so
 * it constructs REAL `Anthropic.*Error` instances -- the same shapes the
 * SDK itself throws -- rather than hand-rolled fakes that might drift
 * from the real error shape.
 */

const FAKE_HEADERS = new Headers();

function mockStreamThrows(error: unknown) {
  return {
    messages: {
      stream: vi.fn(() => {
        throw error;
      }),
      create: vi.fn(async () => {
        throw error;
      }),
    },
  };
}

async function drainChat(adapterClient: unknown) {
  const { AnthropicAdapter } = await import("./anthropicAdapter.js");
  // The real constructor just builds a plain client object (no network
  // call) -- no need to mock the SDK module at all. Swapping `client`
  // afterward with a fake that throws is enough to exercise the real
  // `chat()` classification logic against a controlled failure.
  const adapter = new AnthropicAdapter("test-key");
  (adapter as unknown as { client: unknown }).client = adapterClient;
  const events = [];
  for await (const event of adapter.chat([{ role: "user", content: "hi" }], [], undefined)) {
    events.push(event);
  }
  return events;
}

describe("AnthropicAdapter.chat -- error classification (Phase 27 §7)", () => {
  it("maps a 401 to ProviderAuthenticationError, not the generic bucket", async () => {
    const err = new Anthropic.AuthenticationError(401, { type: "authentication_error", message: "invalid x-api-key" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderAuthenticationError);
  });

  it("maps a 403 to ProviderPermissionError", async () => {
    const err = new Anthropic.PermissionDeniedError(403, { type: "permission_error", message: "insufficient permissions for this model" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderPermissionError);
  });

  it("maps a 404 to ProviderModelNotFoundError", async () => {
    const err = new Anthropic.NotFoundError(404, { type: "not_found_error", message: "model: claude-not-a-real-model not found" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderModelNotFoundError);
  });

  it("maps a 422 to ProviderInvalidRequestError", async () => {
    const err = new Anthropic.UnprocessableEntityError(422, { type: "invalid_request_error", message: "invalid request body" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderInvalidRequestError);
  });

  it("maps a 400 to ProviderInvalidRequestError", async () => {
    const err = new Anthropic.BadRequestError(400, { type: "invalid_request_error", message: "malformed request" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderInvalidRequestError);
  });

  it("maps a 429 to ProviderRateLimitError", async () => {
    const err = new Anthropic.RateLimitError(429, { type: "rate_limit_error", message: "rate limited" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderRateLimitError);
  });

  it("maps a 5xx to ProviderOutageError", async () => {
    const err = new Anthropic.InternalServerError(500, { type: "api_error", message: "internal error" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderOutageError);
  });

  it("maps a connection/timeout failure to ProviderOutageError", async () => {
    const err = new Anthropic.APIConnectionTimeoutError({ message: "Request timed out." });
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(ProviderOutageError);
  });

  it("maps an unrecognized APIError subtype to the generic MalformedProviderResponseError, never silently swallowed", async () => {
    const err = new Anthropic.ConflictError(409, { type: "conflict_error", message: "conflict" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(MalformedProviderResponseError);
  });

  it("re-throws a completely non-API error unchanged, never miscategorized", async () => {
    const err = new TypeError("something unrelated broke");
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow(TypeError);
  });

  it("preserves Anthropic's own error message on the categorized error, never a generic placeholder", async () => {
    const err = new Anthropic.AuthenticationError(401, { type: "authentication_error", message: "invalid x-api-key provided" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockStreamThrows(err))).rejects.toThrow("invalid x-api-key provided");
  });
});

import { describe, expect, it, vi } from "vitest";
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

/**
 * Same taxonomy-completeness bar as anthropicAdapter.test.ts (Phase 27
 * §7): 401/403/404/429/5xx/timeout must never collapse into one generic
 * "invalid API key" bucket. Lives inside `adapters/` (the one directory
 * allowed to import a provider SDK directly), constructing REAL
 * `OpenAI.*Error` instances rather than hand-rolled fakes.
 */

const FAKE_HEADERS = new Headers();

function mockResponsesThrows(error: unknown) {
  return {
    responses: {
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
  const { OpenAiAdapter } = await import("./openaiAdapter.js");
  const adapter = new OpenAiAdapter("test-key");
  (adapter as unknown as { client: unknown }).client = adapterClient;
  const events = [];
  for await (const event of adapter.chat([{ role: "user", content: "hi" }], [], undefined)) {
    events.push(event);
  }
  return events;
}

describe("OpenAiAdapter.chat — error classification", () => {
  it("maps a 401 to ProviderAuthenticationError", async () => {
    const err = new OpenAI.AuthenticationError(401, { type: "authentication_error", message: "invalid api key" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(ProviderAuthenticationError);
  });

  it("maps a 403 to ProviderPermissionError", async () => {
    const err = new OpenAI.PermissionDeniedError(403, { type: "permission_error", message: "no access" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(ProviderPermissionError);
  });

  it("maps a 404 to ProviderModelNotFoundError", async () => {
    const err = new OpenAI.NotFoundError(404, { type: "not_found_error", message: "model not found" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(ProviderModelNotFoundError);
  });

  it("maps a 400/422 to ProviderInvalidRequestError", async () => {
    const err400 = new OpenAI.BadRequestError(400, { type: "invalid_request_error", message: "bad request" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err400))).rejects.toThrow(ProviderInvalidRequestError);
    const err422 = new OpenAI.UnprocessableEntityError(422, { type: "invalid_request_error", message: "unprocessable" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err422))).rejects.toThrow(ProviderInvalidRequestError);
  });

  it("maps a 429 to ProviderRateLimitError", async () => {
    const err = new OpenAI.RateLimitError(429, { type: "rate_limit_error", message: "rate limited" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(ProviderRateLimitError);
  });

  it("maps a 5xx / connection failure to ProviderOutageError", async () => {
    const err = new OpenAI.InternalServerError(500, { type: "server_error", message: "internal error" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(ProviderOutageError);
  });

  it("maps an unrecognized APIError subtype to MalformedProviderResponseError, never silently swallowed", async () => {
    const err = new OpenAI.ConflictError(409, { type: "conflict_error", message: "conflict" }, undefined, FAKE_HEADERS);
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(MalformedProviderResponseError);
  });

  it("re-throws a completely non-API error unchanged", async () => {
    const err = new TypeError("something unrelated broke");
    await expect(drainChat(mockResponsesThrows(err))).rejects.toThrow(TypeError);
  });
});

describe("OpenAiAdapter.validateKey — does not conflate a provider/model problem with an invalid key", () => {
  it("reports valid:true when models.list succeeds", async () => {
    const listSpy = vi.spyOn(OpenAI.Models.prototype, "list").mockResolvedValue({} as never);
    const { OpenAiAdapter } = await import("./openaiAdapter.js");
    const result = await new OpenAiAdapter("test-key").validateKey("test-key");
    expect(result).toEqual({ valid: true });
    listSpy.mockRestore();
  });

  it("reports valid:false with the real message for a genuine AuthenticationError", async () => {
    const err = new OpenAI.AuthenticationError(401, { type: "authentication_error", message: "invalid api key" }, undefined, FAKE_HEADERS);
    const listSpy = vi.spyOn(OpenAI.Models.prototype, "list").mockRejectedValue(err);
    const { OpenAiAdapter } = await import("./openaiAdapter.js");
    const result = await new OpenAiAdapter("test-key").validateKey("test-key");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid api key/);
    listSpy.mockRestore();
  });

  it("a non-auth failure is tagged as NOT a key problem, never misreported as an invalid key", async () => {
    const err = new OpenAI.InternalServerError(500, { type: "server_error", message: "temporary outage" }, undefined, FAKE_HEADERS);
    const listSpy = vi.spyOn(OpenAI.Models.prototype, "list").mockRejectedValue(err);
    const { OpenAiAdapter } = await import("./openaiAdapter.js");
    const result = await new OpenAiAdapter("test-key").validateKey("test-key");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/provider_error \(not a key problem\)/);
    listSpy.mockRestore();
  });

  it("validation never depends on a model id at all -- it never calls responses.create/stream", async () => {
    const listSpy = vi.spyOn(OpenAI.Models.prototype, "list").mockResolvedValue({} as never);
    const createSpy = vi.spyOn(OpenAI.Responses.prototype, "create");
    const { OpenAiAdapter } = await import("./openaiAdapter.js");
    await new OpenAiAdapter("test-key").validateKey("test-key");
    expect(createSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
    createSpy.mockRestore();
  });
});

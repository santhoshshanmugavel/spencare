import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@google/genai";
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
 * Gemini's SDK has one generic `ApiError` (status-code-carrying), not a
 * typed subclass hierarchy like Anthropic/OpenAI -- these tests exercise
 * `classifyApiError`'s own status-code mapping onto the same
 * provider-agnostic taxonomy every adapter shares (Phase 27 §7).
 *
 * `@google/genai`'s `models.list`/`models.generateContentStream` are
 * bound instance methods, not real prototype methods (confirmed live --
 * unlike `OpenAI.Models.prototype.list`, `Models.prototype.list` is
 * `undefined`), so they can't be `vi.spyOn`'d the way
 * openaiAdapter.test.ts does. The whole `GoogleGenAI` constructor is
 * mocked instead, returning a controllable fake per test; `ApiError`
 * passes through as the real class so tests construct genuine error
 * instances, never hand-rolled fakes that could drift from the real shape.
 */
let modelsImpl: { list?: () => unknown; generateContentStream?: () => unknown } = {};

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ApiError: actual.ApiError,
    GoogleGenAI: vi.fn().mockImplementation(() => ({ models: modelsImpl })),
  };
});

function apiError(status: number, message: string): ApiError {
  return new ApiError({ status, message });
}

async function drainChat(generateContentStreamImpl: () => unknown) {
  modelsImpl = { generateContentStream: generateContentStreamImpl };
  const { GeminiAdapter } = await import("./geminiAdapter.js");
  const adapter = new GeminiAdapter("test-key");
  const events = [];
  for await (const event of adapter.chat([{ role: "user", content: "hi" }], [], undefined)) {
    events.push(event);
  }
  return events;
}

describe("GeminiAdapter.chat — error classification", () => {
  it("maps a 401 to ProviderAuthenticationError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(401, "bad key");
      }),
    ).rejects.toThrow(ProviderAuthenticationError);
  });

  it("maps a 403 to ProviderPermissionError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(403, "no access");
      }),
    ).rejects.toThrow(ProviderPermissionError);
  });

  it("maps a 404 to ProviderModelNotFoundError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(404, "model not found");
      }),
    ).rejects.toThrow(ProviderModelNotFoundError);
  });

  it("maps a 400/422 to ProviderInvalidRequestError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(400, "bad request");
      }),
    ).rejects.toThrow(ProviderInvalidRequestError);
    await expect(
      drainChat(async () => {
        throw apiError(422, "unprocessable");
      }),
    ).rejects.toThrow(ProviderInvalidRequestError);
  });

  it("maps a 429 to ProviderRateLimitError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(429, "rate limited");
      }),
    ).rejects.toThrow(ProviderRateLimitError);
  });

  it("maps a 5xx to ProviderOutageError", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(503, "unavailable");
      }),
    ).rejects.toThrow(ProviderOutageError);
  });

  it("maps an unrecognized status to MalformedProviderResponseError, never silently swallowed", async () => {
    await expect(
      drainChat(async () => {
        throw apiError(418, "teapot");
      }),
    ).rejects.toThrow(MalformedProviderResponseError);
  });

  it("re-throws a completely non-API error unchanged", async () => {
    await expect(
      drainChat(async () => {
        throw new TypeError("something unrelated broke");
      }),
    ).rejects.toThrow(TypeError);
  });
});

describe("GeminiAdapter.validateKey — does not conflate a provider/model problem with an invalid key", () => {
  async function validate(listImpl: () => unknown) {
    modelsImpl = { list: listImpl };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    return new GeminiAdapter("test-key").validateKey("test-key");
  }

  it("reports valid:true when models.list succeeds", async () => {
    const result = await validate(async () => ({}));
    expect(result).toEqual({ valid: true });
  });

  it("reports valid:false with the real message for a genuine 401", async () => {
    const result = await validate(async () => {
      throw apiError(401, "bad key");
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("bad key");
  });

  it("a non-auth failure is tagged as NOT a key problem, never misreported as an invalid key", async () => {
    const result = await validate(async () => {
      throw apiError(500, "temporary outage");
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/provider_error \(not a key problem\)/);
  });

  it("validation never depends on a model id at all -- it never calls generateContentStream", async () => {
    const generateSpy = vi.fn();
    modelsImpl = { list: async () => ({}), generateContentStream: generateSpy };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    await new GeminiAdapter("test-key").validateKey("test-key");
    expect(generateSpy).not.toHaveBeenCalled();
  });
});

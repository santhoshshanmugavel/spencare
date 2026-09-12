import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
import type { ToolDefinition } from "../provider.js";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelsImpl: { list?: (opts?: any) => unknown; generateContentStream?: (opts?: any) => unknown } = {};

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

// Helper: build a fake async-iterable stream of chunks
function fakeStream(chunks: unknown[]) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
  };
}

describe("GeminiAdapter.chat — model resolution", () => {
  const origEnv = process.env.GEMINI_MODEL;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = origEnv;
    vi.resetModules();
  });

  it("passes the GEMINI_MODEL env var as the model id when set", async () => {
    process.env.GEMINI_MODEL = "gemini-3.7-flash";
    let capturedModel: string | undefined;
    modelsImpl = {
      generateContentStream: async (opts: { model?: string }) => {
        capturedModel = opts.model;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], [])) { /* drain */ }
    expect(capturedModel).toBe("gemini-3.7-flash");
  });

  it("falls back to gemini-3.8-flash when GEMINI_MODEL is unset", async () => {
    delete process.env.GEMINI_MODEL;
    let capturedModel: string | undefined;
    modelsImpl = {
      generateContentStream: async (opts: { model?: string }) => {
        capturedModel = opts.model;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], [])) { /* drain */ }
    expect(capturedModel).toBe("gemini-3.8-flash");
  });

  it("trims whitespace from GEMINI_MODEL and never passes a blank override", async () => {
    process.env.GEMINI_MODEL = "   ";
    let capturedModel: string | undefined;
    modelsImpl = {
      generateContentStream: async (opts: { model?: string }) => {
        capturedModel = opts.model;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], [])) { /* drain */ }
    expect(capturedModel).toBe("gemini-3.8-flash");
  });
});

describe("GeminiAdapter.chat — streaming and message construction", () => {
  beforeEach(() => { vi.resetModules(); });

  it("yields text_delta for each chunk that has text", async () => {
    modelsImpl = {
      generateContentStream: async () =>
        fakeStream([
          { text: "Hello", candidates: [] },
          { text: " world", candidates: [] },
        ])(),
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    const events = [];
    for await (const e of adapter.chat([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === "text_delta")).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
    ]);
  });

  it("always yields message_stop as the final event", async () => {
    modelsImpl = {
      generateContentStream: async () => fakeStream([{ text: "done", candidates: [] }])(),
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    const events = [];
    for await (const e of adapter.chat([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }
    expect(events[events.length - 1]).toEqual({ type: "message_stop" });
  });

  it("skips chunks with no text and no functionCall without erroring", async () => {
    modelsImpl = {
      generateContentStream: async () =>
        fakeStream([
          { text: null, candidates: [] },
          { text: "real", candidates: [] },
        ])(),
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    const events = [];
    for await (const e of adapter.chat([{ role: "user", content: "hi" }], [])) {
      events.push(e);
    }
    expect(events.filter((e) => e.type === "text_delta")).toEqual([{ type: "text_delta", text: "real" }]);
  });

  it("yields a tool_call event when the model returns a functionCall part", async () => {
    modelsImpl = {
      generateContentStream: async () =>
        fakeStream([
          {
            text: null,
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { id: "call-1", name: "proposeAddExpense", args: { amount: 50 } } },
                  ],
                },
              },
            ],
          },
        ])(),
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    const events = [];
    for await (const e of adapter.chat([{ role: "user", content: "add 50" }], [])) {
      events.push(e);
    }
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({
      type: "tool_call",
      id: "call-1",
      name: "proposeAddExpense",
      arguments: { amount: 50 },
    });
  });

  it("falls back to name when functionCall.id is absent", async () => {
    modelsImpl = {
      generateContentStream: async () =>
        fakeStream([
          {
            text: null,
            candidates: [
              {
                content: {
                  parts: [
                    { functionCall: { id: undefined, name: "myTool", args: {} } },
                  ],
                },
              },
            ],
          },
        ])(),
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    const events = [];
    for await (const e of adapter.chat([{ role: "user", content: "call" }], [])) {
      events.push(e);
    }
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({ id: "myTool" });
  });

  it("maps user messages to role:user and assistant messages to role:model", async () => {
    let capturedContents: unknown[] | undefined;
    modelsImpl = {
      generateContentStream: async (opts: { contents?: unknown[] }) => {
        capturedContents = opts.contents;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    for await (const _ of adapter.chat(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        { role: "user", content: "follow-up" },
      ],
      [],
    )) { /* drain */ }
    expect(capturedContents).toMatchObject([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ text: "hi there" }] },
      { role: "user", parts: [{ text: "follow-up" }] },
    ]);
  });

  it("maps tool-result messages to role:user with functionResponse parts", async () => {
    let capturedContents: unknown[] | undefined;
    modelsImpl = {
      generateContentStream: async (opts: { contents?: unknown[] }) => {
        capturedContents = opts.contents;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    for await (const _ of adapter.chat(
      [{ role: "tool", content: '{"ok":true}', toolCallId: "call-42" }],
      [],
    )) { /* drain */ }
    expect(capturedContents).toMatchObject([
      { role: "user", parts: [{ functionResponse: { id: "call-42" } }] },
    ]);
  });

  it("passes the system instruction in config when provided", async () => {
    let capturedConfig: unknown;
    modelsImpl = {
      generateContentStream: async (opts: { config?: unknown }) => {
        capturedConfig = opts.config;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], [], "You are Spensa.")) { /* drain */ }
    expect((capturedConfig as { systemInstruction?: string }).systemInstruction).toBe("You are Spensa.");
  });

  it("sends functionDeclarations when tools are provided", async () => {
    let capturedConfig: unknown;
    modelsImpl = {
      generateContentStream: async (opts: { config?: unknown }) => {
        capturedConfig = opts.config;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const tools: ToolDefinition[] = [
      { name: "myTool", description: "does a thing", inputSchema: { type: "object", properties: {} } },
    ];
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], tools)) { /* drain */ }
    const cfg = capturedConfig as { tools?: { functionDeclarations?: unknown[] }[] };
    expect(cfg.tools?.[0]?.functionDeclarations?.[0]).toMatchObject({ name: "myTool" });
  });

  it("sends no tools property when the tool list is empty", async () => {
    let capturedConfig: unknown;
    modelsImpl = {
      generateContentStream: async (opts: { config?: unknown }) => {
        capturedConfig = opts.config;
        return fakeStream([{ text: "ok", candidates: [] }])();
      },
    };
    const { GeminiAdapter } = await import("./geminiAdapter.js");
    const adapter = new GeminiAdapter("test-key");
    for await (const _ of adapter.chat([{ role: "user", content: "hi" }], [])) { /* drain */ }
    expect((capturedConfig as { tools?: unknown }).tools).toBeUndefined();
  });
});

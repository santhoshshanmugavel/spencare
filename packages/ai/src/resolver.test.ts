import { describe, expect, it } from "vitest";
import { buildAdapterForProvider, IMPLEMENTED_PROVIDERS, isProviderImplemented } from "./resolver.js";
import { ProviderNotImplementedError } from "./provider.js";
import { AnthropicAdapter } from "./adapters/anthropicAdapter.js";
import { OpenAiAdapter } from "./adapters/openaiAdapter.js";
import { GeminiAdapter } from "./adapters/geminiAdapter.js";

/**
 * Phase 29 Section 12-16: Spensa is now genuinely provider-agnostic --
 * Claude/OpenAI/Gemini all built against the exact same
 * `AiProviderAdapter` interface, with orchestration/context/tools never
 * touched to add the new two (ADR-0008's own promise, exercised for real
 * here rather than just asserted in a comment).
 */
describe("IMPLEMENTED_PROVIDERS / isProviderImplemented", () => {
  it("includes exactly Claude, OpenAI, and Gemini -- openrouter/other remain on the roster but unimplemented", () => {
    expect(IMPLEMENTED_PROVIDERS).toEqual(["anthropic", "openai", "google"]);
    expect(isProviderImplemented("anthropic")).toBe(true);
    expect(isProviderImplemented("openai")).toBe(true);
    expect(isProviderImplemented("google")).toBe(true);
    expect(isProviderImplemented("openrouter")).toBe(false);
    expect(isProviderImplemented("other")).toBe(false);
  });
});

describe("buildAdapterForProvider", () => {
  it("builds a real AnthropicAdapter for 'anthropic'", () => {
    expect(buildAdapterForProvider("anthropic", "sk-test")).toBeInstanceOf(AnthropicAdapter);
  });

  it("builds a real OpenAiAdapter for 'openai'", () => {
    expect(buildAdapterForProvider("openai", "sk-test")).toBeInstanceOf(OpenAiAdapter);
  });

  it("builds a real GeminiAdapter for 'google'", () => {
    expect(buildAdapterForProvider("google", "test-key")).toBeInstanceOf(GeminiAdapter);
  });

  it("still throws ProviderNotImplementedError for openrouter/other -- never silently returns something", () => {
    expect(() => buildAdapterForProvider("openrouter", "key")).toThrow(ProviderNotImplementedError);
    expect(() => buildAdapterForProvider("other", "key")).toThrow(ProviderNotImplementedError);
  });

  it("every implemented provider reports its own correct `.provider` name on the built adapter", () => {
    expect(buildAdapterForProvider("anthropic", "k").provider).toBe("anthropic");
    expect(buildAdapterForProvider("openai", "k").provider).toBe("openai");
    expect(buildAdapterForProvider("google", "k").provider).toBe("google");
  });
});

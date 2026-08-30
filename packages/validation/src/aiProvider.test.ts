import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, connectProviderSchema, switchProviderSchema, updateProviderKeySchema, validateProviderKeySchema } from "./aiProvider.js";

describe("AI_PROVIDERS — Phase 17 locked roster", () => {
  it("is exactly the approved five providers, never Perplexity", () => {
    expect(AI_PROVIDERS).toEqual(["anthropic", "openai", "google", "openrouter", "other"]);
    expect(AI_PROVIDERS).not.toContain("perplexity");
  });
});

describe("connectProviderSchema / switchProviderSchema / validateProviderKeySchema — identical shape", () => {
  it("are literally the same schema object (switch and connect are the same operation)", () => {
    expect(switchProviderSchema).toBe(connectProviderSchema);
    expect(validateProviderKeySchema).toBe(connectProviderSchema);
  });

  it("accepts every approved provider with a non-empty key", () => {
    for (const provider of AI_PROVIDERS) {
      expect(connectProviderSchema.safeParse({ provider, apiKey: "sk-test-key" }).success).toBe(true);
    }
  });

  it("rejects an unapproved provider value", () => {
    expect(connectProviderSchema.safeParse({ provider: "perplexity", apiKey: "sk-test" }).success).toBe(false);
  });

  it("rejects an empty or whitespace-only key", () => {
    expect(connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "" }).success).toBe(false);
    expect(connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "   " }).success).toBe(false);
  });

  it("rejects a missing provider", () => {
    expect(connectProviderSchema.safeParse({ apiKey: "sk-test" }).success).toBe(false);
  });

  it("rejects a key containing masked-password bullet characters -- the real bug a password-manager autofill caused live", () => {
    const result = connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "••••••••" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/doesn't look like a valid API key/i);
  });

  it("rejects a key containing any non-ASCII/control character, not just bullets", () => {
    expect(connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "sk-ant-–weird-dash" }).success).toBe(false);
    expect(connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "sk-ant-emoji-🔑" }).success).toBe(false);
  });

  it("still accepts a normal, real-shaped key", () => {
    expect(connectProviderSchema.safeParse({ provider: "anthropic", apiKey: "sk-ant-api03-fake-example-key-do-not-use-1234" }).success).toBe(true);
  });
});

describe("updateProviderKeySchema — rotation, no provider field", () => {
  it("accepts just a new key", () => {
    expect(updateProviderKeySchema.safeParse({ apiKey: "sk-new-key" }).success).toBe(true);
  });

  it("rejects an empty key", () => {
    expect(updateProviderKeySchema.safeParse({ apiKey: "" }).success).toBe(false);
  });

  it("does not require or accept a provider field to change what's being rotated", () => {
    const parsed = updateProviderKeySchema.parse({ apiKey: "sk-new-key", provider: "openai" });
    expect(parsed).toEqual({ apiKey: "sk-new-key" }); // extra field stripped, never used to change provider
  });
});

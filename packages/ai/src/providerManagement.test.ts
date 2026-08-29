import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-infra", () => ({
  getActiveProviderStatus: vi.fn(),
  replaceActiveCredential: vi.fn(),
  disconnectCredential: vi.fn(),
  encryptSecret: vi.fn(() => Buffer.from("encrypted")),
}));

vi.mock("./resolver.js", () => ({
  buildAdapterForProvider: vi.fn(),
  isProviderImplemented: vi.fn((provider: string) => provider === "anthropic"),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

function fakeAdapter(result: { valid: boolean; error?: string }) {
  return { provider: "anthropic", validateKey: vi.fn(async () => result), chat: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connectProvider — validate-then-write, never the reverse", () => {
  it("on a valid key, writes the credential and returns the new status", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: true }));
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValue({ provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "2026-09-03T00:00:00Z", lastValidationError: null } as never);

    const { connectProvider } = await import("./providerManagement.js");
    const result = await connectProvider(ctx, { provider: "anthropic", apiKey: "sk-real-key-1234" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(infra.replaceActiveCredential)).toHaveBeenCalledWith(ctx.serviceRoleSupabase, "u1", "anthropic", expect.anything(), "1234");
    if (result.ok) expect(result.status.provider).toBe("anthropic");
  });

  it("on an invalid key, never writes anything, and never returns the raw provider error text", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: false, error: "401 Unauthorized: api_key_here_leaked_xyz" }));

    const { connectProvider } = await import("./providerManagement.js");
    const result = await connectProvider(ctx, { provider: "anthropic", apiKey: "sk-bad-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_key");
      expect(result.error.message).not.toContain("api_key_here_leaked_xyz");
      expect(result.error.message).toBe("That API key appears to be invalid.");
    }
    expect(vi.mocked(infra.replaceActiveCredential)).not.toHaveBeenCalled();
  });

  it("rejects an unimplemented provider structurally, before ever building an adapter or persisting", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");

    const { connectProvider } = await import("./providerManagement.js");
    const result = await connectProvider(ctx, { provider: "openai", apiKey: "sk-openai-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("provider_not_implemented");
    expect(vi.mocked(resolver.buildAdapterForProvider)).not.toHaveBeenCalled();
    expect(vi.mocked(infra.replaceActiveCredential)).not.toHaveBeenCalled();
  });
});

describe("switchProvider — the same operation as connectProvider", () => {
  it("validates the new provider's key and replaces the credential exactly like connectProvider", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: true }));
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValue({ provider: "anthropic", keyLastFour: "5678", isActive: true, lastValidatedAt: "", lastValidationError: null } as never);

    const { switchProvider } = await import("./providerManagement.js");
    const result = await switchProvider(ctx, { provider: "anthropic", apiKey: "sk-new-key-5678" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(infra.replaceActiveCredential)).toHaveBeenCalledTimes(1);
  });
});

describe("updateProviderKey — rotation (the critical invariant: invalid new key never destroys the old one)", () => {
  it("fails cleanly with no_active_provider when nothing is connected, and never attempts to write", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValue(null);

    const { updateProviderKey } = await import("./providerManagement.js");
    const result = await updateProviderKey(ctx, { apiKey: "sk-new-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_active_provider");
    expect(vi.mocked(infra.replaceActiveCredential)).not.toHaveBeenCalled();
  });

  it("rotates using the CURRENTLY ACTIVE provider, never a provider supplied by the caller", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValue({ provider: "anthropic", keyLastFour: "1111", isActive: true, lastValidatedAt: "", lastValidationError: null } as never);
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: true }));

    const { updateProviderKey } = await import("./providerManagement.js");
    await updateProviderKey(ctx, { apiKey: "sk-rotated-key" });

    expect(vi.mocked(resolver.buildAdapterForProvider)).toHaveBeenCalledWith("anthropic", "sk-rotated-key");
  });

  it("THE CRITICAL INVARIANT: an invalid replacement key never calls replaceActiveCredential -- the existing valid credential is left completely untouched", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValue({ provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "2026-09-01T00:00:00Z", lastValidationError: null } as never);
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: false, error: "invalid api key" }));

    const { updateProviderKey } = await import("./providerManagement.js");
    const result = await updateProviderKey(ctx, { apiKey: "sk-bad-rotation-key" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_key");
    // The single most important assertion in this file: rotation failure
    // must never touch the database at all.
    expect(vi.mocked(infra.replaceActiveCredential)).not.toHaveBeenCalled();
  });

  it("on a valid rotation, replaces the credential with the SAME provider and the new key's last four digits", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(infra.getActiveProviderStatus)
      .mockResolvedValueOnce({ provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "", lastValidationError: null } as never)
      .mockResolvedValueOnce({ provider: "anthropic", keyLastFour: "9999", isActive: true, lastValidatedAt: "", lastValidationError: null } as never);
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: true }));

    const { updateProviderKey } = await import("./providerManagement.js");
    const result = await updateProviderKey(ctx, { apiKey: "sk-rotated-key-9999" });

    expect(vi.mocked(infra.replaceActiveCredential)).toHaveBeenCalledWith(ctx.serviceRoleSupabase, "u1", "anthropic", expect.anything(), "9999");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status.keyLastFour).toBe("9999");
  });
});

describe("validateProviderKey — pure validation, never persists", () => {
  it("returns valid: true without ever calling replaceActiveCredential", async () => {
    const infra = await import("@spencare/domain-infra");
    const resolver = await import("./resolver.js");
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: true }));

    const { validateProviderKey } = await import("./providerManagement.js");
    const result = await validateProviderKey(ctx, { provider: "anthropic", apiKey: "sk-key" });

    expect(result.valid).toBe(true);
    expect(vi.mocked(infra.replaceActiveCredential)).not.toHaveBeenCalled();
  });

  it("sanitizes the error message for an invalid key, never returning the raw provider exception", async () => {
    const resolver = await import("./resolver.js");
    vi.mocked(resolver.buildAdapterForProvider).mockReturnValue(fakeAdapter({ valid: false, error: "Anthropic API error: sk-ant-secret-detail-abc123" }));

    const { validateProviderKey } = await import("./providerManagement.js");
    const result = await validateProviderKey(ctx, { provider: "anthropic", apiKey: "sk-key" });

    expect(result.valid).toBe(false);
    expect(result.error).not.toContain("sk-ant-secret-detail-abc123");
  });

  it("returns a clear, safe message for an unimplemented provider, without building an adapter", async () => {
    const resolver = await import("./resolver.js");
    const { validateProviderKey } = await import("./providerManagement.js");
    const result = await validateProviderKey(ctx, { provider: "google", apiKey: "some-key" });

    expect(result.valid).toBe(false);
    expect(vi.mocked(resolver.buildAdapterForProvider)).not.toHaveBeenCalled();
  });
});

describe("disconnectProvider — complete purge", () => {
  it("calls disconnectCredential with the caller's own client and userId, never the service-role client", async () => {
    const infra = await import("@spencare/domain-infra");
    const { disconnectProvider } = await import("./providerManagement.js");
    await disconnectProvider(ctx);
    expect(vi.mocked(infra.disconnectCredential)).toHaveBeenCalledWith(ctx.supabase, "u1");
  });
});

describe("getActiveProvider / getProviderStatus", () => {
  it("getActiveProvider returns just the provider value, or null when nothing is connected", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValueOnce({ provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "", lastValidationError: null } as never);
    const { getActiveProvider } = await import("./providerManagement.js");
    expect(await getActiveProvider(ctx)).toBe("anthropic");

    vi.mocked(infra.getActiveProviderStatus).mockResolvedValueOnce(null);
    expect(await getActiveProvider(ctx)).toBeNull();
  });

  it("getProviderStatus returns the full safe status object unmodified", async () => {
    const infra = await import("@spencare/domain-infra");
    const status = { provider: "anthropic", keyLastFour: "1234", isActive: true, lastValidatedAt: "2026-09-03T00:00:00Z", lastValidationError: null };
    vi.mocked(infra.getActiveProviderStatus).mockResolvedValueOnce(status as never);
    const { getProviderStatus } = await import("./providerManagement.js");
    expect(await getProviderStatus(ctx)).toEqual(status);
  });
});

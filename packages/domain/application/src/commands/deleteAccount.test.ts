import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

vi.mock("@spencare/domain-infra", () => ({
  deleteOwnAccount: vi.fn(async () => undefined),
  deleteAllAvatarObjects: vi.fn(async () => undefined),
  deleteAllStatementObjectsForUser: vi.fn(async () => undefined),
}));
vi.mock("../queries/getSecurityStatus.js", () => ({
  getSecurityStatus: vi.fn(async () => ({ two_factor_enabled: false })),
}));
vi.mock("./enrollTwoFactor.js", () => ({
  verifyTwoFactorChallenge: { execute: vi.fn() },
}));

function ctx(): AuthContext {
  return { userId: "user-1", email: "user@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // `mockResolvedValue` set in one test overrides the factory's base
  // implementation permanently (clearAllMocks only clears call history) --
  // explicitly re-arm the default (2FA off) so no test leaks into another.
  const securityModule = await import("../queries/getSecurityStatus.js");
  vi.mocked(securityModule.getSecurityStatus).mockResolvedValue({ two_factor_enabled: false } as never);
});

describe("deleteAccount — typed-email confirmation gate (universal, no accidental invocation)", () => {
  it("rejects when the typed email doesn't match the authenticated user's own email", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    const { deleteAccount } = await import("./deleteAccount.js");

    const result = await deleteAccount.execute(ctx(), { confirmEmail: "someone-else@example.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("email_mismatch");
    expect(vi.mocked(domainInfra.deleteOwnAccount)).not.toHaveBeenCalled();
  });

  it("accepts a case-insensitive, whitespace-trimmed match", async () => {
    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "  USER@EXAMPLE.COM  " });
    expect(result.ok).toBe(true);
  });
});

describe("deleteAccount — 2FA gate for accounts with 2FA enabled", () => {
  it("rejects without a code when 2FA is enabled", async () => {
    const securityModule = await import("../queries/getSecurityStatus.js");
    vi.mocked(securityModule.getSecurityStatus).mockResolvedValue({ two_factor_enabled: true } as never);
    const domainInfra = await import("@spencare/domain-infra");

    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "user@example.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("2fa_required");
    expect(vi.mocked(domainInfra.deleteOwnAccount)).not.toHaveBeenCalled();
  });

  it("rejects an invalid 2FA code, never proceeding to delete", async () => {
    const securityModule = await import("../queries/getSecurityStatus.js");
    vi.mocked(securityModule.getSecurityStatus).mockResolvedValue({ two_factor_enabled: true } as never);
    const twoFactorModule = await import("./enrollTwoFactor.js");
    vi.mocked(twoFactorModule.verifyTwoFactorChallenge.execute).mockResolvedValue({ ok: false, error: { code: "invalid_2fa_code", message: "Invalid code." } });
    const domainInfra = await import("@spencare/domain-infra");

    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "user@example.com", twoFactorCode: "000000" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_2fa_code");
    expect(vi.mocked(domainInfra.deleteOwnAccount)).not.toHaveBeenCalled();
  });

  it("proceeds to delete after a valid 2FA code", async () => {
    const securityModule = await import("../queries/getSecurityStatus.js");
    vi.mocked(securityModule.getSecurityStatus).mockResolvedValue({ two_factor_enabled: true } as never);
    const twoFactorModule = await import("./enrollTwoFactor.js");
    vi.mocked(twoFactorModule.verifyTwoFactorChallenge.execute).mockResolvedValue({ ok: true, value: { method: "totp" } });
    const domainInfra = await import("@spencare/domain-infra");

    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "user@example.com", twoFactorCode: "123456" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.deleteOwnAccount)).toHaveBeenCalledWith({}, "user-1");
  });
});

describe("deleteAccount — happy path (no 2FA)", () => {
  it("cleans up Storage (avatars + statements) before deleting the account", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    const { deleteAccount } = await import("./deleteAccount.js");

    const c = ctx();
    await deleteAccount.execute(c, { confirmEmail: "user@example.com" });

    expect(vi.mocked(domainInfra.deleteAllAvatarObjects)).toHaveBeenCalledWith(c.serviceRoleSupabase, "user-1");
    expect(vi.mocked(domainInfra.deleteAllStatementObjectsForUser)).toHaveBeenCalledWith(c.serviceRoleSupabase, "user-1");
    expect(vi.mocked(domainInfra.deleteOwnAccount)).toHaveBeenCalledWith(c.supabase, "user-1");
  });

  it("a Storage cleanup failure never blocks the actual account deletion", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.deleteAllAvatarObjects).mockRejectedValue(new Error("storage hiccup"));

    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "user@example.com" });

    expect(result.ok).toBe(true);
    expect(vi.mocked(domainInfra.deleteOwnAccount)).toHaveBeenCalled();
  });

  it("surfaces a safe error, never a raw exception, when the deletion RPC itself fails", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    vi.mocked(domainInfra.deleteOwnAccount).mockRejectedValue(new Error("db exploded"));

    const { deleteAccount } = await import("./deleteAccount.js");
    const result = await deleteAccount.execute(ctx(), { confirmEmail: "user@example.com" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("delete_failed");
      expect(result.error.message).not.toContain("db exploded");
    }
  });
});

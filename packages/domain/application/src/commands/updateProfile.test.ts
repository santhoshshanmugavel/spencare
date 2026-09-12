import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";
import { updateProfile, updatePrivacyMode } from "./updateProfile.js";

let currentPrivacyModeEnabled = false;

vi.mock("@spencare/domain-infra", () => ({
  updateProfile: vi.fn(async (_client, userId: string, patch: Record<string, unknown>) => ({
    user_id: userId,
    display_name: patch.displayName ?? null,
    preferred_currency: patch.preferredCurrency ?? "INR",
    timezone: patch.timezone ?? "Asia/Kolkata",
    avatar_url: null,
    onboarding_completed_at: null,
    privacy_mode_enabled: currentPrivacyModeEnabled,
  })),
  updatePrivacyModeEnabled: vi.fn(async (_client, userId: string, enabled: boolean) => {
    currentPrivacyModeEnabled = enabled;
    return {
      user_id: userId,
      display_name: null,
      preferred_currency: "INR",
      timezone: "Asia/Kolkata",
      avatar_url: null,
      onboarding_completed_at: null,
      privacy_mode_enabled: enabled,
    };
  }),
}));

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

describe("updateProfile command", () => {
  it("rejects invalid input before touching the database", async () => {
    const result = await updateProfile.execute(makeCtx(), {
      preferredCurrency: "Rupee",
      timezone: "Asia/Kolkata",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("rejects an unrecognized timezone", async () => {
    const result = await updateProfile.execute(makeCtx(), {
      preferredCurrency: "INR",
      timezone: "Not/AZone",
    });
    expect(result.ok).toBe(false);
  });

  it("passes ctx.userId (never a client-supplied id) as the row to update", async () => {
    const ctx = makeCtx("user-b");
    const result = await updateProfile.execute(ctx, {
      displayName: "Santhosh",
      preferredCurrency: "INR",
      timezone: "Asia/Kolkata",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.user_id).toBe("user-b");
  });

  it("is marked non-consequential (profile update is Level 1 identity, not a financial mutation)", () => {
    expect(updateProfile.consequential).toBe(false);
  });
});

describe("updatePrivacyMode command", () => {
  it("rejects a non-boolean input before touching the database", async () => {
    const result = await updatePrivacyMode.execute(makeCtx(), { enabled: "yes" as unknown as boolean });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("turns Privacy Mode on, scoped to ctx.userId (never a client-supplied id)", async () => {
    const ctx = makeCtx("user-b");
    const result = await updatePrivacyMode.execute(ctx, { enabled: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.user_id).toBe("user-b");
      expect(result.value.privacy_mode_enabled).toBe(true);
    }
  });

  it("turns Privacy Mode back off", async () => {
    const result = await updatePrivacyMode.execute(makeCtx(), { enabled: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.privacy_mode_enabled).toBe(false);
  });

  it("surfaces a real error, never a silent failure, when the write throws", async () => {
    const { updatePrivacyModeEnabled } = await import("@spencare/domain-infra");
    vi.mocked(updatePrivacyModeEnabled).mockRejectedValueOnce(new Error("db down"));
    const result = await updatePrivacyMode.execute(makeCtx(), { enabled: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("update_failed");
  });

  it("is marked non-consequential (a display/masking preference, not a financial or destructive action)", () => {
    expect(updatePrivacyMode.consequential).toBe(false);
  });
});

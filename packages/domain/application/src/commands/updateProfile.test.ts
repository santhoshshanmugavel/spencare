import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";
import { updateProfile } from "./updateProfile.js";

vi.mock("@spencare/domain-infra", () => ({
  updateProfile: vi.fn(async (_client, userId: string, patch: Record<string, unknown>) => ({
    user_id: userId,
    display_name: patch.displayName ?? null,
    preferred_currency: patch.preferredCurrency ?? "INR",
    timezone: patch.timezone ?? "Asia/Kolkata",
    avatar_url: null,
    onboarding_completed_at: null,
    privacy_mode_enabled: false,
  })),
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

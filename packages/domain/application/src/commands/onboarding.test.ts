import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

interface FakeProfile {
  user_id: string;
  display_name: string | null;
  preferred_currency: string;
  timezone: string;
  avatar_url: string | null;
  onboarding_completed_at: string | null;
  privacy_mode_enabled: boolean;
  income_amount_minor: number | null;
  income_frequency: string | null;
  interested_categories: string[];
  interested_goal_types: string[];
}

let store: FakeProfile;

function resetStore(userId: string) {
  store = {
    user_id: userId,
    display_name: null,
    preferred_currency: "INR",
    timezone: "Asia/Kolkata",
    avatar_url: null,
    onboarding_completed_at: null,
    privacy_mode_enabled: false,
    income_amount_minor: null,
    income_frequency: null,
    interested_categories: [],
    interested_goal_types: [],
  };
}

vi.mock("@spencare/domain-infra", () => ({
  getOnboardingStatus: vi.fn(async () => ({
    completed: store.onboarding_completed_at !== null,
  })),
  getProfile: vi.fn(async () => ({ ...store })),
  saveOnboardingProgress: vi.fn(async (_client: unknown, _userId: string, patch: Record<string, unknown>) => {
    Object.assign(store, {
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.preferredCurrency !== undefined ? { preferred_currency: patch.preferredCurrency } : {}),
      ...(patch.incomeAmountMinor !== undefined ? { income_amount_minor: patch.incomeAmountMinor } : {}),
      ...(patch.incomeFrequency !== undefined ? { income_frequency: patch.incomeFrequency } : {}),
      ...(patch.interestedCategories !== undefined ? { interested_categories: patch.interestedCategories } : {}),
      ...(patch.interestedGoalTypes !== undefined ? { interested_goal_types: patch.interestedGoalTypes } : {}),
    });
    return { ...store };
  }),
  completeOnboardingWrite: vi.fn(async (_client: unknown, _userId: string, patch: Record<string, unknown>) => {
    if (store.onboarding_completed_at !== null) {
      throw new Error("no rows returned -- already completed");
    }
    Object.assign(store, {
      display_name: patch.displayName,
      preferred_currency: patch.preferredCurrency,
      income_amount_minor: patch.incomeAmountMinor ?? null,
      income_frequency: patch.incomeFrequency ?? null,
      interested_categories: patch.interestedCategories,
      interested_goal_types: patch.interestedGoalTypes,
      onboarding_completed_at: new Date().toISOString(),
    });
    return { ...store };
  }),
}));

const { saveOnboardingStep, completeOnboarding, getOnboardingStatusQuery } = await import(
  "./onboarding.js"
);

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(() => {
  resetStore("user-a");
});

describe("saveOnboardingStep", () => {
  it("persists a partial update without touching onboarding_completed_at", async () => {
    const result = await saveOnboardingStep.execute(makeCtx(), { displayName: "Santhosh" });
    expect(result.ok).toBe(true);
    expect(store.display_name).toBe("Santhosh");
    expect(store.onboarding_completed_at).toBeNull();
  });

  it("accepts an explicit skip (empty interests array)", async () => {
    const result = await saveOnboardingStep.execute(makeCtx(), { interestedCategories: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects a category outside the fixed list before touching the database", async () => {
    const result = await saveOnboardingStep.execute(makeCtx(), {
      interestedCategories: ["Not A Real Category" as never],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("is marked non-consequential", () => {
    expect(saveOnboardingStep.consequential).toBe(false);
  });
});

describe("getOnboardingStatusQuery", () => {
  it("reports incomplete for a fresh profile", async () => {
    const status = await getOnboardingStatusQuery(makeCtx());
    expect(status?.completed).toBe(false);
  });
});

describe("completeOnboarding", () => {
  it("rejects completion without the required display name", async () => {
    const result = await completeOnboarding.execute(makeCtx(), {
      displayName: "",
      preferredCurrency: "INR",
    });
    expect(result.ok).toBe(false);
    expect(store.onboarding_completed_at).toBeNull();
  });

  it("rejects completion without a currency", async () => {
    const result = await completeOnboarding.execute(makeCtx(), {
      displayName: "Santhosh",
      preferredCurrency: "",
    });
    expect(result.ok).toBe(false);
    expect(store.onboarding_completed_at).toBeNull();
  });

  it("atomically completes with the minimum required fields, defaulting skipped interests to empty arrays", async () => {
    const result = await completeOnboarding.execute(makeCtx(), {
      displayName: "Santhosh",
      preferredCurrency: "INR",
    });
    expect(result.ok).toBe(true);
    expect(store.onboarding_completed_at).not.toBeNull();
    expect(store.interested_categories).toEqual([]);
    expect(store.interested_goal_types).toEqual([]);
  });

  it("persists income/interests together with completion in the one write", async () => {
    const result = await completeOnboarding.execute(makeCtx(), {
      displayName: "Santhosh",
      preferredCurrency: "INR",
      incomeAmountMinor: 500000,
      incomeFrequency: "monthly",
      interestedCategories: ["Dining"],
      interestedGoalTypes: ["Emergency Fund"],
    });
    expect(result.ok).toBe(true);
    expect(store.income_amount_minor).toBe(500000);
    expect(store.interested_categories).toEqual(["Dining"]);
  });

  it("is idempotent: completing an already-completed profile returns success (the existing state), not an error", async () => {
    store.onboarding_completed_at = new Date().toISOString();
    store.display_name = "Already Done";

    const result = await completeOnboarding.execute(makeCtx(), {
      displayName: "Santhosh",
      preferredCurrency: "INR",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.display_name).toBe("Already Done");
  });

  it("is marked non-consequential (onboarding is Level 1 identity, not a financial mutation)", () => {
    expect(completeOnboarding.consequential).toBe(false);
  });
});

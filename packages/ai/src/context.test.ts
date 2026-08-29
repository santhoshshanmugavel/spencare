import { describe, expect, it, vi } from "vitest";
import { Money } from "@spencare/domain-core";

vi.mock("@spencare/domain-application", () => ({
  getSafeToSpend: vi.fn(),
  listAccounts: vi.fn(),
  listBudgetsWithUsage: vi.fn(),
  listCategories: vi.fn(),
  listGoals: vi.fn(),
  getUpcomingBills: vi.fn(),
  getCashFlowOverview: vi.fn(),
  getProfile: vi.fn(),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

async function setupMocks(privacyModeEnabled: boolean) {
  const mod = await import("@spencare/domain-application");
  vi.mocked(mod.getProfile).mockResolvedValue({ privacy_mode_enabled: privacyModeEnabled, preferred_currency: "INR" } as never);
  vi.mocked(mod.getSafeToSpend).mockResolvedValue({
    state: "balance_only",
    amount: Money.fromMinorUnits(500000n, "INR"),
    availableBalance: Money.fromMinorUnits(500000n, "INR"),
    goalReservedTotal: Money.zero("INR"),
    upcomingBillsTotal: Money.zero("INR"),
  } as never);
  vi.mocked(mod.listAccounts).mockResolvedValue([
    { id: "a1", user_id: "u1", type: "bank", name: "HDFC Bank", currency: "INR", balance_minor: 1000000, credit_limit_minor: null, credit_used_minor: null, market_value_minor: null, is_archived: false, created_at: "", updated_at: "" },
    { id: "cc1", user_id: "u1", type: "credit_card", name: "HDFC Credit Card", currency: "INR", balance_minor: 0, credit_limit_minor: 10000000, credit_used_minor: 3000000, market_value_minor: null, is_archived: false, created_at: "", updated_at: "" },
  ] as never);
  vi.mocked(mod.listBudgetsWithUsage).mockResolvedValue([
    { id: "b1", categoryId: "c1", periodStart: "2026-08-01", periodEnd: "2026-08-31", limitMinor: 600000, spentMinor: 470000, remainingMinor: 130000, percentUsed: 78.3, status: "near_limit" },
  ] as never);
  vi.mocked(mod.listCategories).mockResolvedValue([{ id: "c1", user_id: null, name: "Dining", icon: null, is_system: true }] as never);
  vi.mocked(mod.listGoals).mockResolvedValue([
    { id: "g1", user_id: "u1", name: "Emergency Fund", target_amount_minor: 1000000, target_date: null, funding_account_id: "a1", saved_amount_minor: 250000, status: "active", image_url: null, created_at: "", updated_at: "", completed_at: null, archived_at: null },
  ] as never);
  vi.mocked(mod.getUpcomingBills).mockResolvedValue([
    { id: "p1", bill_definition_id: "bd1", user_id: "u1", expected_date: "2026-09-15", expected_amount_minor: 49900, status: "open", matched_transaction_id: null, matched_at: null, created_at: "", updated_at: "", bill_definitions: { merchant_pattern: "Netflix", category_id: null, recurrence_interval: "monthly" }, matched_transaction: null },
  ] as never);
  vi.mocked(mod.getCashFlowOverview).mockResolvedValue({ incomeMinor: 5000000, expenseMinor: 4397200, netMinor: 602800 } as never);
  return mod;
}

describe("buildAiContext — Privacy Mode OFF", () => {
  it("returns real financial figures", async () => {
    await setupMocks(false);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    expect(context.financialSnapshot.safeToSpend.amount).toEqual({ amountMinor: 500000, currency: "INR" });
    const bankAccount = context.financialSnapshot.accounts[0]!;
    expect(bankAccount.spendable).toBe(true);
    if (bankAccount.spendable) expect(bankAccount.balance).toEqual({ amountMinor: 1000000, currency: "INR" });
    expect(context.budgets[0]!.limit).toEqual({ amountMinor: 600000, currency: "INR" });
    expect(context.userPreferences.privacyModeEnabled).toBe(false);
  });
});

describe("buildAiContext — credit_card accounts (Spensa Spec v1.0 correction, Conflict-1)", () => {
  it("includes credit_card accounts in the context, marked non-spendable, never using balance_minor", async () => {
    await setupMocks(false);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    const creditAccount = context.financialSnapshot.accounts.find((a) => a.type === "credit_card");
    expect(creditAccount).toBeDefined();
    expect(creditAccount!.spendable).toBe(false);
    if (creditAccount!.type === "credit_card") {
      expect(creditAccount!.creditLimit).toEqual({ amountMinor: 10000000, currency: "INR" });
      expect(creditAccount!.creditUsed).toEqual({ amountMinor: 3000000, currency: "INR" });
      expect(creditAccount!.availableCredit).toEqual({ amountMinor: 7000000, currency: "INR" });
      expect(creditAccount!.creditUtilization).toBe(0.3);
    }
  });

  it("redacts every credit figure under Privacy Mode, same as every other monetary field", async () => {
    await setupMocks(true);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    const creditAccount = context.financialSnapshot.accounts.find((a) => a.type === "credit_card");
    expect(creditAccount).toBeDefined();
    if (creditAccount!.type === "credit_card") {
      expect(creditAccount!.creditLimit).toEqual({ private: true });
      expect(creditAccount!.creditUsed).toEqual({ private: true });
      expect(creditAccount!.availableCredit).toEqual({ private: true });
      expect(creditAccount!.creditUtilization).toEqual({ private: true });
    }
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("10000000");
    expect(serialized).not.toContain("3000000");
  });
});

describe("buildAiContext — Privacy Mode ON (the critical security guarantee)", () => {
  it("the serialized AiContext contains NO real monetary figure anywhere", async () => {
    await setupMocks(true);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    const serialized = JSON.stringify(context);

    // Every real amountMinor seeded above must be absent from the
    // provider-bound context when Privacy Mode is on.
    expect(serialized).not.toMatch(/500000/); // Safe-to-Spend
    expect(serialized).not.toMatch(/1000000/); // account balance / goal target (both happen to be this value -- still must never appear)
    expect(serialized).not.toMatch(/600000|470000/); // budget limit/spent
    expect(serialized).not.toMatch(/250000/); // goal saved
    expect(serialized).not.toMatch(/49900/); // bill amount
    expect(serialized).not.toMatch(/5000000|4397200|602800/); // cash flow totals
    expect(serialized).not.toMatch(/10000000|3000000/); // credit limit/used (7000000 available happens to be checked in the dedicated credit describe block below)

    expect(context.financialSnapshot.safeToSpend.amount).toEqual({ private: true });
    expect(context.budgets[0]!.limit).toEqual({ private: true });
    expect(context.goals[0]!.targetAmount).toEqual({ private: true });
    expect(context.bills[0]!.expectedAmount).toEqual({ private: true });
    expect(context.cashFlow.income).toEqual({ private: true });
  });

  it("still exposes non-monetary state (account name, merchant, category, state) -- masks amounts, not activity", async () => {
    await setupMocks(true);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    expect(context.financialSnapshot.accounts[0]!.name).toBe("HDFC Bank");
    expect(context.bills[0]!.merchant).toBe("Netflix");
    expect(context.goals[0]!.name).toBe("Emergency Fund");
  });

  it("does not include a netWorth field (formula unresolved, never fabricated)", async () => {
    await setupMocks(true);
    const { buildAiContext } = await import("./context.js");
    const context = await buildAiContext(ctx);
    expect(context).not.toHaveProperty("netWorth");
    expect((context.financialSnapshot as unknown as Record<string, unknown>).netWorth).toBeUndefined();
  });
});

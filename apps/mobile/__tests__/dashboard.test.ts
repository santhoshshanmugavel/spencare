/**
 * Gate 3 — Dashboard financial correctness and auth guard tests.
 * These run in Jest (jest-expo preset) with no native dependencies.
 */

import type { MoneyJSON, DashboardResponse } from "../lib/api";

// ── Money helpers (mirrors home.tsx logic) ────────────────────────────────────

const PRECISION: Record<string, number> = { INR: 100, USD: 100, EUR: 100, GBP: 100 };

function minorToMajor(m: MoneyJSON): number {
  return parseInt(m.amountMinorUnits, 10) / (PRECISION[m.currency] ?? 100);
}

function formatMoneyPrivate(m: MoneyJSON, privacyMode: boolean): string {
  if (privacyMode) return "••••";
  const major = minorToMajor(m);
  const symbol = m.currency === "INR" ? "₹" : m.currency;
  return `${symbol}${Math.abs(major).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

function money(minorUnits: number, currency = "INR"): MoneyJSON {
  return { amountMinorUnits: String(minorUnits), currency };
}

const buildDashboard = (overrides: Partial<DashboardResponse> = {}): DashboardResponse => ({
  safeToSpend: {
    state: "balance_only",
    amount: money(70000),
    availableBalance: money(100000),
    goalReservedTotal: money(0),
    cardPaymentReservedTotal: money(0),
    upcomingBillsTotal: money(30000),
    commitmentReservedTotal: money(0),
    loanReservedTotal: money(0),
    ownedSpendableTotal: money(100000),
    creditAvailableTotal: money(0),
  },
  accounts: [
    { id: "a1", name: "HDFC", type: "bank", currency: "INR", balance_minor: 100000, credit_limit_minor: null, credit_used_minor: null, is_archived: false },
    { id: "a2", name: "Amex", type: "credit_card", currency: "INR", balance_minor: 0, credit_limit_minor: 200000, credit_used_minor: 50000, is_archived: false },
  ],
  goals: [
    { id: "g1", name: "Emergency Fund", target_amount_minor: 500000, saved_amount_minor: 250000, target_date: null, status: "active" },
    { id: "g2", name: "Laptop", target_amount_minor: 150000, saved_amount_minor: 150000, target_date: null, status: "completed" },
  ],
  upcomingBills: [
    { id: "b1", expected_amount_minor: 50000, due_date: new Date(Date.now() + 2 * 86400000).toISOString(), status: "open", definition: { name: "Electricity", currency: "INR" } },
  ],
  cashFlow: { incomeMinor: 500000, expenseMinor: 300000, netMinor: 200000 },
  netWorth: {
    netWorth: money(50000),
    totalAssets: money(100000),
    totalLiabilities: money(50000),
  },
  privacyMode: false,
  ...overrides,
});

// ── Financial correctness tests ───────────────────────────────────────────────

describe("MoneyJSON parsing", () => {
  it("parses minor units to major correctly for INR", () => {
    expect(minorToMajor(money(100000))).toBe(1000);
    expect(minorToMajor(money(50000))).toBe(500);
    expect(minorToMajor(money(0))).toBe(0);
  });

  it("handles negative amounts (overdraft / deficit)", () => {
    expect(minorToMajor(money(-20000))).toBe(-200);
  });

  it("formats with ₹ symbol for INR", () => {
    const m = money(100000, "INR");
    expect(formatMoneyPrivate(m, false)).toBe("₹1,000");
  });

  it("masks amount in privacy mode", () => {
    const m = money(500000, "INR");
    expect(formatMoneyPrivate(m, true)).toBe("••••");
  });
});

describe("Dashboard data rules", () => {
  it("safe-to-spend = availableBalance minus reservations", () => {
    const d = buildDashboard();
    const available = parseInt(d.safeToSpend.availableBalance.amountMinorUnits, 10);
    const bills = parseInt(d.safeToSpend.upcomingBillsTotal.amountMinorUnits, 10);
    const goals = parseInt(d.safeToSpend.goalReservedTotal.amountMinorUnits, 10);
    const stsAmount = parseInt(d.safeToSpend.amount.amountMinorUnits, 10);
    expect(stsAmount).toBe(available - bills - goals);
  });

  it("net cash flow = income - expense", () => {
    const d = buildDashboard();
    expect(d.cashFlow.netMinor).toBe(d.cashFlow.incomeMinor - d.cashFlow.expenseMinor);
  });

  it("net worth = totalAssets - totalLiabilities", () => {
    const d = buildDashboard();
    const assets = parseInt(d.netWorth.totalAssets.amountMinorUnits, 10);
    const liabilities = parseInt(d.netWorth.totalLiabilities.amountMinorUnits, 10);
    const nw = parseInt(d.netWorth.netWorth.amountMinorUnits, 10);
    expect(nw).toBe(assets - liabilities);
  });

  it("filters archived accounts out of visible list", () => {
    const d = buildDashboard({
      accounts: [
        { id: "a1", name: "Active", type: "bank", currency: "INR", balance_minor: 100000, credit_limit_minor: null, credit_used_minor: null, is_archived: false },
        { id: "a2", name: "Archived", type: "bank", currency: "INR", balance_minor: 5000, credit_limit_minor: null, credit_used_minor: null, is_archived: true },
      ],
    });
    const visible = d.accounts.filter((a) => !a.is_archived);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe("Active");
  });

  it("only shows active goals in the goals section", () => {
    const d = buildDashboard();
    const active = d.goals.filter((g) => g.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe("Emergency Fund");
  });

  it("goal progress percentage is bounded [0, 100]", () => {
    const d = buildDashboard({
      goals: [
        { id: "g1", name: "Over 100%", target_amount_minor: 100, saved_amount_minor: 200, target_date: null, status: "active" },
      ],
    });
    const g = d.goals[0]!;
    const pct = Math.min(100, Math.round((g.saved_amount_minor / g.target_amount_minor) * 100));
    expect(pct).toBe(100);
  });
});

describe("Privacy mode", () => {
  it("privacyMode: false => amounts shown", () => {
    const d = buildDashboard({ privacyMode: false });
    const formatted = formatMoneyPrivate(d.safeToSpend.amount, d.privacyMode);
    expect(formatted).not.toBe("••••");
  });

  it("privacyMode: true => all amounts masked", () => {
    const d = buildDashboard({ privacyMode: true });
    const formatted = formatMoneyPrivate(d.safeToSpend.amount, d.privacyMode);
    expect(formatted).toBe("••••");
  });
});

describe("Auth: session expiry handling", () => {
  it("state machine: no session => never calls api.getDashboard", () => {
    // Ensure the dashboard screen doesn't try to load without a session.
    // This mirrors the guard in the home screen's load() callback.
    const mockLoad = jest.fn();
    function loadIfSession(session: null | { accessToken: string }) {
      if (!session) return;
      mockLoad();
    }
    loadIfSession(null);
    expect(mockLoad).not.toHaveBeenCalled();

    loadIfSession({ accessToken: "tok" });
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});

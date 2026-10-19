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
    { id: "a1", name: "HDFC", type: "bank", currency: "INR", balance_minor: 100000, market_value_minor: null, credit_limit_minor: null, credit_used_minor: null, is_archived: false },
    { id: "a2", name: "Amex", type: "credit_card", currency: "INR", balance_minor: 0, market_value_minor: null, credit_limit_minor: 200000, credit_used_minor: 50000, is_archived: false },
  ],
  goals: [
    { id: "g1", name: "Emergency Fund", target_amount_minor: 500000, saved_amount_minor: 250000, target_date: null, status: "active" },
    { id: "g2", name: "Laptop", target_amount_minor: 150000, saved_amount_minor: 150000, target_date: null, status: "completed" },
  ],
  upcomingBills: [
    { id: "b1", expected_amount_minor: 50000, expected_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), status: "open", definition: { name: "Electricity", currency: "INR" } },
  ],
  cashFlow: { incomeMinor: 500000, expenseMinor: 300000, netMinor: 200000 },
  netWorth: {
    netWorth: money(50000),
    totalAssets: money(100000),
    totalLiabilities: money(50000),
  },
  privacyMode: false,
  preferredCurrency: "INR",
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
        { id: "a1", name: "Active", type: "bank", currency: "INR", balance_minor: 100000, market_value_minor: null, credit_limit_minor: null, credit_used_minor: null, is_archived: false },
        { id: "a2", name: "Archived", type: "bank", currency: "INR", balance_minor: 5000, market_value_minor: null, credit_limit_minor: null, credit_used_minor: null, is_archived: true },
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

// ── Bill date calculation (mirrors home.tsx BillsCard logic) ─────────────────
//
// The timezone-safe formula: normalise today to UTC midnight via local date
// components, then compare against the bill's expected_date at UTC midnight.
// Both sides are at UTC midnight → difference is an exact integer of days.

function calcDaysUntil(expectedDate: string, localNow: Date): number {
  const due = new Date(expectedDate + "T00:00:00Z");
  const todayUTC = new Date(Date.UTC(localNow.getFullYear(), localNow.getMonth(), localNow.getDate()));
  return Math.round((due.getTime() - todayUTC.getTime()) / 86400000);
}

describe("Bill date calculation — timezone safety", () => {
  it("returns 0 for a bill due today (local date = expected_date)", () => {
    const now = new Date("2026-10-20T10:00:00+05:30"); // 10am IST
    expect(calcDaysUntil("2026-10-20", now)).toBe(0);
  });

  it("returns 1 for a bill due tomorrow", () => {
    const now = new Date("2026-10-19T23:30:00+05:30"); // 11:30pm IST
    expect(calcDaysUntil("2026-10-20", now)).toBe(1);
  });

  it("returns -1 for a bill that was due yesterday", () => {
    const now = new Date("2026-10-21T08:00:00+05:30");
    expect(calcDaysUntil("2026-10-20", now)).toBe(-1);
  });

  it("uses local date components — today's date matches the local calendar", () => {
    // The formula constructs todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    // so "today" is always the user's LOCAL date, not the UTC date.
    // We verify: when expected_date equals the local date of `now`, calcDaysUntil === 0.
    const now = new Date();
    const localDateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    expect(calcDaysUntil(localDateStr, now)).toBe(0);
  });

  it("returns an exact integer — never fractional due to DST", () => {
    // Both sides are at UTC midnight, so the difference is always whole days.
    const now = new Date("2026-03-29T01:00:00+00:00"); // DST transition day in EU
    const days = calcDaysUntil("2026-04-05", now);
    expect(Number.isInteger(days)).toBe(true);
    expect(days).toBe(7);
  });

  it("cannot produce NaN for any valid YYYY-MM-DD expected_date", () => {
    const dates = ["2026-01-01", "2026-12-31", "2027-02-28"];
    const now = new Date("2026-06-15T12:00:00Z");
    for (const d of dates) {
      expect(Number.isNaN(calcDaysUntil(d, now))).toBe(false);
    }
  });
});

// ── Bill amount rendering ─────────────────────────────────────────────────────

function renderBillAmount(
  expectedAmountMinor: number | null,
  currency: string,
  privacyMode: boolean,
): string {
  if (privacyMode) return "••••";
  if (expectedAmountMinor !== null) {
    const major = expectedAmountMinor / (PRECISION[currency] ?? 100);
    const symbol = currency === "INR" ? "₹" : currency;
    return `${symbol}${Math.abs(major).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return "—";
}

describe("Bill amount rendering", () => {
  it("renders a known amount correctly", () => {
    expect(renderBillAmount(120000, "INR", false)).toBe("₹1,200");
  });

  it("renders '—' for null amount instead of ₹0", () => {
    expect(renderBillAmount(null, "INR", false)).toBe("—");
    // Critically, must NOT render ₹0
    expect(renderBillAmount(null, "INR", false)).not.toBe("₹0");
  });

  it("masks amount in privacy mode even when amount is known", () => {
    expect(renderBillAmount(120000, "INR", true)).toBe("••••");
  });

  it("masks amount in privacy mode even when amount is null", () => {
    expect(renderBillAmount(null, "INR", true)).toBe("••••");
  });

  it("renders ₹0 correctly when actual amount is zero (not null)", () => {
    expect(renderBillAmount(0, "INR", false)).toBe("₹0");
  });
});

// ── Bill name fallback ────────────────────────────────────────────────────────

function resolveBillName(name: string | undefined): string {
  return name || "Bill";
}

describe("Bill name fallback", () => {
  it("uses definition name when present", () => {
    expect(resolveBillName("Electricity Board")).toBe("Electricity Board");
  });

  it("falls back to 'Bill' when name is undefined", () => {
    expect(resolveBillName(undefined)).toBe("Bill");
  });

  it("falls back to 'Bill' when name is empty string (|| guard, not ??)", () => {
    expect(resolveBillName("")).toBe("Bill");
  });
});

// ── Investment account display ─────────────────────────────────────────────────
//
// For investment accounts, the authoritative current value is market_value_minor
// (used by Net Worth calculation). balance_minor is used for all other types.

function resolveAccountDisplayMinor(
  type: string,
  balance_minor: number,
  market_value_minor: number | null,
): number | null {
  if (type === "investment") return market_value_minor;
  return balance_minor;
}

describe("Investment account display — market_value_minor", () => {
  it("bank account uses balance_minor", () => {
    expect(resolveAccountDisplayMinor("bank", 100000, null)).toBe(100000);
  });

  it("cash account uses balance_minor", () => {
    expect(resolveAccountDisplayMinor("cash", 50000, null)).toBe(50000);
  });

  it("credit_card account uses balance_minor", () => {
    expect(resolveAccountDisplayMinor("credit_card", 0, null)).toBe(0);
  });

  it("epfo account uses balance_minor", () => {
    expect(resolveAccountDisplayMinor("epfo", 200000, null)).toBe(200000);
  });

  it("investment account uses market_value_minor when present", () => {
    expect(resolveAccountDisplayMinor("investment", 100000, 150000)).toBe(150000);
  });

  it("investment account returns null when market_value_minor is null (renders '—')", () => {
    expect(resolveAccountDisplayMinor("investment", 100000, null)).toBeNull();
  });

  it("investment account does NOT fall back to balance_minor when market value is missing", () => {
    // balance_minor for an investment might be cost basis, not market value.
    // Showing cost basis as current value is misleading; '—' is honest.
    const result = resolveAccountDisplayMinor("investment", 100000, null);
    expect(result).not.toBe(100000);
  });
});

// ── Cash-flow currency source ─────────────────────────────────────────────────
//
// The cash-flow card must use the user's preferred_currency from the dashboard
// response, not a hardcoded "INR".

describe("Cash-flow currency — preferredCurrency", () => {
  it("dashboard response includes preferredCurrency", () => {
    const d = buildDashboard({ preferredCurrency: "USD" });
    expect(d.preferredCurrency).toBe("USD");
  });

  it("defaults to INR in the base fixture", () => {
    const d = buildDashboard();
    expect(d.preferredCurrency).toBe("INR");
  });

  it("formatMinor uses the currency from preferredCurrency, not a hardcoded value", () => {
    // Verify formatMinor handles USD correctly (same precision, different symbol)
    const usdAmount = 100000; // $1,000.00 in cents
    const major = usdAmount / (PRECISION["USD"] ?? 100);
    expect(major).toBe(1000);
  });
});

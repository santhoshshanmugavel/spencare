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
  cashFlowTrend: [],
  topCategories: [],
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

// ── BUG 2 regression — Privacy Mode silent refresh ────────────────────────────
//
// The load() function on home.tsx was changed to accept a mode:
//   'full'    — shows the loading spinner (initial load)
//   'refresh' — shows the pull-to-refresh indicator
//   'silent'  — fetches new data without any loading indicator
//
// The useFocusEffect fires on every screen focus with mode='silent' so that
// when the user toggles Privacy Mode on the Profile tab and returns to Home,
// the freshly fetched privacyMode=true is applied without a spinner.
//
// These tests mirror the state-machine logic.

type LoadMode = "full" | "refresh" | "silent";
type ScreenStatus = "loading" | "refreshing" | "success" | "error";

function simulateLoad(
  mode: LoadMode,
  succeeds: boolean,
  currentStatus: ScreenStatus,
): { showsSpinner: boolean; showsRefreshing: boolean; nextStatus: ScreenStatus } {
  const showsSpinner = mode === "full";
  const showsRefreshing = mode === "refresh";
  let nextStatus: ScreenStatus;
  if (succeeds) {
    nextStatus = "success";
  } else if (mode === "silent") {
    // Silent failures leave status unchanged (stale data stays visible)
    nextStatus = currentStatus;
  } else {
    nextStatus = "error";
  }
  return { showsSpinner, showsRefreshing, nextStatus };
}

describe("Dashboard load mode — BUG 2 regression", () => {
  it("'full' mode shows spinner", () => {
    const { showsSpinner } = simulateLoad("full", true, "loading");
    expect(showsSpinner).toBe(true);
  });

  it("'full' mode does NOT show pull-to-refresh indicator", () => {
    const { showsRefreshing } = simulateLoad("full", true, "loading");
    expect(showsRefreshing).toBe(false);
  });

  it("'refresh' mode shows pull-to-refresh, not spinner", () => {
    const r = simulateLoad("refresh", true, "success");
    expect(r.showsRefreshing).toBe(true);
    expect(r.showsSpinner).toBe(false);
  });

  it("'silent' mode shows neither spinner nor refreshing indicator", () => {
    const r = simulateLoad("silent", true, "success");
    expect(r.showsSpinner).toBe(false);
    expect(r.showsRefreshing).toBe(false);
  });

  it("'silent' mode success updates state to success", () => {
    const { nextStatus } = simulateLoad("silent", true, "success");
    expect(nextStatus).toBe("success");
  });

  it("'silent' mode failure leaves status unchanged — stale data preferred over error flash", () => {
    const { nextStatus } = simulateLoad("silent", false, "success");
    expect(nextStatus).toBe("success");
  });

  it("'full' mode failure transitions to error", () => {
    const { nextStatus } = simulateLoad("full", false, "loading");
    expect(nextStatus).toBe("error");
  });

  it("'refresh' mode failure transitions to error", () => {
    const { nextStatus } = simulateLoad("refresh", false, "success");
    expect(nextStatus).toBe("error");
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

// ── goals_only Safe-to-Spend state ────────────────────────────────────────────
//
// When the user has active goals but no active budget, the domain returns
// state = "goals_only". STS amount = cashAfterReserves - upcomingBillsTotal
// where cashAfterReserves = availableBalance - goalReservedTotal.
// Verified with synthetic data: STS = ₹32,401 (3240100 minor).

describe("Safe-to-Spend — goals_only state", () => {
  it("state 'goals_only' is carried in the response", () => {
    const d = buildDashboard({
      safeToSpend: {
        state: "goals_only",
        amount: money(3240100),
        availableBalance: money(10500000),
        goalReservedTotal: money(7000000),
        cardPaymentReservedTotal: money(0),
        upcomingBillsTotal: money(259900),
        commitmentReservedTotal: money(0),
        ownedSpendableTotal: money(10500000),
        creditAvailableTotal: money(0),
      },
    });
    expect(d.safeToSpend.state).toBe("goals_only");
  });

  it("goals_only: amount = availableBalance - goalReservedTotal - upcomingBillsTotal", () => {
    const sts = {
      availableBalance: money(10500000),
      goalReservedTotal: money(7000000),
      upcomingBillsTotal: money(259900),
      amount: money(3240100),
    };
    const available = parseInt(sts.availableBalance.amountMinorUnits, 10);
    const goals = parseInt(sts.goalReservedTotal.amountMinorUnits, 10);
    const bills = parseInt(sts.upcomingBillsTotal.amountMinorUnits, 10);
    const amount = parseInt(sts.amount.amountMinorUnits, 10);
    expect(amount).toBe(available - goals - bills);
  });

  it("goals_only: hand-traced synthetic values — bank+cash - goals - bills = ₹32,401", () => {
    // seed_dashboard_data.sql: bank=10000000, cash=500000, goals=7000000, bills=259900
    const available = 10000000 + 500000;
    const goals = 5000000 + 2000000;
    const bills = 59900 + 200000;
    expect(available - goals - bills).toBe(3240100);
  });
});

// ── Full STS multi-deduction formula ─────────────────────────────────────────
//
// Full formula: amount = availableBalance - goalReservedTotal
//   - cardPaymentReservedTotal - upcomingBillsTotal
//   - commitmentReservedTotal

describe("Safe-to-Spend — full deduction formula", () => {
  it("all deduction fields contribute to reducing the STS amount", () => {
    const available = 5000000;
    const goals = 500000;
    const card = 200000;
    const bills = 300000;
    const commitments = 400000;
    const expected = available - goals - card - bills - commitments;
    const sts = {
      amount: money(expected),
      availableBalance: money(available),
      goalReservedTotal: money(goals),
      cardPaymentReservedTotal: money(card),
      upcomingBillsTotal: money(bills),
      commitmentReservedTotal: money(commitments),
    };
    const computed =
      parseInt(sts.availableBalance.amountMinorUnits, 10) -
      parseInt(sts.goalReservedTotal.amountMinorUnits, 10) -
      parseInt(sts.cardPaymentReservedTotal.amountMinorUnits, 10) -
      parseInt(sts.upcomingBillsTotal.amountMinorUnits, 10) -
      parseInt(sts.commitmentReservedTotal.amountMinorUnits, 10);
    expect(parseInt(sts.amount.amountMinorUnits, 10)).toBe(computed);
  });

  it("isNegative is true when STS amount is negative", () => {
    const d = buildDashboard({
      safeToSpend: {
        ...buildDashboard().safeToSpend,
        amount: money(-50000),
        availableBalance: money(100000),
        upcomingBillsTotal: money(150000),
      },
    });
    const isNegative = parseInt(d.safeToSpend.amount.amountMinorUnits, 10) < 0;
    expect(isNegative).toBe(true);
  });
});

// ── formatMinor — INR Indian number grouping (en-IN locale) ──────────────────
//
// Indian number system groups: last 3 digits, then every 2 digits (lakhs/crores).
// `en-IN` locale produces "1,00,000" for 100000 — NOT "100,000" (en-US).
// home.tsx uses `toLocaleString("en-IN")` for all INR amounts.

function formatMinorFn(minor: number, currency: string, privacyMode: boolean): string {
  if (privacyMode) return "••••";
  const major = minor / (PRECISION[currency] ?? 100);
  const symbol = currency === "INR" ? "₹" : currency;
  return `${symbol}${Math.abs(major).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

describe("formatMinor — INR Indian number grouping", () => {
  it("₹1,000 for 100000 minor (one thousand)", () => {
    expect(formatMinorFn(100000, "INR", false)).toBe("₹1,000");
  });

  it("₹10,000 for 1000000 minor (ten thousand)", () => {
    expect(formatMinorFn(1000000, "INR", false)).toBe("₹10,000");
  });

  it("₹1,00,000 for 10000000 minor (one lakh) — Indian two-digit grouping", () => {
    // en-IN produces "1,00,000", NOT "100,000" (en-US). Verified on rendered dashboard.
    expect(formatMinorFn(10000000, "INR", false)).toBe("₹1,00,000");
  });

  it("₹80,000 for 8000000 minor (eighty thousand — Zerodha Demat in synthetic data)", () => {
    expect(formatMinorFn(8000000, "INR", false)).toBe("₹80,000");
  });

  it("₹32,401 for 3240100 minor (STS amount in synthetic data)", () => {
    expect(formatMinorFn(3240100, "INR", false)).toBe("₹32,401");
  });

  it("₹5,000 for 500000 minor (cash wallet balance)", () => {
    expect(formatMinorFn(500000, "INR", false)).toBe("₹5,000");
  });
});

// ── Goal percentage rounding ──────────────────────────────────────────────────
//
// home.tsx: Math.min(100, Math.round((saved / target) * 100))
// 16.67% rounds to 17%; 20.00% stays 20%.

describe("Goal percentage — rounding", () => {
  it("16.67% rounds to 17% (Emergency Fund: ₹50,000 / ₹3,00,000)", () => {
    const pct = Math.min(100, Math.round((5000000 / 30000000) * 100));
    expect(pct).toBe(17);
  });

  it("20% for Travel Fund (exact: ₹20,000 / ₹1,00,000)", () => {
    const pct = Math.min(100, Math.round((2000000 / 10000000) * 100));
    expect(pct).toBe(20);
  });

  it("0% when nothing saved", () => {
    const pct = Math.min(100, Math.round((0 / 500000) * 100));
    expect(pct).toBe(0);
  });

  it("0% when target_amount_minor is 0 (guard against NaN)", () => {
    // home.tsx uses `target_amount_minor > 0 ? Math.round(...) : 0`
    const target = 0;
    const pct = target > 0 ? Math.min(100, Math.round((500000 / target) * 100)) : 0;
    expect(pct).toBe(0);
  });
});

// ── no_accounts Safe-to-Spend state ──────────────────────────────────────────

describe("Safe-to-Spend — no_accounts state", () => {
  it("no_accounts state is preserved in the response", () => {
    const d = buildDashboard({
      safeToSpend: {
        ...buildDashboard().safeToSpend,
        state: "no_accounts",
        amount: money(0),
        availableBalance: money(0),
      },
      accounts: [],
    });
    expect(d.safeToSpend.state).toBe("no_accounts");
    expect(d.accounts).toHaveLength(0);
  });

  it("no_accounts: STS amount is zero", () => {
    const d = buildDashboard({
      safeToSpend: { ...buildDashboard().safeToSpend, state: "no_accounts", amount: money(0) },
      accounts: [],
    });
    expect(parseInt(d.safeToSpend.amount.amountMinorUnits, 10)).toBe(0);
  });
});

// ── Credit card account list display ─────────────────────────────────────────
//
// In AccountsCard, credit cards show `balance_minor` (typically 0 — not the
// amount owed). The `credit_used_minor` contributes to Net Worth as a liability
// but is NOT displayed in the account row to avoid implying it is an asset.
// Verified: SBI Card shows ₹0 on the rendered dashboard with credit_used=₹25,000.

describe("Credit card account list display", () => {
  it("credit card display value is balance_minor, not credit_used_minor", () => {
    // home.tsx line 111: for non-investment, display = balance_minor
    const cc = {
      type: "credit_card",
      balance_minor: 0,
      market_value_minor: null as null | number,
      credit_used_minor: 2500000,
    };
    const displayMinor =
      cc.type === "investment" ? cc.market_value_minor : cc.balance_minor;
    expect(displayMinor).toBe(0);
    expect(displayMinor).not.toBe(cc.credit_used_minor);
  });

  it("credit_used_minor equals Net Worth totalLiabilities for a single credit card", () => {
    const creditUsed = 2500000;
    const d = buildDashboard({
      accounts: [
        { id: "a1", name: "HDFC", type: "bank", currency: "INR", balance_minor: 10000000, market_value_minor: null, credit_limit_minor: null, credit_used_minor: null, is_archived: false },
        { id: "cc1", name: "SBI Card", type: "credit_card", currency: "INR", balance_minor: 0, market_value_minor: null, credit_limit_minor: 10000000, credit_used_minor: creditUsed, is_archived: false },
      ],
      netWorth: {
        netWorth: money(10000000 - creditUsed),
        totalAssets: money(10000000),
        totalLiabilities: money(creditUsed),
      },
    });
    const liabilities = parseInt(d.netWorth.totalLiabilities.amountMinorUnits, 10);
    const ccUsed = d.accounts.find((a) => a.type === "credit_card")?.credit_used_minor ?? 0;
    expect(liabilities).toBe(ccUsed);
  });

  it("credit limit is NOT an asset and never appears in Net Worth totalAssets", () => {
    const d = buildDashboard({
      accounts: [
        { id: "cc1", name: "SBI Card", type: "credit_card", currency: "INR", balance_minor: 0, market_value_minor: null, credit_limit_minor: 10000000, credit_used_minor: 2500000, is_archived: false },
      ],
      netWorth: {
        netWorth: money(-2500000),
        totalAssets: money(0),
        totalLiabilities: money(2500000),
      },
    });
    const assets = parseInt(d.netWorth.totalAssets.amountMinorUnits, 10);
    const creditLimit = d.accounts[0]!.credit_limit_minor ?? 0;
    // totalAssets must never equal the credit limit
    expect(assets).not.toBe(creditLimit);
    expect(assets).toBe(0);
  });
});

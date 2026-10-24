import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));
vi.mock("@spencare/domain-application", () => ({
  getDashboardSummary: vi.fn(),
  getCashFlowTrend: vi.fn(),
  getCashFlowByCategory: vi.fn(),
  listCategories: vi.fn(),
}));
vi.mock("@spencare/domain-infra", () => ({
  getProfile: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { getDashboardSummary, getCashFlowTrend, getCashFlowByCategory, listCategories } = await import("@spencare/domain-application");
const { getProfile } = await import("@spencare/domain-infra");

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/mobile/dashboard", { headers });
}

function makeMoneyJSON(minorUnits: number, currency = "INR") {
  return { amountMinorUnits: String(minorUnits), currency };
}

// Minimal safe-to-spend / cash-flow / net-worth shapes shared across tests.
const mockSummaryBase = {
  safeToSpend: {
    state: "balance_only",
    amount: makeMoneyJSON(500000),
    availableBalance: makeMoneyJSON(500000),
    goalReservedTotal: makeMoneyJSON(0),
    cardPaymentReservedTotal: makeMoneyJSON(0),
    upcomingBillsTotal: makeMoneyJSON(0),
    commitmentReservedTotal: makeMoneyJSON(0),
    ownedSpendableTotal: makeMoneyJSON(500000),
    creditAvailableTotal: makeMoneyJSON(0),
  },
  accounts: [],
  goals: [],
  cashFlow: { incomeMinor: 200000, expenseMinor: 100000, netMinor: 100000 },
  netWorth: {
    netWorth: makeMoneyJSON(500000),
    totalAssets: makeMoneyJSON(500000),
    totalLiabilities: makeMoneyJSON(0),
  },
};

// A BillPredictionWithDefinition-shaped object (mirrors the infra type).
function makeBillPrediction(overrides: {
  id?: string;
  expected_date?: string;
  expected_amount_minor?: number | null;
  status?: string;
  merchant_pattern?: string;
} = {}) {
  return {
    id: overrides.id ?? "bill-1",
    expected_date: overrides.expected_date ?? "2026-11-15",
    expected_amount_minor: overrides.expected_amount_minor !== undefined ? overrides.expected_amount_minor : 120000,
    status: overrides.status ?? "open",
    bill_definitions: {
      merchant_pattern: overrides.merchant_pattern ?? "Electricity Board",
      category_id: null,
      recurrence_interval: "monthly",
      deleted_at: null,
    },
  };
}

const mockSummary = { ...mockSummaryBase, upcomingBills: [] };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  vi.mocked(getCashFlowTrend).mockResolvedValue([]);
  vi.mocked(getCashFlowByCategory).mockResolvedValue([]);
  vi.mocked(listCategories).mockResolvedValue([]);
});

describe("GET /api/mobile/dashboard", () => {
  it("returns 401 when no authorization header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Missing");
  });

  it("returns 401 when token is invalid", async () => {
    vi.mocked(createClient).mockReturnValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("invalid") }) },
    } as never);

    const res = await GET(makeRequest("bad-token"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns dashboard data for a valid token", async () => {
    const mockAnonClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        }),
      },
    };
    const mockUserClient = {};
    vi.mocked(createClient)
      .mockReturnValueOnce(mockAnonClient as never)
      .mockReturnValueOnce(mockUserClient as never);

    vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary as never);
    vi.mocked(getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);

    const res = await GET(makeRequest("valid-token"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.cashFlow.incomeMinor).toBe(200000);
    expect(body.cashFlow.expenseMinor).toBe(100000);
    expect(body.privacyMode).toBe(false);
  });

  it("returns privacyMode true when user has privacy enabled", async () => {
    const mockAnonClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        }),
      },
    };
    vi.mocked(createClient)
      .mockReturnValueOnce(mockAnonClient as never)
      .mockReturnValueOnce({} as never);

    vi.mocked(getDashboardSummary).mockResolvedValue(mockSummary as never);
    vi.mocked(getProfile).mockResolvedValue({ privacy_mode_enabled: true } as never);

    const res = await GET(makeRequest("valid-token"));
    const body = await res.json();
    expect(body.privacyMode).toBe(true);
  });
});

// ── Bill contract tests ───────────────────────────────────────────────────────
// These assert the actual JSON shape the mobile client receives, not TypeScript
// types. They exercise the mapping from BillPredictionWithDefinition → BillJSON.

describe("GET /api/mobile/dashboard — bill contract", () => {
  function setupAuth() {
    const mockAnonClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        }),
      },
    };
    vi.mocked(createClient)
      .mockReturnValueOnce(mockAnonClient as never)
      .mockReturnValueOnce({} as never);
  }

  it("maps bill_definitions.merchant_pattern to definition.name", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction({ merchant_pattern: "Electricity Board" })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());

    expect(body.upcomingBills).toHaveLength(1);
    expect(body.upcomingBills[0].definition.name).toBe("Electricity Board");
  });

  it("passes expected_date through unchanged", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction({ expected_date: "2026-12-01" })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].expected_date).toBe("2026-12-01");
  });

  it("passes null expected_amount_minor as null (not coerced to 0)", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction({ expected_amount_minor: null })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].expected_amount_minor).toBeNull();
  });

  it("passes a non-null expected_amount_minor unchanged", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction({ expected_amount_minor: 75000 })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].expected_amount_minor).toBe(75000);
  });

  it("uses profile preferred_currency as definition.currency", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction()],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "USD",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].definition.currency).toBe("USD");
  });

  it("falls back to INR when profile has no preferred_currency", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction()],
    } as never);
    vi.mocked(getProfile).mockResolvedValue(null as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].definition.currency).toBe("INR");
  });

  it("uses 'Unknown bill' fallback when merchant_pattern is empty", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction({ merchant_pattern: "" })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.upcomingBills[0].definition.name).toBe("Unknown bill");
  });

  it("response shape has exactly the fields BillJSON expects, and no due_date", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [makeBillPrediction()],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    const bill = body.upcomingBills[0];

    expect(typeof bill.id).toBe("string");
    expect(typeof bill.expected_date).toBe("string");
    // expected_amount_minor may be number or null
    expect(bill.expected_amount_minor === null || typeof bill.expected_amount_minor === "number").toBe(true);
    expect(typeof bill.status).toBe("string");
    expect(typeof bill.definition.name).toBe("string");
    expect(typeof bill.definition.currency).toBe("string");
    // Must not contain due_date (the old broken field)
    expect(bill.due_date).toBeUndefined();
  });
});

// ── Account contract tests ────────────────────────────────────────────────────
// Assert that the account mapping includes market_value_minor and that
// investment accounts expose it correctly.

describe("GET /api/mobile/dashboard — account contract", () => {
  function setupAuth() {
    const mockAnonClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        }),
      },
    };
    vi.mocked(createClient)
      .mockReturnValueOnce(mockAnonClient as never)
      .mockReturnValueOnce({} as never);
  }

  function makeAccount(overrides: {
    id?: string;
    type?: string;
    balance_minor?: number;
    market_value_minor?: number | null;
    credit_limit_minor?: number | null;
    credit_used_minor?: number | null;
    is_archived?: boolean;
  } = {}) {
    return {
      id: overrides.id ?? "acc-1",
      name: "Test Account",
      type: overrides.type ?? "bank",
      currency: "INR",
      balance_minor: overrides.balance_minor ?? 100000,
      market_value_minor: overrides.market_value_minor !== undefined ? overrides.market_value_minor : null,
      credit_limit_minor: overrides.credit_limit_minor !== undefined ? overrides.credit_limit_minor : null,
      credit_used_minor: overrides.credit_used_minor !== undefined ? overrides.credit_used_minor : null,
      is_archived: overrides.is_archived ?? false,
    };
  }

  it("account response includes market_value_minor field", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [],
      accounts: [makeAccount({ type: "investment", market_value_minor: 250000 })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    const acc = body.accounts[0];
    expect(acc.market_value_minor).toBe(250000);
  });

  it("passes null market_value_minor as null for bank accounts", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [],
      accounts: [makeAccount({ type: "bank", market_value_minor: null })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.accounts[0].market_value_minor).toBeNull();
  });

  it("response includes preferredCurrency from profile", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "USD",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.preferredCurrency).toBe("USD");
  });

  it("preferredCurrency falls back to INR when profile is null", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [],
    } as never);
    vi.mocked(getProfile).mockResolvedValue(null as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    expect(body.preferredCurrency).toBe("INR");
  });

  it("account shape has all required fields", async () => {
    setupAuth();
    vi.mocked(getDashboardSummary).mockResolvedValue({
      ...mockSummaryBase,
      upcomingBills: [],
      accounts: [makeAccount({ type: "credit_card", credit_limit_minor: 500000, credit_used_minor: 100000 })],
    } as never);
    vi.mocked(getProfile).mockResolvedValue({
      privacy_mode_enabled: false,
      preferred_currency: "INR",
    } as never);

    const body = await GET(makeRequest("tok")).then((r) => r.json());
    const acc = body.accounts[0];
    expect(typeof acc.id).toBe("string");
    expect(typeof acc.name).toBe("string");
    expect(typeof acc.type).toBe("string");
    expect(typeof acc.currency).toBe("string");
    expect(typeof acc.balance_minor).toBe("number");
    expect(acc.market_value_minor === null || typeof acc.market_value_minor === "number").toBe(true);
    expect(acc.credit_limit_minor).toBe(500000);
    expect(acc.credit_used_minor).toBe(100000);
    expect(typeof acc.is_archived).toBe("boolean");
  });
});

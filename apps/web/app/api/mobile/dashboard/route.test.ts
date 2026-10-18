import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));
vi.mock("@spencare/domain-application", () => ({
  getDashboardSummary: vi.fn(),
}));
vi.mock("@spencare/domain-infra", () => ({
  getProfile: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleSupabaseClient: vi.fn(() => ({})),
}));

const { createClient } = await import("@supabase/supabase-js");
const { getDashboardSummary } = await import("@spencare/domain-application");
const { getProfile } = await import("@spencare/domain-infra");

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/mobile/dashboard", { headers });
}

function makeMoneyJSON(minorUnits: number, currency = "INR") {
  return { amountMinorUnits: String(minorUnits), currency };
}

const mockSummary = {
  safeToSpend: {
    state: "balance_only",
    amount: makeMoneyJSON(500000),
    availableBalance: makeMoneyJSON(500000),
    goalReservedTotal: makeMoneyJSON(0),
    cardPaymentReservedTotal: makeMoneyJSON(0),
    upcomingBillsTotal: makeMoneyJSON(0),
    commitmentReservedTotal: makeMoneyJSON(0),
    loanReservedTotal: makeMoneyJSON(0),
    ownedSpendableTotal: makeMoneyJSON(500000),
    creditAvailableTotal: makeMoneyJSON(0),
  },
  accounts: [],
  goals: [],
  upcomingBills: [],
  cashFlow: { incomeMinor: 200000, expenseMinor: 100000, netMinor: 100000 },
  netWorth: {
    netWorth: makeMoneyJSON(500000),
    totalAssets: makeMoneyJSON(500000),
    totalLiabilities: makeMoneyJSON(0),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
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

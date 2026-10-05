import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-application", () => ({
  getSafeToSpend: vi.fn(),
  getDashboardSummary: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listCategories: vi.fn(),
  listBudgetsWithUsage: vi.fn(),
  listGoals: vi.fn(),
  calculateProgress: vi.fn(),
  getUpcomingBills: vi.fn(),
  getCashFlowOverview: vi.fn(),
  getProfile: vi.fn(),
  toAiAccountSummaryInput: vi.fn((a) => a),
  toAiAccountSummariesForContext: vi.fn((accounts) => accounts),
  redactFinancialSnapshot: vi.fn((input) => input),
  redactBudgetSummaries: vi.fn((input) => input),
  redactGoalSummaries: vi.fn((input) => input),
  redactBillSummaries: vi.fn((input) => input),
  redactCashFlowSummary: vi.fn((input) => input),
  logMcpScopeDenial: vi.fn(),
  // Credit card billing
  getCreditCardBillingStatus: vi.fn(),
  getAccount: vi.fn(),
  getAccountBalance: vi.fn(),
  getNetWorth: vi.fn(),
  getProfileForDisplay: vi.fn(),
  getTransaction: vi.fn(),
  getGoal: vi.fn(),
  getGoalContributionPlan: vi.fn(),
  getCashFlowByCategory: vi.fn(),
  compareCashFlowPeriods: vi.fn(),
  getCashFlowTrend: vi.fn(),
  listBillPredictions: vi.fn(),
  listGmailCandidatesQuery: vi.fn(),
  getGmailStatus: vi.fn(),
  listMcpSessions: vi.fn(),
  getSecurityStatus: vi.fn(),
  getOnboardingStatusQuery: vi.fn(),
  listCommitments: vi.fn(),
  listUpcoming: vi.fn(),
  listAllLoans: vi.fn(),
  listPlansWithSummaries: vi.fn(),
  getPlanDetail: vi.fn(),
}));

function fakeServer() {
  const tools = new Map<string, (input: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>>();
  return {
    registerTool: (name: string, _config: unknown, callback: (input: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>) => {
      tools.set(name, callback);
    },
    call: async (name: string, input: unknown = {}) => {
      const cb = tools.get(name);
      if (!cb) throw new Error(`tool ${name} was not registered`);
      const result = await cb(input);
      return { ...result, data: JSON.parse(result.content[0]!.text) };
    },
  };
}

function readCtx(scopes: ("read" | "write")[] = ["read"]) {
  return { userId: "u1", email: "", supabase: {} as never, serviceRoleSupabase: {} as never, mcpSessionId: "s1", mcpClientName: "Claude Desktop", mcpScopes: scopes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerReadTools — scope enforcement", () => {
  it("a read-scoped session can call a read tool successfully", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getSafeToSpend).mockResolvedValue({ state: "balance_only", amount: { amountMinorUnits: 500000n, currencyCode: "INR" }, ownedSpendableTotal: { amountMinorUnits: 500000n, currencyCode: "INR" }, creditAvailableTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, cardPaymentReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, commitmentReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, loanReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" } } as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getSafeToSpend");
    expect(result.isError).toBeUndefined();
  });

  it("a session with NO scopes at all cannot call a read tool, and the denial is audited", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx([]));

    const result = await server.call("getSafeToSpend");
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("INSUFFICIENT_SCOPE");
    expect(vi.mocked(domainApp.logMcpScopeDenial)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: "getSafeToSpend", requiredScope: "read" }));
    // The domain query itself must never have been called.
    expect(vi.mocked(domainApp.getSafeToSpend)).not.toHaveBeenCalled();
  });
});

describe("registerReadTools — Privacy Mode", () => {
  it("redacts the Safe-to-Spend figure when Privacy Mode is enabled", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: true } as never);
    vi.mocked(domainApp.getSafeToSpend).mockResolvedValue({ state: "balance_only", amount: { amountMinorUnits: 500000n, currencyCode: "INR" }, ownedSpendableTotal: { amountMinorUnits: 500000n, currencyCode: "INR" }, creditAvailableTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, cardPaymentReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, commitmentReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" }, loanReservedTotal: { amountMinorUnits: 0n, currencyCode: "INR" } } as never);
    vi.mocked(domainApp.redactFinancialSnapshot).mockImplementation((input) => ({
      safeToSpend: { state: (input as { safeToSpend: { state: string } }).safeToSpend.state, amount: { private: true } },
      accounts: [],
    }));

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getSafeToSpend");
    expect(result.data).toEqual({ state: "balance_only", amount: { private: true } });
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("500000");
  });
});

describe("registerReadTools — getCreditCardBillingSummary canonical source (single-date model)", () => {
  function mockBillingStatus() {
    return {
      snapshot: {
        mostRecentClosedCycle: {
          cycleStart: "2026-09-02",
          cycleEnd: "2026-10-02",
          dueDate: "2026-10-02",
        },
        openCycle: {
          cycleStart: "2026-10-02",
          cycleEnd: "2026-11-02",
          dueDate: "2026-11-02",
        },
        nextCycle: {
          cycleStart: "2026-11-02",
          cycleEnd: "2026-12-02",
          dueDate: "2026-12-02",
        },
        daysUntilMostRecentDue: -5,
        daysUntilNextDue: 25,
      },
      statementBalanceMinor: 4183986,
      obligation: { id: "obl-1", accountId: "acct1", statementDate: "2026-10-02", periodStart: "2026-09-02", periodEnd: "2026-10-01", statementBalanceMinor: 4183986, paidMinor: 0, remainingMinor: 4183986, status: "unpaid" as const, dueDate: "2026-10-02" },
      paymentStatus: "due_soon" as const,
    };
  }

  it("returns computed billing status from the canonical domain service, not its own calculation", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({
      id: "acct1",
      type: "credit_card",
      name: "IDFC First Millennia",
      currency: "INR",
      statement_close_day: 21,
      payment_due_day: 2,
      credit_limit_minor: 10000000,
      credit_used_minor: 4183986,
    } as never);
    vi.mocked(domainApp.getCreditCardBillingStatus).mockResolvedValue(mockBillingStatus() as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct1" });
    expect(result.isError).toBeUndefined();
    expect(result.data.currentBillDueDate).toBe("2026-10-02");
    expect(result.data.nextBillDueDate).toBe("2026-11-02");
    expect(result.data.currentBillAmountMinor).toBe(4183986);
    expect(result.data.billDueDay).toBe(2);
    expect(result.data.currentOutstandingMinor).toBe(4183986);
    expect(result.data.availableCreditMinor).toBe(10000000 - 4183986);
    expect(result.data.utilizationPercent).toBe(42);
    expect(result.data.paymentStatus).toBe("due_soon");
    // Must call the canonical domain service, not compute dates itself
    expect(vi.mocked(domainApp.getCreditCardBillingStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "acct1" }),
      expect.any(String),
    );
  });

  it("returns null for non-credit-card account", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({ id: "acct2", type: "bank" } as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct2" });
    expect(result.data).toBeNull();
  });

  it("reports no_bill_configured without fabricating dates when the bill due day is not set", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({
      id: "acct1", type: "credit_card", name: "New Card", currency: "INR",
      statement_close_day: null, payment_due_day: null, credit_limit_minor: 1000000, credit_used_minor: 0,
    } as never);
    vi.mocked(domainApp.getCreditCardBillingStatus).mockResolvedValue(null);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct1" });
    expect(result.data.paymentStatus).toBe("no_bill_configured");
    expect(result.data.currentBillAmountMinor).toBeNull();
  });

  it("redacts monetary amounts in privacy mode", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: true } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({
      id: "acct1", type: "credit_card", name: "IDFC First Millennia",
      currency: "INR", statement_close_day: null, payment_due_day: 2, credit_limit_minor: 10000000, credit_used_minor: 4183986,
    } as never);
    vi.mocked(domainApp.getCreditCardBillingStatus).mockResolvedValue(mockBillingStatus() as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct1" });
    // Dates must still be shown; amounts must be redacted.
    expect(result.data.currentBillDueDate).toBe("2026-10-02");
    expect(result.data.nextBillDueDate).toBe("2026-11-02");
    expect(result.data.currentBillAmountMinor).toBeNull();
    expect(result.data.currentOutstandingMinor).toBeNull();
    expect(result.data.availableCreditMinor).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain("4183986");
  });
});

describe("registerReadTools — financial Plan read tools (Gate 11)", () => {
  it("getPlans returns a lightweight per-Plan summary sourced entirely from listPlansWithSummaries, labeled with source ACTUAL/USER_DEFINED", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.listPlansWithSummaries).mockResolvedValue([
      {
        plan: { id: "plan-1", name: "Thailand Trip", status: "active", base_currency: "INR", current_budget_minor: 2_000_000 },
        calculations: { actualSpend: { amountMinorUnits: 500000n }, budgetStatus: { overBudget: false }, progress: { percentOfBudgetUsed: 25 } },
      },
    ] as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getPlans");
    expect(result.isError).toBeUndefined();
    expect(result.data).toEqual([
      {
        id: "plan-1",
        name: "Thailand Trip",
        status: "active",
        currency: "INR",
        currentBudget: { amountMinor: 2_000_000, currency: "INR", source: "USER_DEFINED" },
        actualSpend: { amountMinor: 500000, currency: "INR", source: "ACTUAL" },
        overBudget: false,
        percentOfBudgetUsed: 25,
      },
    ]);
  });

  it("getPlanDetail returns a clean not-found error for a nonexistent or another user's Plan, never leaking which case it is", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getPlanDetail).mockResolvedValue(null as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getPlanDetail", { planId: "someone-elses-plan" });
    expect(result.data).toEqual({ error: "Plan not found." });
  });

  it("getPlanDetail labels actual spend ACTUAL, budget USER_DEFINED, and derived aggregates CALCULATED", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.listGoals).mockResolvedValue([] as never);
    vi.mocked(domainApp.listCommitments).mockResolvedValue([] as never);
    vi.mocked(domainApp.listAccounts).mockResolvedValue([] as never);
    vi.mocked(domainApp.getPlanDetail).mockResolvedValue({
      plan: { id: "plan-1", name: "Thailand Trip", status: "active", start_date: null, end_date: null, base_currency: "INR", original_budget_minor: 2_000_000, current_budget_minor: 2_000_000 },
      items: [],
      goalLinks: [],
      commitmentLinks: [],
      accountLinks: [],
      transactions: [],
      calculations: {
        actualSpend: { amountMinorUnits: 500000n },
        plannedSpend: { amountMinorUnits: 0n },
        committedAmount: { amountMinorUnits: 0n },
        upcomingAmount: { amountMinorUnits: 0n },
        budgetStatus: { hasBudget: true, remaining: { amountMinorUnits: 1_500_000n }, overBudget: false },
        variance: { variance: { amountMinorUnits: 500000n } },
        progress: { percentOfBudgetUsed: 25, percentOfPlannedSpent: null },
        excludedTransactions: [],
        excludedItems: [],
      },
    } as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getPlanDetail", { planId: "plan-1" });
    expect(result.data.actualSpend).toEqual({ amountMinor: 500000, currency: "INR", source: "ACTUAL" });
    expect(result.data.currentBudget).toEqual({ amountMinor: 2_000_000, currency: "INR", source: "USER_DEFINED" });
    expect(result.data.plannedSpend).toEqual({ amountMinor: 0, currency: "INR", source: "CALCULATED" });
    expect(result.data.dataConfidence).toBe("high");
  });

  it("a session with no scope cannot call getPlanDetail", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx([]));

    const result = await server.call("getPlanDetail", { planId: "plan-1" });
    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("INSUFFICIENT_SCOPE");
    expect(vi.mocked(domainApp.getPlanDetail)).not.toHaveBeenCalled();
  });
});

describe("registerReadTools — getAccounts uses the shared credit-safe mapper", () => {
  it("routes every account through toAiAccountSummariesForContext (which internally calls toAiAccountSummaryInput + filters AI-unsafe types like EPFO)", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    const accounts = [{ id: "a1", type: "bank" }, { id: "a2", type: "credit_card" }];
    vi.mocked(domainApp.listAccounts).mockResolvedValue(accounts as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    await server.call("getAccounts");
    expect(vi.mocked(domainApp.toAiAccountSummariesForContext)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(domainApp.toAiAccountSummariesForContext).mock.calls[0]![0]).toEqual(accounts);
  });
});

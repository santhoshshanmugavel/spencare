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
  redactFinancialSnapshot: vi.fn((input) => input),
  redactBudgetSummaries: vi.fn((input) => input),
  redactGoalSummaries: vi.fn((input) => input),
  redactBillSummaries: vi.fn((input) => input),
  redactCashFlowSummary: vi.fn((input) => input),
  logMcpScopeDenial: vi.fn(),
  // Credit card billing
  getCreditCardStatementSummary: vi.fn(),
  getActiveObligationForAccount: vi.fn(),
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

describe("registerReadTools — getCreditCardBillingSummary canonical source", () => {
  it("returns computed billing dates from domain service, not own calculation", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({
      id: "acct1",
      type: "credit_card",
      name: "IDFC First Millennia",
      currency: "INR",
      statement_generated_day: 21,
      payment_due_day: 2,
      credit_used_minor: 4183986,
    } as never);
    vi.mocked(domainApp.getCreditCardStatementSummary).mockResolvedValue({
      accountId: "acct1",
      accountName: "IDFC First Millennia",
      currency: "INR",
      periodStart: "2026-08-21",
      periodEnd: "2026-09-21",
      statementDate: "2026-09-21",
      statementBalanceMinor: 0,
      paymentDueDate: "2026-10-02",
    } as never);
    vi.mocked(domainApp.getActiveObligationForAccount).mockResolvedValue(null);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct1" });
    expect(result.isError).toBeUndefined();
    expect(result.data.nextStatementDate).toBe("2026-09-21");
    expect(result.data.nextPaymentDueDate).toBe("2026-10-02");
    expect(result.data.statementCloseDay).toBe(21);
    expect(result.data.paymentDueDay).toBe(2);
    expect(result.data.currentOutstandingMinor).toBe(4183986);
    // Must call domain service, not compute dates itself
    expect(vi.mocked(domainApp.getCreditCardStatementSummary)).toHaveBeenCalledWith(
      expect.anything(),
      "acct1",
    );
  });

  it("returns null for non-credit-card account", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({ id: "acct2", type: "bank" } as never);
    vi.mocked(domainApp.getCreditCardStatementSummary).mockResolvedValue(null);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct2" });
    expect(result.data).toBeNull();
  });

  it("redacts monetary amounts in privacy mode", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: true } as never);
    vi.mocked(domainApp.getAccount).mockResolvedValue({
      id: "acct1", type: "credit_card", name: "IDFC First Millennia",
      currency: "INR", statement_generated_day: 21, payment_due_day: 2, credit_used_minor: 4183986,
    } as never);
    vi.mocked(domainApp.getCreditCardStatementSummary).mockResolvedValue({
      accountId: "acct1", accountName: "IDFC First Millennia", currency: "INR",
      periodStart: "2026-08-21", periodEnd: "2026-09-21",
      statementDate: "2026-09-21", statementBalanceMinor: 0, paymentDueDate: "2026-10-02",
    } as never);
    vi.mocked(domainApp.getActiveObligationForAccount).mockResolvedValue(null);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    const result = await server.call("getCreditCardBillingSummary", { accountId: "acct1" });
    // Dates must still be shown; amounts must be redacted
    expect(result.data.nextStatementDate).toBe("2026-09-21");
    expect(result.data.nextPaymentDueDate).toBe("2026-10-02");
    expect(result.data.statementBalanceMinor).toBeNull();
    expect(result.data.currentOutstandingMinor).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain("4183986");
  });
});

describe("registerReadTools — getAccounts uses the shared credit-safe mapper", () => {
  it("maps every account through toAiAccountSummaryInput before redacting", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    const accounts = [{ id: "a1", type: "bank" }, { id: "a2", type: "credit_card" }];
    vi.mocked(domainApp.listAccounts).mockResolvedValue(accounts as never);

    const { registerReadTools } = await import("./readTools.js");
    const server = fakeServer();
    registerReadTools(server as never, readCtx(["read"]));

    await server.call("getAccounts");
    expect(vi.mocked(domainApp.toAiAccountSummaryInput)).toHaveBeenCalledTimes(2);
  });
});

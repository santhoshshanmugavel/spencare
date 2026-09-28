import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-application", () => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listGoals: vi.fn(),
  listBillPredictions: vi.fn(),
  listMcpSessions: vi.fn(),
  listCommitments: vi.fn(),
  getProfile: vi.fn(),
  getTransaction: vi.fn(),
  getAccount: vi.fn(),
  getGoal: vi.fn(),
  getBudget: vi.fn(),
  getGmailCandidateQuery: vi.fn(),
  getGoalContributionPlanById: vi.fn(),
  calculateNextOccurrence: vi.fn(),
  FREQUENCY_LABELS: {},
  getPlan: vi.fn(),
  proposeCommand: vi.fn(),
  confirmCommand: vi.fn(),
  cancelPendingCommand: vi.fn(),
  describeAmountForProvider: vi.fn(() => "INR 500"),
  logMcpScopeDenial: vi.fn(),
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

function ctxWithScopes(scopes: ("read" | "write")[]) {
  return { userId: "u1", email: "", supabase: {} as never, serviceRoleSupabase: {} as never, mcpSessionId: "s1", mcpClientName: "Claude Desktop", mcpScopes: scopes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerWriteTools — scope enforcement", () => {
  it("a read-only session cannot call a write (propose) tool, and the denial is audited", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["read"]));

    const result = await server.call("proposeAddExpense", { kind: "expense", accountId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874", amountMinor: 45000, occurredAt: "2026-09-05" });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("INSUFFICIENT_SCOPE");
    expect(vi.mocked(domainApp.logMcpScopeDenial)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toolName: "proposeAddExpense", requiredScope: "write" }));
    expect(vi.mocked(domainApp.proposeCommand)).not.toHaveBeenCalled();
  });

  it("a read-only session cannot call confirmPendingAction either", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["read"]));

    const result = await server.call("confirmPendingAction", { confirmationId: "6a0f2b9a-1111-4a11-8b11-000000000001" });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("INSUFFICIENT_SCOPE");
    expect(vi.mocked(domainApp.confirmCommand)).not.toHaveBeenCalled();
  });
});

describe("registerWriteTools — proposeAddExpense (write-scoped session)", () => {
  it("validates input, builds a preview, and calls proposeCommand with source='mcp' -- never mutating anything itself", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getProfile).mockResolvedValue({ privacy_mode_enabled: false } as never);
    vi.mocked(domainApp.listAccounts).mockResolvedValue([{ id: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", name: "HDFC Bank" }] as never);
    vi.mocked(domainApp.listCategories).mockResolvedValue([{ id: "289f5e56-21a8-4ee0-865f-c02c11f4d874", name: "Dining" }] as never);
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-1", summary: "Record...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeAddExpense", { kind: "expense", accountId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", categoryId: "289f5e56-21a8-4ee0-865f-c02c11f4d874", amountMinor: 45000, occurredAt: "2026-09-05" });

    expect(result.isError).toBeUndefined();
    expect(result.data.confirmationId).toBe("conf-1");
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(
      expect.anything(),
      "mcp",
      "createTransaction",
      expect.objectContaining({ accountId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491", type: "expense" }),
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });

  it("rejects invalid input via the shared Zod schema before ever calling proposeCommand", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeAddExpense", { accountId: "a1" }); // missing required fields

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("VALIDATION_FAILED");
    expect(vi.mocked(domainApp.proposeCommand)).not.toHaveBeenCalled();
  });
});

describe("registerWriteTools — confirmPendingAction", () => {
  it("calls confirmCommand with actor='mcp' and returns the mutation result on success", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.confirmCommand).mockResolvedValue({ ok: true, result: { id: "txn-1" } });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("confirmPendingAction", { confirmationId: "6a0f2b9a-1111-4a11-8b11-000000000001" });

    expect(vi.mocked(domainApp.confirmCommand)).toHaveBeenCalledWith(expect.anything(), "6a0f2b9a-1111-4a11-8b11-000000000001", "mcp");
    expect(result.data).toEqual({ id: "txn-1" });
  });

  it("surfaces a confirmation_expired rejection as a structured CONFIRMATION_EXPIRED error, never a raw exception", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.confirmCommand).mockResolvedValue({ ok: false, error: { code: "confirmation_expired", message: "That proposal has expired." } });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("confirmPendingAction", { confirmationId: "6a0f2b9a-1111-4a11-8b11-000000000001" });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("CONFIRMATION_EXPIRED");
  });

  it("natural language in an argument is never treated as confirmation -- only an explicit confirmPendingAction call with a real confirmationId reaches confirmCommand", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    // No confirmationId at all -- e.g. a malformed/injected call -- must fail validation, never fall through to confirmCommand.
    const result = await server.call("confirmPendingAction", { confirmationId: undefined });
    expect(result.isError).toBe(true);
    expect(vi.mocked(domainApp.confirmCommand)).not.toHaveBeenCalled();
  });
});

describe("registerWriteTools — financial Plan propose tools (Gate 11, write-scoped session)", () => {
  it("proposeCreatePlan validates input, builds a preview, and calls proposeCommand with source='mcp' and commandType='createPlan' -- never mutating anything itself", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-1", summary: "Create...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeCreatePlan", { name: "Thailand Trip", baseCurrency: "INR" });

    expect(result.isError).toBeUndefined();
    expect(result.data.confirmationId).toBe("conf-1");
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(
      expect.anything(),
      "mcp",
      "createPlan",
      expect.objectContaining({ name: "Thailand Trip", baseCurrency: "INR" }),
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });

  it("proposeCreatePlan rejects invalid input via the shared Zod schema before ever calling proposeCommand", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeCreatePlan", { baseCurrency: "INR" }); // missing required name

    expect(result.isError).toBe(true);
    expect(vi.mocked(domainApp.proposeCommand)).not.toHaveBeenCalled();
  });

  it("proposeUpdatePlanStatus calls proposeCommand with commandType='updatePlanStatus', never executing the transition itself", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getPlan).mockResolvedValue({ id: "plan-1", name: "Thailand Trip" } as never);
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-2", summary: "Move...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeUpdatePlanStatus", { planId: "plan-1", targetStatus: "archived" });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(
      expect.anything(),
      "mcp",
      "updatePlanStatus",
      { planId: "plan-1", targetStatus: "archived" },
      expect.objectContaining({ summary: expect.any(String) }),
    );
  });

  it("proposeDeletePlan calls proposeCommand with commandType='deletePlan', never deleting anything itself", async () => {
    const domainApp = await import("@spencare/domain-application");
    vi.mocked(domainApp.getPlan).mockResolvedValue({ id: "plan-1", name: "Empty Draft" } as never);
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-3", summary: "Delete...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeDeletePlan", { planId: "plan-1" });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(expect.anything(), "mcp", "deletePlan", { planId: "plan-1" }, expect.anything());
  });

  it("proposeAssociatePlanGoal calls proposeCommand with commandType='associatePlanGoal', never writing the link itself", async () => {
    const domainApp = await import("@spencare/domain-application");
    const planId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
    const goalId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
    vi.mocked(domainApp.getPlan).mockResolvedValue({ id: planId, name: "Thailand Trip" } as never);
    vi.mocked(domainApp.listGoals).mockResolvedValue([{ id: goalId, name: "Travel Fund" }] as never);
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-4", summary: "Link...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeAssociatePlanGoal", { planId, goalId });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(expect.anything(), "mcp", "associatePlanGoal", { planId, goalId }, expect.anything());
  });

  it("proposeUpdateTransactionPlan calls proposeCommand with commandType='setTransactionPlan', never touching the transaction's own amount/type/account", async () => {
    const domainApp = await import("@spencare/domain-application");
    const planId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
    const transactionId = "6a0f2b9a-1111-4a11-8b11-000000000001";
    vi.mocked(domainApp.getPlan).mockResolvedValue({ id: planId, name: "Thailand Trip" } as never);
    vi.mocked(domainApp.proposeCommand).mockResolvedValue({ confirmationId: "conf-5", summary: "Attach...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });

    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("proposeUpdateTransactionPlan", { transactionId, planId, planItemId: null });

    expect(result.isError).toBeUndefined();
    expect(vi.mocked(domainApp.proposeCommand)).toHaveBeenCalledWith(
      expect.anything(),
      "mcp",
      "setTransactionPlan",
      { transactionId, planId, planItemId: null },
      expect.anything(),
    );
  });

  it("a read-only session cannot call any financial Plan propose tool", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["read"]));

    const result = await server.call("proposeCreatePlan", { name: "Thailand Trip", baseCurrency: "INR" });

    expect(result.isError).toBe(true);
    expect(result.data.code).toBe("INSUFFICIENT_SCOPE");
    expect(vi.mocked(domainApp.proposeCommand)).not.toHaveBeenCalled();
  });
});

describe("registerWriteTools — cancelPendingAction", () => {
  it("calls cancelPendingCommand and never touches confirmCommand", async () => {
    const domainApp = await import("@spencare/domain-application");
    const { registerWriteTools } = await import("./writeTools.js");
    const server = fakeServer();
    registerWriteTools(server as never, ctxWithScopes(["write"]));

    const result = await server.call("cancelPendingAction", { confirmationId: "6a0f2b9a-1111-4a11-8b11-000000000001" });

    expect(vi.mocked(domainApp.cancelPendingCommand)).toHaveBeenCalledWith(expect.anything(), "6a0f2b9a-1111-4a11-8b11-000000000001");
    expect(vi.mocked(domainApp.confirmCommand)).not.toHaveBeenCalled();
    expect(result.data).toEqual({ cancelled: true });
  });
});

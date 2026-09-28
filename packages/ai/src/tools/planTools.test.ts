import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@spencare/domain-application", () => ({
  listPlansWithSummaries: vi.fn(),
  listGoals: vi.fn(),
  listCommitments: vi.fn(),
  listAccounts: vi.fn(),
  getPlan: vi.fn(),
}));

vi.mock("../planContext.js", () => ({
  buildPlanContext: vi.fn(),
}));

vi.mock("../confirmation.js", () => ({
  proposeCommand: vi.fn(),
  describeAmountForProvider: vi.fn(() => "INR 500"),
}));

import { listPlansWithSummaries, listGoals, listCommitments, listAccounts, getPlan } from "@spencare/domain-application";
import { buildPlanContext } from "../planContext.js";
import { proposeCommand } from "../confirmation.js";

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPlans tool", () => {
  it("returns a lightweight summary per Plan, sourced entirely from listPlansWithSummaries (never recomputed)", async () => {
    vi.mocked(listPlansWithSummaries).mockResolvedValue([
      {
        plan: { id: "plan-1", name: "Thailand Trip", status: "active", base_currency: "INR", current_budget_minor: 2_000_000 } as never,
        calculations: {
          actualSpend: { amountMinorUnits: 500000n },
          budgetStatus: { overBudget: false },
          progress: { percentOfBudgetUsed: 25 },
        } as never,
      },
    ]);
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlansTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlans")!;
    const result = (await getPlansTool.execute({ ctx, privacyModeEnabled: false }, {})) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "plan-1",
      name: "Thailand Trip",
      status: "active",
      currentBudget: { amountMinor: 2_000_000, currency: "INR", source: "USER_DEFINED" },
      actualSpend: { amountMinor: 500000, currency: "INR", source: "ACTUAL" },
      overBudget: false,
      percentOfBudgetUsed: 25,
    });
  });

  it("redacts amounts under Privacy Mode", async () => {
    vi.mocked(listPlansWithSummaries).mockResolvedValue([
      {
        plan: { id: "plan-1", name: "Thailand Trip", status: "active", base_currency: "INR", current_budget_minor: 2_000_000 } as never,
        calculations: { actualSpend: { amountMinorUnits: 500000n }, budgetStatus: { overBudget: false }, progress: { percentOfBudgetUsed: 25 } } as never,
      },
    ]);
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlansTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlans")!;
    const result = (await getPlansTool.execute({ ctx, privacyModeEnabled: true }, {})) as Array<Record<string, unknown>>;
    expect(result[0]!.currentBudget).toEqual({ private: true });
    expect(result[0]!.actualSpend).toEqual({ private: true });
  });
});

describe("getPlanDetail tool", () => {
  it("returns the built Plan context when the Plan is found", async () => {
    const fakeContext = { id: "plan-1", name: "Thailand Trip" };
    vi.mocked(buildPlanContext).mockResolvedValue(fakeContext as never);
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlanDetailTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlanDetail")!;
    const result = await getPlanDetailTool.execute({ ctx, privacyModeEnabled: false }, { planId: "plan-1" });
    expect(result).toBe(fakeContext);
    expect(buildPlanContext).toHaveBeenCalledWith(ctx, "plan-1", false);
  });

  it("returns a clean not-found error when the Plan does not exist or belongs to another user -- never a different message that would leak which case it is", async () => {
    vi.mocked(buildPlanContext).mockResolvedValue(null);
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlanDetailTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlanDetail")!;
    const result = await getPlanDetailTool.execute({ ctx, privacyModeEnabled: false }, { planId: "someone-elses-plan" });
    expect(result).toEqual({ error: "Plan not found." });
  });

  it("rejects a missing planId without ever calling buildPlanContext", async () => {
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlanDetailTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlanDetail")!;
    const result = await getPlanDetailTool.execute({ ctx, privacyModeEnabled: false }, {});
    expect(result).toEqual({ error: "A planId is required." });
    expect(buildPlanContext).not.toHaveBeenCalled();
  });

  it("rejects a non-string planId (a model could send a number, object, or array) without ever calling buildPlanContext", async () => {
    const { PLAN_TOOLS } = await import("./planTools.js");
    const getPlanDetailTool = PLAN_TOOLS.find((t) => t.definition.name === "getPlanDetail")!;
    const result = await getPlanDetailTool.execute({ ctx, privacyModeEnabled: false }, { planId: { $ne: null } });
    expect(result).toEqual({ error: "A planId is required." });
    expect(buildPlanContext).not.toHaveBeenCalled();
  });
});

describe("Plan write tools (Gate 11) -- propose-only, never mutating themselves", () => {
  it("proposeCreatePlan calls proposeCommand with source='spensa' and commandType='createPlan'", async () => {
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-1", summary: "Create...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeCreatePlan")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { name: "Thailand Trip", baseCurrency: "INR" });

    expect(result.confirmationId).toBe("conf-1");
    expect(proposeCommand).toHaveBeenCalledWith(ctx, "spensa", "createPlan", expect.objectContaining({ name: "Thailand Trip", baseCurrency: "INR" }), expect.anything());
  });

  it("proposeUpdatePlanStatus calls proposeCommand with commandType='updatePlanStatus', never executing the transition itself", async () => {
    vi.mocked(getPlan).mockResolvedValue({ id: "plan-1", name: "Thailand Trip" } as never);
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-2", summary: "Move...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeUpdatePlanStatus")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { planId: "plan-1", targetStatus: "archived" });

    expect(result.confirmationId).toBe("conf-2");
    expect(proposeCommand).toHaveBeenCalledWith(ctx, "spensa", "updatePlanStatus", { planId: "plan-1", targetStatus: "archived" }, expect.anything());
  });

  it("proposeDeletePlan calls proposeCommand with commandType='deletePlan', never deleting anything itself", async () => {
    vi.mocked(getPlan).mockResolvedValue({ id: "plan-1", name: "Empty Draft" } as never);
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-3", summary: "Delete...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeDeletePlan")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { planId: "plan-1" });

    expect(result.confirmationId).toBe("conf-3");
    expect(proposeCommand).toHaveBeenCalledWith(ctx, "spensa", "deletePlan", { planId: "plan-1" }, expect.anything());
  });

  it("proposeCreatePlanItem calls proposeCommand with commandType='addPlanItem' at exact minor-unit precision, never rounded", async () => {
    vi.mocked(getPlan).mockResolvedValue({ id: "plan-1", name: "Thailand Trip" } as never);
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-4", summary: "Add...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeCreatePlanItem")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { planId: "plan-1", name: "Hotel", estimatedAmountMinor: 1742087, estimatedCurrency: "INR" });

    expect(result.confirmationId).toBe("conf-4");
    expect(proposeCommand).toHaveBeenCalledWith(
      ctx,
      "spensa",
      "addPlanItem",
      expect.objectContaining({ planId: "plan-1", name: "Hotel", estimatedAmountMinor: 1742087, estimatedCurrency: "INR" }),
      expect.anything(),
    );
  });

  it("proposeAssociatePlanGoal calls proposeCommand with commandType='associatePlanGoal', never writing the link itself", async () => {
    const planId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
    const goalId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";
    vi.mocked(getPlan).mockResolvedValue({ id: planId, name: "Thailand Trip" } as never);
    vi.mocked(listGoals).mockResolvedValue([{ id: goalId, name: "Travel Fund" }] as never);
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-5", summary: "Link...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeAssociatePlanGoal")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { planId, goalId });

    expect(result.confirmationId).toBe("conf-5");
    expect(proposeCommand).toHaveBeenCalledWith(ctx, "spensa", "associatePlanGoal", { planId, goalId }, expect.anything());
  });

  it("proposeUpdateTransactionPlan calls proposeCommand with commandType='setTransactionPlan', never touching the transaction's own amount/type/account", async () => {
    const planId = "8cad1f12-3b01-4a55-9aa9-3ce1fef58491";
    const transactionId = "6a0f2b9a-1111-4a11-8b11-000000000001";
    vi.mocked(getPlan).mockResolvedValue({ id: planId, name: "Thailand Trip" } as never);
    vi.mocked(proposeCommand).mockResolvedValue({ confirmationId: "conf-6", summary: "Attach...", fields: [], expiresAt: "2026-09-05T00:10:00Z" });
    const { PLAN_WRITE_TOOLS } = await import("./planTools.js");
    const tool = PLAN_WRITE_TOOLS.find((t) => t.definition.name === "proposeUpdateTransactionPlan")!;
    const result = await tool.execute({ ctx, privacyModeEnabled: false }, { transactionId, planId, planItemId: null });

    expect(result.confirmationId).toBe("conf-6");
    expect(proposeCommand).toHaveBeenCalledWith(ctx, "spensa", "setTransactionPlan", { transactionId, planId, planItemId: null }, expect.anything());
  });

  it("none of the 15 Plan write tools appear in PLAN_TOOLS (the read allowlist) -- reads and writes never share one list", async () => {
    const { PLAN_TOOLS, PLAN_WRITE_TOOLS } = await import("./planTools.js");
    expect(PLAN_WRITE_TOOLS).toHaveLength(15);
    const readNames = new Set(PLAN_TOOLS.map((t) => t.definition.name));
    for (const w of PLAN_WRITE_TOOLS) {
      expect(readNames.has(w.definition.name)).toBe(false);
    }
  });
});

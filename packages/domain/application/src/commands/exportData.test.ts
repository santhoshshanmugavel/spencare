import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

vi.mock("@spencare/domain-infra", () => ({
  listConversations: vi.fn(async () => [{ id: "conv-1", user_id: "user-1", title: "Chat", created_at: "t", updated_at: "t", archived_at: null }]),
  listMessages: vi.fn(async () => [{ id: "msg-1", conversation_id: "conv-1", role: "user", content: { kind: "text", text: "hi" }, created_at: "t" }]),
}));
vi.mock("../queries/getProfile.js", () => ({ getProfile: vi.fn(async () => ({ display_name: "Test User" })) }));
vi.mock("../queries/accounts.js", () => ({ listAccounts: vi.fn(async () => [{ id: "acc-1" }]) }));
vi.mock("../queries/transactions.js", () => ({ listTransactions: vi.fn(async () => [{ id: "txn-1" }]) }));
vi.mock("../queries/budgets.js", () => ({ listBudgets: vi.fn(async () => [{ id: "bud-1" }]) }));
vi.mock("../queries/goals.js", () => ({ listGoals: vi.fn(async () => [{ id: "goal-1" }]) }));
vi.mock("../queries/goalContributionPlans.js", () => ({ listGoalContributionPlans: vi.fn(async () => [{ id: "gcp-1" }]) }));
vi.mock("../queries/bills.js", () => ({ listBillPredictions: vi.fn(async () => [{ id: "bill-1" }]) }));

function ctx(): AuthContext {
  return { userId: "user-1", email: "user@example.com", supabase: {} as never, serviceRoleSupabase: {} as never };
}

beforeEach(() => vi.clearAllMocks());

describe("exportUserData", () => {
  it("bundles profile, accounts, transactions, budgets, goals, bills, and AI conversations with their messages", async () => {
    const { exportUserData } = await import("./exportData.js");
    const bundle = await exportUserData(ctx());

    expect(bundle.profile).toEqual({ display_name: "Test User" });
    expect(bundle.accounts).toEqual([{ id: "acc-1" }]);
    expect(bundle.transactions).toEqual([{ id: "txn-1" }]);
    expect(bundle.budgets).toEqual([{ id: "bud-1" }]);
    expect(bundle.goals).toEqual([{ id: "goal-1" }]);
    expect(bundle.goalContributionPlans).toEqual([{ id: "gcp-1" }]);
    expect(bundle.bills).toEqual([{ id: "bill-1" }]);
    expect(bundle.aiConversations).toEqual([
      { conversation: { id: "conv-1", user_id: "user-1", title: "Chat", created_at: "t", updated_at: "t", archived_at: null }, messages: [{ id: "msg-1", conversation_id: "conv-1", role: "user", content: { kind: "text", text: "hi" }, created_at: "t" }] },
    ]);
    expect(typeof bundle.exportedAt).toBe("string");
  });

  it("never includes secret-shaped fields anywhere in the serialized bundle", async () => {
    const { exportUserData } = await import("./exportData.js");
    const bundle = await exportUserData(ctx());
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toMatch(/encrypted_api_key|encrypted_refresh_token|totp_secret|backup_codes_hash|token_hash|service_role/i);
  });

  it("scopes every underlying query to the given AuthContext, never a client-supplied user id", async () => {
    const accountsModule = await import("../queries/accounts.js");
    const { exportUserData } = await import("./exportData.js");
    const c = ctx();

    await exportUserData(c);
    expect(vi.mocked(accountsModule.listAccounts)).toHaveBeenCalledWith(c, {});
  });
});

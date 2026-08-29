import { describe, expect, it, vi } from "vitest";

vi.mock("@spencare/domain-infra", () => ({
  proposeConfirmation: vi.fn(),
  callConfirmCommand: vi.fn(),
  cancelConfirmation: vi.fn(),
  getPendingConfirmation: vi.fn(),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };

describe("proposeCommand — canonical confirmation cascade (Phase 18: relocated from packages/ai, one implementation shared by Spensa and MCP)", () => {
  it("inserts a pending_confirmations row via the caller's own RLS-scoped client, never a service-role bypass", async () => {
    const { proposeConfirmation } = await import("@spencare/domain-infra");
    vi.mocked(proposeConfirmation).mockResolvedValue({
      id: "conf-1",
      user_id: "u1",
      source: "spensa",
      command_type: "createTransaction",
      payload: {},
      preview: {},
      status: "pending",
      created_at: "",
      expires_at: "2026-01-01T00:10:00Z",
      confirmed_at: null,
      cancelled_at: null,
    } as never);

    const { proposeCommand } = await import("./confirmation.js");
    const result = await proposeCommand(ctx, "spensa", "createTransaction", { accountId: "a1" }, { summary: "Record an expense", fields: [] });

    expect(result.confirmationId).toBe("conf-1");
    expect(vi.mocked(proposeConfirmation)).toHaveBeenCalledWith(
      ctx.supabase, // the user's OWN client, not serviceRoleSupabase
      "u1",
      expect.objectContaining({ source: "spensa", commandType: "createTransaction" }),
    );
  });

  it("passes the caller's own source through unchanged -- an MCP caller gets confirmation_source='mcp', never silently defaulted to 'spensa'", async () => {
    const { proposeConfirmation } = await import("@spencare/domain-infra");
    vi.mocked(proposeConfirmation).mockResolvedValue({
      id: "conf-2",
      user_id: "u1",
      source: "mcp",
      command_type: "createTransaction",
      payload: {},
      preview: {},
      status: "pending",
      created_at: "",
      expires_at: "",
      confirmed_at: null,
      cancelled_at: null,
    } as never);

    const { proposeCommand } = await import("./confirmation.js");
    await proposeCommand(ctx, "mcp", "createTransaction", { accountId: "a1" }, { summary: "Record an expense", fields: [] });

    expect(vi.mocked(proposeConfirmation)).toHaveBeenCalledWith(ctx.supabase, "u1", expect.objectContaining({ source: "mcp" }));
  });
});

describe("confirmCommand", () => {
  it("returns ok:true with the mutation result on success", async () => {
    const { callConfirmCommand } = await import("@spencare/domain-infra");
    vi.mocked(callConfirmCommand).mockResolvedValue({ id: "txn-1", type: "expense", amount_minor: 45000 } as never);

    const { confirmCommand } = await import("./confirmation.js");
    const result = await confirmCommand(ctx, "conf-1", "spensa");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ id: "txn-1", type: "expense", amount_minor: 45000 });
  });

  it("passes the caller's own actor through to callConfirmCommand -- an MCP caller confirms with audit_actor='mcp'", async () => {
    const { callConfirmCommand } = await import("@spencare/domain-infra");
    vi.mocked(callConfirmCommand).mockResolvedValue({ id: "txn-1" } as never);

    const { confirmCommand } = await import("./confirmation.js");
    await confirmCommand(ctx, "conf-1", "mcp");
    expect(vi.mocked(callConfirmCommand)).toHaveBeenCalledWith(ctx.supabase, "u1", "conf-1", "mcp");
  });

  it("surfaces confirmation_expired as a clear, structured error, never a raw Postgres error", async () => {
    const { callConfirmCommand } = await import("@spencare/domain-infra");
    vi.mocked(callConfirmCommand).mockRejectedValue({ code: "P0001", message: "confirmation_expired", details: null, hint: null });

    const { confirmCommand } = await import("./confirmation.js");
    const result = await confirmCommand(ctx, "conf-1", "spensa");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("confirmation_expired");
      expect(result.error.message).toMatch(/expired/i);
    }
  });

  it("surfaces confirmation_not_pending (double-confirmation) as a clear error", async () => {
    const { callConfirmCommand } = await import("@spencare/domain-infra");
    vi.mocked(callConfirmCommand).mockRejectedValue({ code: "P0001", message: "confirmation_not_pending" });

    const { confirmCommand } = await import("./confirmation.js");
    const result = await confirmCommand(ctx, "conf-1", "spensa");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("confirmation_not_pending");
  });
});

describe("describeAmountForProvider (re-exported)", () => {
  it("never includes a real number when Privacy Mode is on", async () => {
    const { describeAmountForProvider } = await import("./confirmation.js");
    expect(describeAmountForProvider(50000, "INR", true)).not.toMatch(/500|50000/);
  });
});

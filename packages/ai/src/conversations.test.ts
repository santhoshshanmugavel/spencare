import { describe, expect, it, vi, beforeEach } from "vitest";
import { FakeAiProviderAdapter } from "./adapters/fakeAdapter.js";

vi.mock("@spencare/domain-application", () => ({
  getProfile: vi.fn(),
  getSafeToSpend: vi.fn(),
  getDashboardSummary: vi.fn(),
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listBudgetsWithUsage: vi.fn(),
  listCategories: vi.fn(),
  listGoals: vi.fn(),
  calculateProgress: vi.fn(),
  getUpcomingBills: vi.fn(),
  getCashFlowOverview: vi.fn(),
  listBillPredictions: vi.fn(),
}));

vi.mock("@spencare/domain-infra", () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  archiveConversation: vi.fn(),
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
  touchConversation: vi.fn(),
  proposeConfirmation: vi.fn(),
  callConfirmCommand: vi.fn(),
  cancelConfirmation: vi.fn(),
  getPendingConfirmation: vi.fn(),
  getActiveEncryptedCredential: vi.fn(),
  decryptSecret: vi.fn(),
}));

const ctx = { userId: "u1", email: "a@b.com", supabase: {} as never, serviceRoleSupabase: {} as never };
const conversationId = "289f5e56-21a8-4ee0-865f-c02c11f4d874";

async function setupBaseMocks() {
  const app = await import("@spencare/domain-application");
  const infra = await import("@spencare/domain-infra");

  vi.mocked(app.getProfile).mockResolvedValue({ privacy_mode_enabled: false, preferred_currency: "INR" } as never);
  vi.mocked(app.getSafeToSpend).mockResolvedValue({ state: "no_accounts", amount: { amountMinorUnits: 0n, currencyCode: "INR" } } as never);
  vi.mocked(app.listAccounts).mockResolvedValue([] as never);
  vi.mocked(app.listBudgetsWithUsage).mockResolvedValue([] as never);
  vi.mocked(app.listCategories).mockResolvedValue([] as never);
  vi.mocked(app.listGoals).mockResolvedValue([] as never);
  vi.mocked(app.getUpcomingBills).mockResolvedValue([] as never);
  vi.mocked(app.getCashFlowOverview).mockResolvedValue({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 } as never);
  vi.mocked(app.listTransactions).mockResolvedValue([] as never);
  vi.mocked(app.listBillPredictions).mockResolvedValue([] as never);
  vi.mocked(infra.insertMessage).mockImplementation(async (_client, cid, role, content) => ({ id: `msg-${Math.random()}`, conversation_id: cid, role, content, created_at: "" }) as never);
  vi.mocked(infra.touchConversation).mockResolvedValue(undefined as never);

  return { app, infra };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getConversation / listConversations — thin, ownership-scoped wrappers", () => {
  it("getConversation passes userId through to the RLS-scoped repo call, never trusting a bare conversationId", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getConversation).mockResolvedValue({ id: conversationId, user_id: "u1", title: "Budget check", created_at: "", updated_at: "", archived_at: null } as never);

    const { getConversation } = await import("./conversations.js");
    const result = await getConversation(ctx, conversationId);

    expect(infra.getConversation).toHaveBeenCalledWith(ctx.supabase, "u1", conversationId);
    expect(result?.title).toBe("Budget check");
  });

  it("listConversations is scoped to the caller's own userId", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.listConversations).mockResolvedValue([] as never);

    const { listConversations } = await import("./conversations.js");
    await listConversations(ctx);

    expect(infra.listConversations).toHaveBeenCalledWith(ctx.supabase, "u1");
  });
});

describe("getConversationMessages — re-verifies ownership before returning any message", () => {
  it("returns an empty list, never another user's messages, when the conversation isn't the caller's", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getConversation).mockResolvedValue(null as never);

    const { getConversationMessages } = await import("./conversations.js");
    const messages = await getConversationMessages(ctx, conversationId);

    expect(messages).toEqual([]);
    expect(infra.listMessages).not.toHaveBeenCalled();
  });

  it("returns the conversation's messages once ownership is confirmed", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getConversation).mockResolvedValue({ id: conversationId, user_id: "u1", title: null, created_at: "", updated_at: "", archived_at: null } as never);
    vi.mocked(infra.listMessages).mockResolvedValue([{ id: "m1", conversation_id: conversationId, role: "user", content: { kind: "text", text: "hi" }, created_at: "" }] as never);

    const { getConversationMessages } = await import("./conversations.js");
    const messages = await getConversationMessages(ctx, conversationId);

    expect(messages).toHaveLength(1);
  });
});

describe("deleteConversation — archives, never hard-deletes", () => {
  it("calls archiveConversation, matching the existing archived_at model", async () => {
    const infra = await import("@spencare/domain-infra");
    const { deleteConversation } = await import("./conversations.js");
    await deleteConversation(ctx, conversationId);
    expect(infra.archiveConversation).toHaveBeenCalledWith(ctx.supabase, "u1", conversationId);
  });
});

describe("regenerateReply — replays the last user turn without duplicating it", () => {
  it("produces a fresh assistant reply and never inserts a second copy of the user's message", async () => {
    const assistantMessageId = "6a0f2b9a-1111-4a11-8b11-000000000002";
    const { infra } = await setupBaseMocks();
    vi.mocked(infra.getConversation).mockResolvedValue({ id: conversationId, user_id: "u1", title: null, created_at: "", updated_at: "", archived_at: null } as never);
    vi.mocked(infra.listMessages).mockResolvedValue([
      { id: "6a0f2b9a-1111-4a11-8b11-000000000001", conversation_id: conversationId, role: "user", content: { kind: "text", text: "How much can I spend?" }, created_at: "" },
      { id: assistantMessageId, conversation_id: conversationId, role: "assistant", content: { kind: "text", text: "Add an account first." }, created_at: "" },
    ] as never);

    const fake = new FakeAiProviderAdapter([{ kind: "text", text: "You have no accounts yet." }]);
    const { regenerateReply } = await import("./conversations.js");
    for await (const _ of regenerateReply(ctx, { conversationId, messageId: assistantMessageId }, { adapterOverride: fake })) {
      /* drain */
    }

    const userInserts = vi.mocked(infra.insertMessage).mock.calls.filter(([, , role]) => role === "user");
    expect(userInserts).toHaveLength(0);
    const assistantInserts = vi.mocked(infra.insertMessage).mock.calls.filter(([, , role]) => role === "assistant");
    expect(assistantInserts.some(([, , , content]) => (content as { kind: string; text?: string }).kind === "text" && (content as { text?: string }).text === "You have no accounts yet.")).toBe(true);
  });

  it("yields an explicit error, never a fabricated reply, when the target message has no preceding user turn", async () => {
    const assistantMessageId = "6a0f2b9a-1111-4a11-8b11-000000000002";
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getConversation).mockResolvedValue({ id: conversationId, user_id: "u1", title: null, created_at: "", updated_at: "", archived_at: null } as never);
    vi.mocked(infra.listMessages).mockResolvedValue([
      { id: assistantMessageId, conversation_id: conversationId, role: "assistant", content: { kind: "text", text: "Hi, how can I help?" }, created_at: "" },
    ] as never);

    const { regenerateReply } = await import("./conversations.js");
    const events = [];
    for await (const event of regenerateReply(ctx, { conversationId, messageId: assistantMessageId })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "Nothing to regenerate -- no prior user message found." }]);
  });

  it("yields an explicit error when the target messageId doesn't exist in this conversation", async () => {
    const infra = await import("@spencare/domain-infra");
    vi.mocked(infra.getConversation).mockResolvedValue({ id: conversationId, user_id: "u1", title: null, created_at: "", updated_at: "", archived_at: null } as never);
    vi.mocked(infra.listMessages).mockResolvedValue([] as never);

    const { regenerateReply } = await import("./conversations.js");
    const events = [];
    for await (const event of regenerateReply(ctx, { conversationId, messageId: "6a0f2b9a-1111-4a11-8b11-000000000099" })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "error", message: "That message wasn't found in this conversation." }]);
  });
});

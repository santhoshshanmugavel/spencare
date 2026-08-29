import { describe, expect, it } from "vitest";
import {
  proposeAddExpenseSchema,
  proposeGoalContributionSchema,
  confirmCommandSchema,
  cancelCommandSchema,
  sendMessageSchema,
  searchTransactionsToolSchema,
} from "./ai.js";
import { createExpenseSchema } from "./transactions.js";

describe("AI tool schemas reuse existing command schemas (ai-architecture.md §4)", () => {
  it("proposeAddExpenseSchema is literally the same schema object as createExpenseSchema", () => {
    expect(proposeAddExpenseSchema).toBe(createExpenseSchema);
  });

  it("rejects the exact same invalid input createExpenseSchema would reject", () => {
    const result = proposeAddExpenseSchema.safeParse({ kind: "expense", accountId: "not-a-uuid", amountMinor: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts a valid goal contribution proposal", () => {
    const result = proposeGoalContributionSchema.safeParse({
      goalId: "289f5e56-21a8-4ee0-865f-c02c11f4d874",
      accountId: "8cad1f12-3b01-4a55-9aa9-3ce1fef58491",
      amountMinor: 50000,
    });
    expect(result.success).toBe(true);
  });
});

describe("confirmCommandSchema / cancelCommandSchema", () => {
  it("requires a valid confirmationId", () => {
    expect(confirmCommandSchema.safeParse({ confirmationId: "not-a-uuid" }).success).toBe(false);
    expect(confirmCommandSchema.safeParse({ confirmationId: "289f5e56-21a8-4ee0-865f-c02c11f4d874" }).success).toBe(true);
    expect(cancelCommandSchema.safeParse({ confirmationId: "289f5e56-21a8-4ee0-865f-c02c11f4d874" }).success).toBe(true);
  });
});

describe("sendMessageSchema", () => {
  it("rejects an empty message", () => {
    expect(sendMessageSchema.safeParse({ conversationId: null, content: "" }).success).toBe(false);
  });

  it("rejects an oversized message (bounded message size, §14)", () => {
    expect(sendMessageSchema.safeParse({ conversationId: null, content: "a".repeat(8001) }).success).toBe(false);
  });

  it("accepts a new conversation (null id) or an existing one", () => {
    expect(sendMessageSchema.safeParse({ conversationId: null, content: "How much can I spend?" }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ conversationId: "289f5e56-21a8-4ee0-865f-c02c11f4d874", content: "hi" }).success).toBe(true);
  });
});

describe("searchTransactionsToolSchema", () => {
  it("defaults limit and caps it at 50", () => {
    const parsed = searchTransactionsToolSchema.parse({});
    expect(parsed.limit).toBe(10);
    expect(searchTransactionsToolSchema.safeParse({ limit: 51 }).success).toBe(false);
  });
});

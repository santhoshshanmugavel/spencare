import { describe, expect, it } from "vitest";
import type { AccountRow } from "@spencare/domain-infra";
import { toAiAccountSummaryInput } from "./aiAccountSummary.js";

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "a1",
    user_id: "u1",
    type: "bank",
    name: "HDFC Bank",
    currency: "INR",
    balance_minor: 1000000,
    credit_limit_minor: null,
    credit_used_minor: null,
    market_value_minor: null,
    is_archived: false,
    created_at: "",
    updated_at: "",
    statement_close_day: null,
    payment_due_day: null,
    ...overrides,
  };
}

describe("toAiAccountSummaryInput — shared account mapping (Phase 18 relocation)", () => {
  it("maps a bank/cash account as spendable, using balance_minor", () => {
    const result = toAiAccountSummaryInput(accountRow({ type: "bank", balance_minor: 500000 }));
    expect(result).toEqual({ id: "a1", name: "HDFC Bank", type: "bank", currency: "INR", spendable: true, balanceMinor: 500000 });
  });

  it("maps a credit_card account as non-spendable, using credit_limit_minor/credit_used_minor -- never balance_minor", () => {
    const result = toAiAccountSummaryInput(
      accountRow({ type: "credit_card", name: "HDFC Credit Card", balance_minor: 0, credit_limit_minor: 10000000, credit_used_minor: 3000000 }),
    );
    expect(result).toEqual({
      id: "a1",
      name: "HDFC Credit Card",
      type: "credit_card",
      currency: "INR",
      spendable: false,
      creditLimitMinor: 10000000,
      creditUsedMinor: 3000000,
    });
    expect(result).not.toHaveProperty("balanceMinor");
  });

  it("maps an investment account as non-spendable, using market_value_minor", () => {
    const result = toAiAccountSummaryInput(accountRow({ type: "investment", name: "Zerodha", market_value_minor: 5000000 }));
    expect(result).toEqual({ id: "a1", name: "Zerodha", type: "investment", currency: "INR", spendable: false, marketValueMinor: 5000000 });
  });

  it("defaults credit_limit_minor/credit_used_minor to 0 if somehow null on a credit_card row (defensive)", () => {
    const result = toAiAccountSummaryInput(accountRow({ type: "credit_card", credit_limit_minor: null, credit_used_minor: null }));
    expect(result).toMatchObject({ creditLimitMinor: 0, creditUsedMinor: 0 });
  });
});

import { describe, expect, it } from "vitest";
import type { AccountRow } from "@spencare/domain-infra";
import { toAiAccountSummaryInput, toAiAccountSummariesForContext } from "./aiAccountSummary.js";

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

  it("EPFO AI safety (Phase 3 Part 2): returns null rather than a fabricated ₹0", () => {
    // Spensa must never say "your EPFO is ₹0" when the real EPFO balance
    // may be lakhs. Until the Phase 11 integration wires a real async
    // ledger lookup, this mapper returns null for EPFO so EPFO is
    // simply absent from the AI context -- a safer failure mode than
    // a wrong number.
    const result = toAiAccountSummaryInput(accountRow({ type: "epfo", name: "EPFO" }));
    expect(result).toBeNull();
  });
});

describe("toAiAccountSummariesForContext — filters out EPFO nulls", () => {
  it("maps a mixed list, dropping EPFO entries, keeping bank/credit/investment", () => {
    const accounts = [
      accountRow({ id: "b1", type: "bank", name: "HDFC", balance_minor: 500000 }),
      accountRow({ id: "e1", type: "epfo", name: "EPFO" }),
      accountRow({ id: "c1", type: "credit_card", name: "AmEx", credit_limit_minor: 100000, credit_used_minor: 20000 }),
      accountRow({ id: "i1", type: "investment", name: "Zerodha", market_value_minor: 300000 }),
      accountRow({ id: "e2", type: "epfo", name: "EPFO second" }),
    ];
    const result = toAiAccountSummariesForContext(accounts);
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toEqual(["b1", "c1", "i1"]);
    // No EPFO row should ever appear in this list.
    expect(result.find((a) => a.type === "epfo")).toBeUndefined();
  });

  it("empty input returns empty output", () => {
    expect(toAiAccountSummariesForContext([])).toEqual([]);
  });
});

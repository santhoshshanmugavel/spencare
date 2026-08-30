import { describe, expect, it } from "vitest";
import { findTransferPairs, type TransferMatchCandidate } from "./transferMatching.js";

function candidate(overrides: Partial<TransferMatchCandidate> = {}): TransferMatchCandidate {
  return {
    id: "c1",
    amountMinor: 50000,
    direction: "expense",
    occurredAt: "2026-08-12",
    accountId: "acc-a",
    ...overrides,
  };
}

describe("findTransferPairs", () => {
  it("pairs an expense on one account with a matching income on a different account, close in date", () => {
    const expense = candidate({ id: "e1", direction: "expense", accountId: "acc-a", occurredAt: "2026-08-12" });
    const income = candidate({ id: "i1", direction: "income", accountId: "acc-b", occurredAt: "2026-08-13" });

    const pairs = findTransferPairs([expense, income]);
    expect(pairs).toEqual([{ expenseCandidateId: "e1", incomeCandidateId: "i1", score: 1 }]);
  });

  it("never pairs two legs on the SAME account", () => {
    const expense = candidate({ id: "e1", direction: "expense", accountId: "acc-a" });
    const income = candidate({ id: "i1", direction: "income", accountId: "acc-a" });

    expect(findTransferPairs([expense, income])).toEqual([]);
  });

  it("requires an EXACT amount match -- no tolerance", () => {
    const expense = candidate({ id: "e1", direction: "expense", accountId: "acc-a", amountMinor: 50000 });
    const income = candidate({ id: "i1", direction: "income", accountId: "acc-b", amountMinor: 50001 });

    expect(findTransferPairs([expense, income])).toEqual([]);
  });

  it("does not pair legs outside the date window", () => {
    const expense = candidate({ id: "e1", direction: "expense", accountId: "acc-a", occurredAt: "2026-08-01" });
    const income = candidate({ id: "i1", direction: "income", accountId: "acc-b", occurredAt: "2026-08-10" });

    expect(findTransferPairs([expense, income])).toEqual([]);
  });

  it("never claims the same candidate for two pairs -- picks the closest-date counterpart", () => {
    const expense = candidate({ id: "e1", direction: "expense", accountId: "acc-a", amountMinor: 50000, occurredAt: "2026-08-12" });
    const closeIncome = candidate({ id: "i1", direction: "income", accountId: "acc-b", amountMinor: 50000, occurredAt: "2026-08-12" });
    const fartherIncome = candidate({ id: "i2", direction: "income", accountId: "acc-c", amountMinor: 50000, occurredAt: "2026-08-13" });

    const pairs = findTransferPairs([expense, closeIncome, fartherIncome]);
    expect(pairs).toEqual([{ expenseCandidateId: "e1", incomeCandidateId: "i1", score: 1 }]);
  });

  it("never merges unrelated transactions with different amounts and accounts", () => {
    const a = candidate({ id: "a", direction: "expense", accountId: "acc-a", amountMinor: 10000 });
    const b = candidate({ id: "b", direction: "income", accountId: "acc-b", amountMinor: 99999 });

    expect(findTransferPairs([a, b])).toEqual([]);
  });

  it("returns no pairs for an empty candidate list", () => {
    expect(findTransferPairs([])).toEqual([]);
  });
});

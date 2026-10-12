import { describe, expect, it } from "vitest";
import { projectDeterministicBalances, type ForecastInput, type KnownFutureEvent } from "./forecasting.js";

function makeInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    currentBalances: [{ accountId: "acc-1", balanceMinor: 100000, type: "bank" }],
    knownFutureEvents: [],
    forecastHorizonDays: 7,
    baselineDate: "2026-01-01",
    currency: "INR",
    dataCompleteness: "complete",
    limitations: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<KnownFutureEvent> = {}): KnownFutureEvent {
  return {
    id: "evt-1",
    type: "commitment",
    expectedDate: "2026-01-03",
    amountMinor: 5000,
    currency: "INR",
    confidence: "confirmed",
    sourceEntityId: "c-1",
    sourceEntityType: "commitment",
    description: "Rent",
    ...overrides,
  };
}

describe("projectDeterministicBalances", () => {
  it("returns a balance entry for each day including baseline", () => {
    const result = projectDeterministicBalances(makeInput({ forecastHorizonDays: 3 }));
    expect(result.projectedBalances).toHaveLength(4); // day 0..3
    expect(result.projectedBalances[0]!.date).toBe("2026-01-01");
    expect(result.projectedBalances[3]!.date).toBe("2026-01-04");
  });

  it("starting balance is correct with no events", () => {
    const result = projectDeterministicBalances(makeInput());
    expect(result.projectedBalances[0]!.projectedBalanceMinor).toBe(100000);
    expect(result.projectedBalances[7]!.projectedBalanceMinor).toBe(100000);
  });

  it("deducts confirmed commitment on the correct day", () => {
    const result = projectDeterministicBalances(
      makeInput({ knownFutureEvents: [makeEvent({ expectedDate: "2026-01-03", amountMinor: 5000 })] }),
    );
    // Day 0, 1, 2: unchanged
    expect(result.projectedBalances[2]!.projectedBalanceMinor).toBe(100000);
    // Day 3: deducted
    expect(result.projectedBalances[3]!.projectedBalanceMinor).toBe(95000);
  });

  it("adds income event on the correct day", () => {
    const result = projectDeterministicBalances(
      makeInput({
        knownFutureEvents: [makeEvent({ type: "income", expectedDate: "2026-01-02", amountMinor: 20000, confidence: "confirmed" })],
      }),
    );
    expect(result.projectedBalances[2]!.projectedBalanceMinor).toBe(120000);
  });

  it("INVARIANT: estimated events are excluded from projection", () => {
    const result = projectDeterministicBalances(
      makeInput({
        knownFutureEvents: [makeEvent({ confidence: "estimated", amountMinor: 50000 })],
      }),
    );
    // Balance should remain unchanged (50000 estimated commitment not applied)
    expect(result.projectedBalances[7]!.projectedBalanceMinor).toBe(100000);
  });

  it("predicted events ARE included in projection", () => {
    const result = projectDeterministicBalances(
      makeInput({
        knownFutureEvents: [makeEvent({ confidence: "predicted", amountMinor: 3000, expectedDate: "2026-01-01" })],
      }),
    );
    // Events from the baseline date settle into entry[1] (the opening balance of day 1).
    expect(result.projectedBalances[1]!.projectedBalanceMinor).toBe(97000);
  });

  it("isCertain is true when no non-confirmed events on that day", () => {
    const result = projectDeterministicBalances(makeInput({ forecastHorizonDays: 1 }));
    expect(result.projectedBalances[0]!.isCertain).toBe(true);
  });

  it("isCertain is false when a predicted event is applied", () => {
    const result = projectDeterministicBalances(
      makeInput({
        forecastHorizonDays: 1,
        knownFutureEvents: [makeEvent({ confidence: "predicted", expectedDate: "2026-01-01" })],
      }),
    );
    // Baseline-date event settles into entry[1]; entry[0] is the bare opening balance.
    expect(result.projectedBalances[1]!.isCertain).toBe(false);
  });

  it("tracks the lowest projected balance and its date", () => {
    const events: KnownFutureEvent[] = [
      makeEvent({ id: "e1", expectedDate: "2026-01-02", amountMinor: 80000, confidence: "confirmed" }),
      makeEvent({ id: "e2", expectedDate: "2026-01-04", amountMinor: 10000, confidence: "confirmed" }),
    ];
    const result = projectDeterministicBalances(makeInput({ knownFutureEvents: events }));
    // After day 2: 100000 - 80000 = 20000; after day 4: 20000 - 10000 = 10000 (lowest)
    expect(result.lowestProjectedBalanceMinor).toBe(10000);
    expect(result.lowestBalanceDate).toBe("2026-01-05");
  });

  it("horizon=0 returns only the baseline day", () => {
    const result = projectDeterministicBalances(makeInput({ forecastHorizonDays: 0 }));
    expect(result.projectedBalances).toHaveLength(1);
  });

  it("throws for negative horizon", () => {
    expect(() => projectDeterministicBalances(makeInput({ forecastHorizonDays: -1 }))).toThrow();
  });

  it("multiple accounts: starting balance is the sum of all balances", () => {
    const result = projectDeterministicBalances(
      makeInput({
        currentBalances: [
          { accountId: "acc-1", balanceMinor: 40000, type: "bank" },
          { accountId: "acc-2", balanceMinor: 60000, type: "cash" },
        ],
      }),
    );
    expect(result.projectedBalances[0]!.projectedBalanceMinor).toBe(100000);
  });

  it("calculatedAt is a valid ISO string", () => {
    const result = projectDeterministicBalances(makeInput());
    expect(() => new Date(result.calculatedAt)).not.toThrow();
  });
});

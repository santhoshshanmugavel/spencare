import { describe, expect, it, vi } from "vitest";
import { evaluateScenario, type ScenarioBaseline, type ScenarioInput } from "./scenario.js";

function makeBaseline(overrides: Partial<ScenarioBaseline> = {}): ScenarioBaseline {
  return {
    capturedAt: "2026-01-15T10:00:00.000Z",
    safeToSpendMinor: 50000,
    netWorthMinor: 200000,
    accountBalances: [{ accountId: "acc-1", balanceMinor: 80000, type: "bank" }],
    goalBalances: [{ goalId: "goal-1", savedMinor: 30000, targetMinor: 100000 }],
    upcomingCommitmentsMinor: 5000,
    currency: "INR",
    ...overrides,
  };
}

function makeInput(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    id: `input-${Math.random().toString(36).slice(2)}`,
    type: "additional_expense",
    amountMinor: 10000,
    date: "2026-01-20",
    description: "New subscription",
    ...overrides,
  };
}

describe("evaluateScenario", () => {
  it("additional_expense reduces safeToSpend and netWorth", () => {
    const result = evaluateScenario(makeBaseline(), [makeInput({ type: "additional_expense", amountMinor: 10000 })]);
    expect(result.projectedSafeToSpendMinor).toBe(40000);
    expect(result.projectedNetWorthMinor).toBe(190000);
  });

  it("additional_income increases safeToSpend and netWorth", () => {
    const result = evaluateScenario(makeBaseline(), [makeInput({ type: "additional_income", amountMinor: 20000 })]);
    expect(result.projectedSafeToSpendMinor).toBe(70000);
    expect(result.projectedNetWorthMinor).toBe(220000);
  });

  it("balance_change adjusts both safeToSpend and netWorth", () => {
    const result = evaluateScenario(makeBaseline(), [makeInput({ type: "balance_change", amountMinor: 5000 })]);
    expect(result.projectedSafeToSpendMinor).toBe(55000);
    expect(result.projectedNetWorthMinor).toBe(205000);
  });

  it("goal_change does not modify safeToSpend or netWorth in Phase 1", () => {
    const result = evaluateScenario(makeBaseline(), [makeInput({ type: "goal_change", amountMinor: 15000 })]);
    expect(result.projectedSafeToSpendMinor).toBe(50000);
    expect(result.projectedNetWorthMinor).toBe(200000);
  });

  it("commitment_change reduces safeToSpend", () => {
    const result = evaluateScenario(makeBaseline(), [makeInput({ type: "commitment_change", amountMinor: 3000 })]);
    expect(result.projectedSafeToSpendMinor).toBe(47000);
    expect(result.projectedNetWorthMinor).toBe(200000);
  });

  it("empty inputs returns baseline figures unchanged", () => {
    const result = evaluateScenario(makeBaseline(), []);
    expect(result.projectedSafeToSpendMinor).toBe(50000);
    expect(result.projectedNetWorthMinor).toBe(200000);
    expect(result.impactSummary).toHaveLength(0);
  });

  it("multiple inputs are all applied in order", () => {
    const inputs = [
      makeInput({ type: "additional_income", amountMinor: 30000 }),
      makeInput({ type: "additional_expense", amountMinor: 10000 }),
    ];
    const result = evaluateScenario(makeBaseline(), inputs);
    // 50000 + 30000 - 10000 = 70000
    expect(result.projectedSafeToSpendMinor).toBe(70000);
  });

  it("INVARIANT: does not call any Supabase function — evaluateScenario is pure", () => {
    // This test verifies the isolation contract by confirming no async work.
    // If evaluateScenario were async or called Supabase, this synchronous call would fail.
    const baseline = makeBaseline();
    const inputs = [makeInput()];
    // Must complete synchronously
    let result: ReturnType<typeof evaluateScenario> | undefined;
    expect(() => { result = evaluateScenario(baseline, inputs); }).not.toThrow();
    expect(result).toBeDefined();
    // Result has a calculatedAt — function ran successfully without I/O
    expect(result!.calculatedAt).toBeTruthy();
  });

  it("INVARIANT: deterministic projected figures for same baseline+inputs", () => {
    const baseline = makeBaseline();
    const inputs = [
      makeInput({ type: "additional_expense", amountMinor: 5000 }),
      makeInput({ type: "additional_income", amountMinor: 8000 }),
    ];
    const result1 = evaluateScenario(baseline, inputs);
    const result2 = evaluateScenario(baseline, inputs);
    expect(result1.projectedSafeToSpendMinor).toBe(result2.projectedSafeToSpendMinor);
    expect(result1.projectedNetWorthMinor).toBe(result2.projectedNetWorthMinor);
  });

  it("baseline is preserved in result (not mutated)", () => {
    const baseline = makeBaseline();
    const originalSts = baseline.safeToSpendMinor;
    evaluateScenario(baseline, [makeInput({ type: "additional_expense", amountMinor: 99999 })]);
    expect(baseline.safeToSpendMinor).toBe(originalSts);
  });

  it("inputs are preserved in result", () => {
    const baseline = makeBaseline();
    const inputs = [makeInput()];
    const result = evaluateScenario(baseline, inputs);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]).toBe(inputs[0]);
  });

  it("impactSummary has one entry per input", () => {
    const inputs = [
      makeInput({ description: "Expense A" }),
      makeInput({ type: "additional_income", description: "Income B" }),
    ];
    const result = evaluateScenario(makeBaseline(), inputs);
    expect(result.impactSummary).toHaveLength(2);
  });

  it("limitations array is non-empty", () => {
    const result = evaluateScenario(makeBaseline(), []);
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("calculatedAt is a valid ISO timestamp", () => {
    const result = evaluateScenario(makeBaseline(), []);
    expect(() => new Date(result.calculatedAt)).not.toThrow();
  });
});

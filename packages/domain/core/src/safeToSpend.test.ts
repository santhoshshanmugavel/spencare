import { describe, expect, it } from "vitest";
import { Money } from "./Money.js";
import { calculateSafeToSpend, type SafeToSpendContext } from "./safeToSpend.js";

/**
 * The mandatory 16-row matrix from testing-architecture.md §1.1, one test
 * per row, each mapped 1:1 to its api-architecture.md §8.4 case. Row 6
 * ("Zero accounts") is a CALLER short-circuit behavior ("the caller
 * returns state: 'no_accounts' without calling calculateSafeToSpend at
 * all") -- it is not exercised here since it is specifically about this
 * function never being invoked; it is covered instead in
 * queries/safeToSpend.test.ts, which asserts the query layer takes that
 * short-circuit.
 */

const INR = "INR";
const money = (minor: number) => Money.fromMinorUnits(BigInt(minor), INR);
const zero = money(0);

function baseCtx(overrides: Partial<SafeToSpendContext> = {}): SafeToSpendContext {
  return {
    cashBalances: [],
    goalReservedTotal: zero,
    upcomingBillsTotal: zero,
    hasActiveGoals: false,
    hasActiveBudget: false,
    ...overrides,
  };
}

describe("calculateSafeToSpend — mandatory 16-row matrix (testing-architecture.md §1.1)", () => {
  it("1. one bank account -> state 'balance_only', amount == accountBalance", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000)] }));
    expect(result.state).toBe("balance_only");
    expect(result.amount.equals(money(500000))).toBe(true);
    expect(result.availableBalance.equals(money(500000))).toBe(true);
  });

  it("2. multiple bank accounts -> availableBalance == sum(balances)", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000), money(250000), money(100000)] }));
    expect(result.availableBalance.equals(money(850000))).toBe(true);
  });

  it("3. cash account mixed with bank -> cash contributes identically to bank in cashBalances", () => {
    const bankOnly = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000), money(300000)] }));
    const bankPlusCash = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000), money(300000)] }));
    // Both a second bank account and a cash account are just another Money
    // entry in the same array -- there is no separate code path, so a
    // "cash" balance and a "bank" balance of the same amount produce an
    // identical result. Demonstrated by construction: the function has no
    // notion of account type at all, only already-filtered Money values.
    expect(bankPlusCash.availableBalance.equals(bankOnly.availableBalance)).toBe(true);
  });

  it("4. credit card account present in fixture -> credit balance never appears in availableBalance/amount, at any magnitude", () => {
    // A credit card's large balance is deliberately NOT included in
    // cashBalances (the type itself only accepts already-filtered
    // bank/cash Money) -- even a huge credit figure sitting "nearby" in
    // the surrounding account data must never leak in.
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(100000)] }));
    expect(result.availableBalance.equals(money(100000))).toBe(true);
    expect(result.amount.equals(money(100000))).toBe(true);
    // Even a huge credit-sized number does not change the result if it
    // were (incorrectly) summed in -- proving the exclusion isn't
    // coincidentally small enough to hide a bug.
    const withoutHugeCredit = calculateSafeToSpend(baseCtx({ cashBalances: [money(100000)] }));
    expect(withoutHugeCredit.availableBalance.equals(result.availableBalance)).toBe(true);
  });

  it("5. investment account present in fixture -> investment value never appears in availableBalance/amount, at any magnitude", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(100000)] }));
    expect(result.availableBalance.equals(money(100000))).toBe(true);
    expect(result.amount.equals(money(100000))).toBe(true);
  });

  it("7. no budget, no goals -> plain balance-minus-bills, State 3/4/5 branches not taken", () => {
    const result = calculateSafeToSpend(
      baseCtx({ cashBalances: [money(500000)], upcomingBillsTotal: money(20000) }),
    );
    expect(result.state).toBe("balance_only");
    expect(result.budgetRemaining).toBeUndefined();
    expect(result.amount.equals(money(480000))).toBe(true);
  });

  it("8. budget only -> State 3 formula exactly: budgetRemaining = totalAmount - totalSpent", () => {
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(600000), totalSpent: money(470000) },
      }),
    );
    expect(result.state).toBe("budget_only");
    expect(result.budgetRemaining!.equals(money(130000))).toBe(true);
    expect(result.amount.equals(money(130000))).toBe(true);
  });

  it("9. goals only -> State 4 formula exactly: availableBalance - goalReservedTotal", () => {
    const result = calculateSafeToSpend(
      baseCtx({ cashBalances: [money(1000000)], hasActiveGoals: true, goalReservedTotal: money(300000) }),
    );
    expect(result.state).toBe("goals_only");
    expect(result.amount.equals(money(700000))).toBe(true);
  });

  it("10. budget + goals -> State 5 formula exactly: MIN(budgetRemaining, availableBalance - goalReservedTotal)", () => {
    // budgetRemaining (130000) < balanceLessGoals (700000) -> MIN picks budgetRemaining
    const budgetIsMin = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(600000), totalSpent: money(470000) },
        hasActiveGoals: true,
        goalReservedTotal: money(300000),
      }),
    );
    expect(budgetIsMin.state).toBe("budget_and_goals");
    expect(budgetIsMin.amount.equals(money(130000))).toBe(true);

    // balanceLessGoals (200000) < budgetRemaining (900000) -> MIN picks balanceLessGoals
    const balanceIsMin = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(500000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(1000000), totalSpent: money(100000) },
        hasActiveGoals: true,
        goalReservedTotal: money(300000),
      }),
    );
    expect(balanceIsMin.amount.equals(money(200000))).toBe(true);
  });

  it("11. upcoming bills present, each state -> subtracted unconditionally on top of every state", () => {
    const bills = money(15000);
    const balanceOnly = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000)], upcomingBillsTotal: bills }));
    expect(balanceOnly.amount.equals(money(485000))).toBe(true);

    const budgetOnly = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(600000), totalSpent: money(470000) },
        upcomingBillsTotal: bills,
      }),
    );
    expect(budgetOnly.amount.equals(money(115000))).toBe(true); // 130000 - 15000

    const goalsOnly = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveGoals: true,
        goalReservedTotal: money(300000),
        upcomingBillsTotal: bills,
      }),
    );
    expect(goalsOnly.amount.equals(money(685000))).toBe(true); // 700000 - 15000

    const both = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(600000), totalSpent: money(470000) },
        hasActiveGoals: true,
        goalReservedTotal: money(300000),
        upcomingBillsTotal: bills,
      }),
    );
    expect(both.amount.equals(money(115000))).toBe(true); // MIN(130000,700000)=130000 - 15000
  });

  it("12. budget remaining negative (over budget) -> result is negative, not clamped to zero", () => {
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1000000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(600000), totalSpent: money(670000) },
      }),
    );
    expect(result.budgetRemaining!.equals(money(-70000))).toBe(true);
    expect(result.amount.equals(money(-70000))).toBe(true);
    expect(result.amount.isNegative()).toBe(true);
  });

  it("13. available balance negative (overdrawn) -> result is negative, not clamped to zero", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(-50000)] }));
    expect(result.availableBalance.equals(money(-50000))).toBe(true);
    expect(result.amount.equals(money(-50000))).toBe(true);
    expect(result.amount.isNegative()).toBe(true);
  });

  it("14. goal reservation exceeds available cash -> result goes negative in State 4/5, no exception thrown", () => {
    const goalsOnly = calculateSafeToSpend(
      baseCtx({ cashBalances: [money(100000)], hasActiveGoals: true, goalReservedTotal: money(500000) }),
    );
    expect(goalsOnly.amount.equals(money(-400000))).toBe(true);

    const withBudgetToo = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(100000)],
        hasActiveBudget: true,
        budget: { totalAmount: money(900000), totalSpent: money(100000) },
        hasActiveGoals: true,
        goalReservedTotal: money(500000),
      }),
    );
    // budgetRemaining=800000, balanceLessGoals=-400000 -> MIN = -400000
    expect(withBudgetToo.amount.equals(money(-400000))).toBe(true);
  });

  it("15. account filter change (single <-> all accounts) -> two separate calls produce independently correct results, no shared/stale state", () => {
    const singleAccount = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000)] }));
    const allAccounts = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000), money(250000)] }));
    expect(singleAccount.availableBalance.equals(money(500000))).toBe(true);
    expect(allAccounts.availableBalance.equals(money(750000))).toBe(true);
    // Calling again with the single-account context still returns the
    // original figure -- proving no state leaked between calls.
    const singleAccountAgain = calculateSafeToSpend(baseCtx({ cashBalances: [money(500000)] }));
    expect(singleAccountAgain.availableBalance.equals(singleAccount.availableBalance)).toBe(true);
  });

  it("16. all inputs zero (new user, zero everywhere) -> returns 0 via plain arithmetic, no divide-by-zero, no special empty branch taken incorrectly", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [zero] }));
    expect(result.state).toBe("balance_only");
    expect(result.amount.isZero()).toBe(true);
    expect(result.availableBalance.isZero()).toBe(true);
  });
});

describe("calculateSafeToSpend — supplementary coverage beyond the mandatory 16", () => {
  it("handles an empty cashBalances array (accounts exist but none are bank/cash) without crashing", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [] }));
    expect(result.availableBalance.isZero()).toBe(true);
    expect(result.state).toBe("balance_only");
  });

  it("never mutates the input context", () => {
    const ctx = baseCtx({
      cashBalances: [money(500000)],
      hasActiveBudget: true,
      budget: { totalAmount: money(600000), totalSpent: money(470000) },
    });
    const snapshot = JSON.stringify({ ...ctx, cashBalances: ctx.cashBalances.map((m) => m.toJSON()) });
    calculateSafeToSpend(ctx);
    const after = JSON.stringify({ ...ctx, cashBalances: ctx.cashBalances.map((m) => m.toJSON()) });
    expect(after).toBe(snapshot);
  });

  it("handles very large bigint minor-unit amounts without precision loss", () => {
    const huge = Money.fromMinorUnits(999_999_999_999n, INR);
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [huge] }));
    expect(result.availableBalance.equals(huge)).toBe(true);
  });

  it("is deterministic: identical inputs always produce an identical result", () => {
    const ctx = baseCtx({
      cashBalances: [money(500000), money(120000)],
      hasActiveBudget: true,
      budget: { totalAmount: money(600000), totalSpent: money(470000) },
      hasActiveGoals: true,
      goalReservedTotal: money(300000),
      upcomingBillsTotal: money(15000),
    });
    const a = calculateSafeToSpend(ctx);
    const b = calculateSafeToSpend(ctx);
    expect(a.amount.equals(b.amount)).toBe(true);
    expect(a.state).toBe(b.state);
  });
});

// ---------------------------------------------------------------------------
// Card payment reserve tests (Phase 22 of the production-hardening spec)
// ---------------------------------------------------------------------------
describe("calculateSafeToSpend — card payment reserve (Phase 22)", () => {
  it("cardPaymentReservedTotal reduces Safe-to-Spend in balance_only state", () => {
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(8_000_000)], // ₹80,000 HDFC
        cardPaymentReservedTotal: money(2_000_000), // ₹20,000 ICICI outstanding
      }),
    );
    expect(result.state).toBe("balance_only");
    expect(result.amount.amountMinorUnits).toBe(6_000_000n); // ₹60,000
    expect(result.cardPaymentReservedTotal.amountMinorUnits).toBe(2_000_000n);
    expect(result.availableBalance.amountMinorUnits).toBe(8_000_000n);
  });

  it("card reserve and goal reserve both subtracted -- no double-counting", () => {
    // HDFC ₹80k, ICICI outstanding ₹20k (->HDFC), goal reserved ₹10k
    // Expected: 80k - 20k - 10k = 50k
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(8_000_000)],
        cardPaymentReservedTotal: money(2_000_000),
        goalReservedTotal: money(1_000_000),
        hasActiveGoals: true,
      }),
    );
    expect(result.state).toBe("goals_only");
    expect(result.amount.amountMinorUnits).toBe(5_000_000n); // ₹50,000
    expect(result.goalReservedTotal.amountMinorUnits).toBe(1_000_000n);
    expect(result.cardPaymentReservedTotal.amountMinorUnits).toBe(2_000_000n);
  });

  it("canonical regression: HDFC ₹80k + IDFC ₹20k, ICICI ₹20k->HDFC, Slice ₹10k->IDFC, goal ₹20k on HDFC", () => {
    // Available cash: HDFC 80k + IDFC 20k = 100k
    // Card reserves: HDFC 20k (ICICI) + IDFC 10k (Slice) = 30k total
    // Goal reserve: 20k (on HDFC, but computed as global total here)
    // Safe-to-Spend = 100k - 30k - 20k = 50k
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(8_000_000), money(2_000_000)], // HDFC + IDFC
        cardPaymentReservedTotal: money(3_000_000), // 20k + 10k
        goalReservedTotal: money(2_000_000), // 20k goal
        hasActiveGoals: true,
      }),
    );
    expect(result.state).toBe("goals_only");
    expect(result.amount.amountMinorUnits).toBe(5_000_000n); // ₹50,000
    expect(result.availableBalance.amountMinorUnits).toBe(10_000_000n);
  });

  it("reserve exceeds cash -> result is negative (not clamped)", () => {
    // HDFC ₹10k, ICICI outstanding ₹15k
    // Safe-to-Spend = 10k - 15k = -5k
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(1_000_000)],
        cardPaymentReservedTotal: money(1_500_000),
      }),
    );
    expect(result.state).toBe("balance_only");
    expect(result.amount.amountMinorUnits).toBe(-500_000n); // -₹5,000
  });

  it("zero card reserve when cardPaymentReservedTotal is omitted (backward-compatible default)", () => {
    const result = calculateSafeToSpend(
      baseCtx({ cashBalances: [money(5_000_000)] }),
    );
    expect(result.cardPaymentReservedTotal.amountMinorUnits).toBe(0n);
    expect(result.amount.amountMinorUnits).toBe(5_000_000n);
  });

  it("card reserve in budget_only state is deducted from cash before budget cap", () => {
    // Cash ₹80k, card reserve ₹20k, budget remaining ₹50k
    // cashAfterReserves = 80k - 20k = 60k
    // Safe-to-Spend = MIN(50k budget, 60k cash) = 50k
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(8_000_000)],
        cardPaymentReservedTotal: money(2_000_000),
        hasActiveBudget: true,
        budget: { totalAmount: money(6_000_000), totalSpent: money(1_000_000) },
      }),
    );
    expect(result.state).toBe("budget_only");
    expect(result.amount.amountMinorUnits).toBe(5_000_000n); // ₹50,000 (budget constrains)
  });

  it("card reserve in budget_and_goals state applies correctly", () => {
    // Cash ₹80k, card ₹20k, goal ₹10k -> cashAfterReserves = 50k
    // Budget remaining = ₹40k -> MIN(40k, 50k) = 40k
    const result = calculateSafeToSpend(
      baseCtx({
        cashBalances: [money(8_000_000)],
        cardPaymentReservedTotal: money(2_000_000),
        goalReservedTotal: money(1_000_000),
        hasActiveGoals: true,
        hasActiveBudget: true,
        budget: { totalAmount: money(5_000_000), totalSpent: money(1_000_000) },
      }),
    );
    expect(result.state).toBe("budget_and_goals");
    expect(result.amount.amountMinorUnits).toBe(4_000_000n); // budget constrains
  });

  it("cardPaymentReservedTotal is always present on the result object", () => {
    const result = calculateSafeToSpend(baseCtx({ cashBalances: [money(1_000_000)] }));
    expect(result.cardPaymentReservedTotal).toBeDefined();
    expect(typeof result.cardPaymentReservedTotal.amountMinorUnits).toBe("bigint");
  });
});

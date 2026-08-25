import { describe, expect, it } from "vitest";
import { CurrencyMismatchError, InvalidMoneyError, Money } from "./Money.js";

describe("Money — construction & validation", () => {
  it("constructs from a bigint minor-unit amount", () => {
    const m = Money.fromMinorUnits(50000n, "INR");
    expect(m.amountMinorUnits).toBe(50000n);
    expect(m.currencyCode).toBe("INR");
  });

  it("constructs from a safe integer number", () => {
    const m = Money.fromNumber(50000, "INR");
    expect(m.amountMinorUnits).toBe(50000n);
  });

  it("rejects a non-integer number (the core floating-point guard)", () => {
    expect(() => Money.fromNumber(499.5, "INR")).toThrow(InvalidMoneyError);
  });

  it("rejects an unsafe-integer number, directing callers to fromMinorUnits", () => {
    expect(() => Money.fromNumber(Number.MAX_SAFE_INTEGER + 1, "INR")).toThrow(InvalidMoneyError);
  });

  it("rejects an invalid currency code", () => {
    expect(() => Money.fromMinorUnits(100n, "inr")).toThrow(InvalidMoneyError);
    expect(() => Money.fromMinorUnits(100n, "INDIA")).toThrow(InvalidMoneyError);
    expect(() => Money.fromMinorUnits(100n, "")).toThrow(InvalidMoneyError);
  });

  it("parses a decimal-string bigint as returned by Postgres bigint columns", () => {
    const m = Money.parse("128200", "INR");
    expect(m.amountMinorUnits).toBe(128200n);
  });

  it("parses a negative decimal string", () => {
    const m = Money.parse("-500", "INR");
    expect(m.amountMinorUnits).toBe(-500n);
  });

  it("rejects a non-integer string", () => {
    expect(() => Money.parse("128200.50", "INR")).toThrow(InvalidMoneyError);
    expect(() => Money.parse("abc", "INR")).toThrow(InvalidMoneyError);
  });

  it("zero() produces a zero amount in the given currency", () => {
    const m = Money.zero("INR");
    expect(m.isZero()).toBe(true);
    expect(m.amountMinorUnits).toBe(0n);
  });
});

describe("Money — arithmetic", () => {
  it("adds two same-currency amounts", () => {
    const a = Money.fromMinorUnits(50000n, "INR");
    const b = Money.fromMinorUnits(20000n, "INR");
    expect(a.add(b).amountMinorUnits).toBe(70000n);
  });

  it("subtracts two same-currency amounts", () => {
    const a = Money.fromMinorUnits(100000n, "INR");
    const b = Money.fromMinorUnits(20000n, "INR");
    expect(a.subtract(b).amountMinorUnits).toBe(80000n);
  });

  it("subtraction can go negative (Safe-to-Spend is explicitly allowed to be negative, api-architecture.md §8.4)", () => {
    const a = Money.fromMinorUnits(100n, "INR");
    const b = Money.fromMinorUnits(500n, "INR");
    const result = a.subtract(b);
    expect(result.amountMinorUnits).toBe(-400n);
    expect(result.isNegative()).toBe(true);
  });

  it("negate() flips the sign", () => {
    const a = Money.fromMinorUnits(500n, "INR");
    expect(a.negate().amountMinorUnits).toBe(-500n);
    expect(a.negate().negate().amountMinorUnits).toBe(500n);
  });

  it("abs() always returns a non-negative amount", () => {
    expect(Money.fromMinorUnits(-500n, "INR").abs().amountMinorUnits).toBe(500n);
    expect(Money.fromMinorUnits(500n, "INR").abs().amountMinorUnits).toBe(500n);
    expect(Money.zero("INR").abs().amountMinorUnits).toBe(0n);
  });

  it("throws CurrencyMismatchError when adding different currencies", () => {
    const inr = Money.fromMinorUnits(500n, "INR");
    const usd = Money.fromMinorUnits(500n, "USD");
    expect(() => inr.add(usd)).toThrow(CurrencyMismatchError);
  });

  it("throws CurrencyMismatchError when subtracting different currencies", () => {
    const inr = Money.fromMinorUnits(500n, "INR");
    const usd = Money.fromMinorUnits(500n, "USD");
    expect(() => inr.subtract(usd)).toThrow(CurrencyMismatchError);
  });

  it("sum() reduces a list of same-currency amounts", () => {
    const monies = [
      Money.fromMinorUnits(100n, "INR"),
      Money.fromMinorUnits(200n, "INR"),
      Money.fromMinorUnits(300n, "INR"),
    ];
    expect(Money.sum("INR", monies).amountMinorUnits).toBe(600n);
  });

  it("sum() of an empty list is zero", () => {
    expect(Money.sum("INR", []).isZero()).toBe(true);
  });

  it("min() and max() pick correctly, per State 5's MIN(remainingBudget, balanceLessGoals) rule", () => {
    const low = Money.fromMinorUnits(30000n, "INR");
    const high = Money.fromMinorUnits(53000n, "INR");
    expect(Money.min(low, high).equals(low)).toBe(true);
    expect(Money.min(high, low).equals(low)).toBe(true);
    expect(Money.max(low, high).equals(high)).toBe(true);
  });
});

describe("Money — comparison", () => {
  const a = Money.fromMinorUnits(500n, "INR");
  const b = Money.fromMinorUnits(1000n, "INR");
  const aAgain = Money.fromMinorUnits(500n, "INR");

  it("compareTo returns -1, 0, 1 correctly", () => {
    expect(a.compareTo(b)).toBe(-1);
    expect(b.compareTo(a)).toBe(1);
    expect(a.compareTo(aAgain)).toBe(0);
  });

  it("equals() compares both amount and currency", () => {
    expect(a.equals(aAgain)).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(a.equals(Money.fromMinorUnits(500n, "USD"))).toBe(false);
  });

  it("lessThan / greaterThan / lessThanOrEqual / greaterThanOrEqual", () => {
    expect(a.lessThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(true);
    expect(a.lessThanOrEqual(aAgain)).toBe(true);
    expect(a.greaterThanOrEqual(aAgain)).toBe(true);
    expect(b.lessThan(a)).toBe(false);
  });
});

describe("Money — zero/positive/negative handling", () => {
  it("isZero/isPositive/isNegative/isNonNegative are mutually consistent", () => {
    const zero = Money.zero("INR");
    const positive = Money.fromMinorUnits(1n, "INR");
    const negative = Money.fromMinorUnits(-1n, "INR");

    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
    expect(zero.isNonNegative()).toBe(true);

    expect(positive.isPositive()).toBe(true);
    expect(positive.isNonNegative()).toBe(true);
    expect(positive.isNegative()).toBe(false);

    expect(negative.isNegative()).toBe(true);
    expect(negative.isNonNegative()).toBe(false);
    expect(negative.isPositive()).toBe(false);
  });

  it("assertPositive() passes for positive amounts and throws otherwise", () => {
    expect(() => Money.fromMinorUnits(1n, "INR").assertPositive()).not.toThrow();
    expect(() => Money.zero("INR").assertPositive("transaction amount")).toThrow(InvalidMoneyError);
    expect(() => Money.fromMinorUnits(-1n, "INR").assertPositive()).toThrow(InvalidMoneyError);
  });

  it("assertPositive() error message includes the provided context", () => {
    expect(() => Money.zero("INR").assertPositive("transaction amount")).toThrow(/transaction amount/);
  });
});

describe("Money — serialization boundary", () => {
  it("round-trips through toJSON/fromJSON, preserving bigint precision", () => {
    const original = Money.fromMinorUnits(9007199254740993n, "INR"); // > Number.MAX_SAFE_INTEGER
    const json = original.toJSON();
    expect(json).toEqual({ amountMinorUnits: "9007199254740993", currency: "INR" });
    const restored = Money.fromJSON(json);
    expect(restored.equals(original)).toBe(true);
    expect(restored.amountMinorUnits).toBe(9007199254740993n);
  });

  it("toJSON never includes a currency symbol or formatted string -- that is the UI layer's job", () => {
    const json = Money.fromMinorUnits(50000n, "INR").toJSON();
    expect(json.amountMinorUnits).toBe("50000");
    expect(JSON.stringify(json)).not.toMatch(/[₹$]/);
  });

  it("toString() is debug-only: no currency symbol, no digit grouping", () => {
    const s = Money.fromMinorUnits(1234567n, "INR").toString();
    expect(s).toBe("1234567 INR");
    expect(s).not.toMatch(/[₹,]/);
  });
});

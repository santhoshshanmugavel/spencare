import { describe, it, expect } from "vitest";
import { Money, InvalidMoneyError } from "./Money.js";

/**
 * Phase 2 — Money.multiplyRational: exact bigint rational multiplication
 * with banker's rounding on the final minor-unit result.
 *
 * These tests pin:
 *   - exact-divisible fast path
 *   - round-half-to-even on ties (banker's)
 *   - sign handling (negative numerator, denominator, product)
 *   - rejection of zero denominator and non-bigint arguments
 *   - no float escape hatch (large bigint amounts stay exact)
 */

const INR = "INR";
const m = (n: bigint) => Money.fromMinorUnits(n, INR);

describe("Money.multiplyRational — exact-divisible", () => {
  it("1000 * 12/100 = 120 (no rounding)", () => {
    expect(m(100000n).multiplyRational(12n, 100n).amountMinorUnits).toBe(12000n);
  });

  it("500 * 50% = 250 (no rounding)", () => {
    expect(m(50000n).multiplyRational(1n, 2n).amountMinorUnits).toBe(25000n);
  });

  it("zero amount times any ratio stays zero", () => {
    expect(m(0n).multiplyRational(12345n, 67n).amountMinorUnits).toBe(0n);
  });

  it("multiplying by 1/1 is the identity", () => {
    expect(m(777n).multiplyRational(1n, 1n).amountMinorUnits).toBe(777n);
  });

  it("multiplying by 0/n is zero", () => {
    expect(m(500n).multiplyRational(0n, 100n).amountMinorUnits).toBe(0n);
  });
});

describe("Money.multiplyRational — banker's rounding (round half to even)", () => {
  it("tie rounded down to even: 5 * 1/2 = 2.5 -> 2 (2 is even)", () => {
    expect(m(5n).multiplyRational(1n, 2n).amountMinorUnits).toBe(2n);
  });

  it("tie rounded up to even: 7 * 1/2 = 3.5 -> 4 (4 is even)", () => {
    expect(m(7n).multiplyRational(1n, 2n).amountMinorUnits).toBe(4n);
  });

  it("tie rounded down to even: 9 * 1/2 = 4.5 -> 4", () => {
    expect(m(9n).multiplyRational(1n, 2n).amountMinorUnits).toBe(4n);
  });

  it("tie rounded up to even: 11 * 1/2 = 5.5 -> 6", () => {
    expect(m(11n).multiplyRational(1n, 2n).amountMinorUnits).toBe(6n);
  });

  it("not a tie, nearest wins: 1 * 1/3 = 0.333... -> 0", () => {
    expect(m(1n).multiplyRational(1n, 3n).amountMinorUnits).toBe(0n);
  });

  it("not a tie, nearest wins: 2 * 1/3 = 0.666... -> 1", () => {
    expect(m(2n).multiplyRational(1n, 3n).amountMinorUnits).toBe(1n);
  });
});

describe("Money.multiplyRational — signs", () => {
  it("negative amount * positive ratio -> negative", () => {
    expect(m(-500n).multiplyRational(1n, 2n).amountMinorUnits).toBe(-250n);
  });

  it("positive amount * negative numerator -> negative", () => {
    expect(m(500n).multiplyRational(-1n, 2n).amountMinorUnits).toBe(-250n);
  });

  it("negative amount * negative numerator -> positive", () => {
    expect(m(-500n).multiplyRational(-1n, 2n).amountMinorUnits).toBe(250n);
  });

  it("negative denominator is normalized -- 500 * 1/-2 == 500 * -1/2 == -250", () => {
    expect(m(500n).multiplyRational(1n, -2n).amountMinorUnits).toBe(-250n);
  });

  it("negative numerator AND negative denominator -> positive", () => {
    expect(m(500n).multiplyRational(-1n, -2n).amountMinorUnits).toBe(250n);
  });

  it("ties round to even in negative territory as well: -5 * 1/2 = -2.5 -> -2", () => {
    expect(m(-5n).multiplyRational(1n, 2n).amountMinorUnits).toBe(-2n);
  });

  it("ties round to even in negative territory: -7 * 1/2 = -3.5 -> -4", () => {
    expect(m(-7n).multiplyRational(1n, 2n).amountMinorUnits).toBe(-4n);
  });
});

describe("Money.multiplyRational — rejects bad arguments", () => {
  it("throws InvalidMoneyError on den === 0", () => {
    expect(() => m(100n).multiplyRational(1n, 0n)).toThrow(InvalidMoneyError);
  });

  it("throws on non-bigint arguments (defensive, in case callers mis-type)", () => {
    // @ts-expect-error -- deliberately passing wrong types to prove runtime guard
    expect(() => m(100n).multiplyRational(0.5, 1n)).toThrow(InvalidMoneyError);
    // @ts-expect-error
    expect(() => m(100n).multiplyRational(1n, "2")).toThrow(InvalidMoneyError);
  });
});

describe("Money.multiplyRational — large magnitude stays exact (no float escape)", () => {
  it("a crore (1_00_00_000) in major = 10^9 minor -- 10^9 * 12/100 = 12 * 10^7", () => {
    const oneCroreMajor = 1_00_00_000; // major units
    const minor = BigInt(oneCroreMajor) * 100n; // 1_000_000_000n
    const result = m(minor).multiplyRational(12n, 100n);
    expect(result.amountMinorUnits).toBe(120_000_000n);
  });

  it("bigint beyond Number.MAX_SAFE_INTEGER multiplies exactly", () => {
    // 2 * 10^18 -- outside Number safe range -- 50% of it = 10^18
    const huge = 2_000_000_000_000_000_000n;
    const result = m(huge).multiplyRational(1n, 2n);
    expect(result.amountMinorUnits).toBe(1_000_000_000_000_000_000n);
  });
});

describe("Money.multiplyRational — currency preservation", () => {
  it("preserves the operand's currency", () => {
    const inr = Money.fromMinorUnits(1000n, "INR").multiplyRational(1n, 4n);
    expect(inr.currencyCode).toBe("INR");
    const usd = Money.fromMinorUnits(1000n, "USD").multiplyRational(1n, 4n);
    expect(usd.currencyCode).toBe("USD");
  });
});

import { describe, expect, it } from "vitest";
import { calculateNetWorth } from "./netWorth.js";
import { Money } from "./Money.js";

const inr = (n: number) => Money.fromMinorUnits(BigInt(n), "INR");

describe("calculateNetWorth", () => {
  it("assets minus liabilities, per the override's worked composition (Bank 50,000 + Cash 5,000 + Investment 300,000, Credit used 20,000)", () => {
    const result = calculateNetWorth({
      assetBalances: [inr(5000000), inr(500000), inr(30000000)],
      liabilityBalances: [inr(2000000)],
    });
    expect(result.totalAssets.amountMinorUnits).toBe(35500000n);
    expect(result.totalLiabilities.amountMinorUnits).toBe(2000000n);
    expect(result.netWorth.amountMinorUnits).toBe(33500000n);
  });

  it("never includes Investment as spendable, only as an asset -- this function has no notion of Safe-to-Spend at all", () => {
    const result = calculateNetWorth({ assetBalances: [inr(30000000)], liabilityBalances: [] });
    expect(result.netWorth.amountMinorUnits).toBe(30000000n);
  });

  it("credit-card AVAILABLE credit is never an input -- only credit_used (the liability) affects Net Worth", () => {
    // A card with a huge available credit line but zero used contributes
    // zero liability, never a positive asset either.
    const result = calculateNetWorth({ assetBalances: [inr(1000000)], liabilityBalances: [inr(0)] });
    expect(result.netWorth.amountMinorUnits).toBe(1000000n);
  });

  it("can go negative -- never clamped, same philosophy as Safe-to-Spend", () => {
    const result = calculateNetWorth({ assetBalances: [inr(10000)], liabilityBalances: [inr(50000)] });
    expect(result.netWorth.amountMinorUnits).toBe(-40000n);
  });

  it("zero accounts of either kind produces a correct zero, not a crash", () => {
    const result = calculateNetWorth({ assetBalances: [], liabilityBalances: [] });
    expect(result.netWorth.amountMinorUnits).toBe(0n);
    expect(result.netWorth.currencyCode).toBe("INR");
  });
});

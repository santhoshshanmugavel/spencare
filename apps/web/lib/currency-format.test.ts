import { describe, expect, it } from "vitest";
import { currencySymbol, formatMinorUnits, groupIndianDigits } from "./currency-format";

describe("currencySymbol", () => {
  it("maps known ISO codes to their symbol", () => {
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("USD")).toBe("$");
  });

  it("falls back to the raw code for unknown currencies", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ");
  });
});

describe("groupIndianDigits", () => {
  it("does not group 3 or fewer digits", () => {
    expect(groupIndianDigits("5")).toBe("5");
    expect(groupIndianDigits("500")).toBe("500");
  });

  it("groups using the lakh/crore pattern, not Western thousands (financial-data-validation.md FV-04)", () => {
    expect(groupIndianDigits("1234")).toBe("1,234");
    expect(groupIndianDigits("57910")).toBe("57,910");
    expect(groupIndianDigits("128200")).toBe("1,28,200");
    expect(groupIndianDigits("132000")).toBe("1,32,000");
    expect(groupIndianDigits("1234567")).toBe("12,34,567");
    expect(groupIndianDigits("10000000")).toBe("1,00,00,000");
  });
});

describe("formatMinorUnits", () => {
  it("splits minor units into integer/decimal parts with the right symbol", () => {
    const f = formatMinorUnits(5791000n, "INR");
    expect(f.symbol).toBe("₹");
    expect(f.integerPart).toBe("57,910");
    expect(f.decimalPart).toBe("00");
    expect(f.isNegative).toBe(false);
  });

  it("handles non-zero paise correctly", () => {
    const f = formatMinorUnits(82378n, "INR"); // ₹823.78, from FV cases
    expect(f.integerPart).toBe("823");
    expect(f.decimalPart).toBe("78");
  });

  it("reports negative amounts via isNegative, never a baked-in minus sign in the digits", () => {
    const f = formatMinorUnits(-40000n, "INR");
    expect(f.isNegative).toBe(true);
    expect(f.integerPart).toBe("400");
    expect(f.integerPart).not.toContain("-");
  });

  it("handles zero", () => {
    const f = formatMinorUnits(0n, "INR");
    expect(f.integerPart).toBe("0");
    expect(f.decimalPart).toBe("00");
    expect(f.isNegative).toBe(false);
  });
});

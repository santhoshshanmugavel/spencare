import { describe, expect, it } from "vitest";
import { parseMoneyInput, minorUnitsToDisplay } from "./money-input";

describe("parseMoneyInput", () => {
  describe("INR (2 fraction digits)", () => {
    it("parses whole rupee amounts", () => {
      expect(parseMoneyInput("50000", "INR")).toEqual({ minor: 5000000 });
    });

    it("parses decimal amounts — the primary regression case", () => {
      expect(parseMoneyInput("74840.87", "INR")).toEqual({ minor: 7484087 });
    });

    it("parses amounts with only one decimal digit", () => {
      expect(parseMoneyInput("74840.8", "INR")).toEqual({ minor: 7484080 });
    });

    it("parses amounts ending in .00", () => {
      expect(parseMoneyInput("5000.00", "INR")).toEqual({ minor: 500000 });
    });

    it("parses small fractional amounts", () => {
      expect(parseMoneyInput("0.50", "INR")).toEqual({ minor: 50 });
    });

    it("strips currency symbols", () => {
      expect(parseMoneyInput("₹74,840.87", "INR")).toEqual({ minor: 7484087 });
    });

    it("strips commas", () => {
      expect(parseMoneyInput("74,840.87", "INR")).toEqual({ minor: 7484087 });
    });

    it("returns 0 for empty input", () => {
      expect(parseMoneyInput("", "INR")).toEqual({ minor: 0 });
    });

    it("returns 0 for lone decimal point", () => {
      expect(parseMoneyInput(".", "INR")).toEqual({ minor: 0 });
    });

    it("rejects more than 2 decimal places", () => {
      const result = parseMoneyInput("74840.875", "INR");
      expect(result.minor).toBe(0);
      expect(result.error).toMatch(/2 decimal/);
    });

    it("does NOT multiply by 100 twice (the original bug)", () => {
      // Old code: "74840.87" → strip "." → "7484087" → × 100 = 748408700
      // Correct:  "74840.87" → 7484087
      const result = parseMoneyInput("74840.87", "INR");
      expect(result.minor).toBe(7_484_087);
      expect(result.minor).not.toBe(748_408_700);
    });
  });

  describe("JPY (0 fraction digits)", () => {
    it("parses whole-unit amounts", () => {
      expect(parseMoneyInput("1500", "JPY")).toEqual({ minor: 1500 });
    });

    it("rejects any decimal for JPY", () => {
      const result = parseMoneyInput("1500.5", "JPY");
      expect(result.minor).toBe(0);
      expect(result.error).toMatch(/0 decimal/);
    });
  });

  describe("KWD (3 fraction digits)", () => {
    it("parses 3-decimal amounts", () => {
      expect(parseMoneyInput("12.500", "KWD")).toEqual({ minor: 12500 });
    });

    it("rejects more than 3 decimal places", () => {
      const result = parseMoneyInput("12.5000", "KWD");
      expect(result.minor).toBe(0);
      expect(result.error).toMatch(/3 decimal/);
    });
  });
});

describe("minorUnitsToDisplay", () => {
  it("converts INR minor units to display string with decimals", () => {
    expect(minorUnitsToDisplay(7_484_087, "INR")).toBe("74840.87");
  });

  it("omits trailing zeros for whole-rupee amounts", () => {
    expect(minorUnitsToDisplay(500_000, "INR")).toBe("5000");
  });

  it("shows trailing zero in decimal part (80 paise = .80 not .8)", () => {
    expect(minorUnitsToDisplay(7_484_080, "INR")).toBe("74840.80");
  });

  it("handles JPY (0 fraction digits)", () => {
    expect(minorUnitsToDisplay(1500, "JPY")).toBe("1500");
  });

  it("handles KWD (3 fraction digits) with all decimals", () => {
    expect(minorUnitsToDisplay(12_500, "KWD")).toBe("12.500");
  });

  it("round-trips: parse then display (no trailing zeros case)", () => {
    const display = "74840.87";
    const { minor } = parseMoneyInput(display, "INR");
    expect(minorUnitsToDisplay(minor, "INR")).toBe(display);
  });

  it("round-trips: whole-rupee amounts strip .00 suffix", () => {
    const { minor } = parseMoneyInput("5000.00", "INR");
    expect(minorUnitsToDisplay(minor, "INR")).toBe("5000");
  });
});

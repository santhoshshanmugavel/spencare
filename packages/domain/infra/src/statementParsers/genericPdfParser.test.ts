import { describe, expect, it } from "vitest";
import { GenericPdfParser } from "./genericPdfParser.js";

describe("GenericPdfParser.canParse", () => {
  it("accepts text with a date token and an amount token", () => {
    const text = "12/08/2026  Swiggy Order  450.00 DR";
    expect(GenericPdfParser.canParse(text)).toBe(true);
  });

  it("rejects text with no date token", () => {
    expect(GenericPdfParser.canParse("Just some prose with 450.00 in it")).toBe(false);
  });

  it("rejects text with no amount token", () => {
    expect(GenericPdfParser.canParse("12/08/2026 nothing numeric here")).toBe(false);
  });
});

describe("GenericPdfParser.parse", () => {
  it("parses a DR-marked line as an expense", () => {
    const rows = GenericPdfParser.parse("12/08/2026  Swiggy Order  450.00 DR");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dateIso: "2026-08-12", amountMinor: 45000, type: "expense" });
  });

  it("parses a CR-marked line as income", () => {
    const rows = GenericPdfParser.parse("13/08/2026  Salary Credit  50000.00 CR");
    expect(rows[0]).toMatchObject({ dateIso: "2026-08-13", amountMinor: 5000000, type: "income" });
  });

  it("derives expense from a negative-signed amount with no marker", () => {
    const rows = GenericPdfParser.parse("12/08/2026  ATM Withdrawal  -450.00");
    expect(rows[0]).toMatchObject({ amountMinor: 45000, type: "expense" });
  });

  it("leaves type null for an unsigned, unmarked amount -- never guesses", () => {
    const rows = GenericPdfParser.parse("12/08/2026  Some Charge  450.00");
    expect(rows[0]!.type).toBeNull();
    expect(rows[0]!.amountMinor).toBe(45000); // amount itself is still resolvable, only direction is not
  });

  it("never produces a negative amountMinor even for a signed source line", () => {
    const rows = GenericPdfParser.parse("12/08/2026  ATM Withdrawal  -450.00");
    expect(rows[0]!.amountMinor).toBeGreaterThan(0);
  });

  it("extracts a merchant description with date/amount stripped", () => {
    const rows = GenericPdfParser.parse("12/08/2026  Swiggy Order Koramangala  450.00 DR");
    expect(rows[0]!.merchant).toBe("Swiggy Order Koramangala");
  });

  it("skips lines with no date or no amount (headers, page footers, etc.)", () => {
    const text = ["Statement Period: August 2026", "12/08/2026  Swiggy  450.00 DR", "Page 1 of 3"].join("\n");
    const rows = GenericPdfParser.parse(text);
    expect(rows).toHaveLength(1);
  });

  it("tags every row fromSpecificParser: false", () => {
    const rows = GenericPdfParser.parse("12/08/2026  Swiggy  450.00 DR");
    expect(rows[0]!.fromSpecificParser).toBe(false);
  });

  it("handles multiple transaction lines", () => {
    const text = ["12/08/2026  Swiggy  450.00 DR", "13/08/2026  Salary  50000.00 CR"].join("\n");
    const rows = GenericPdfParser.parse(text);
    expect(rows).toHaveLength(2);
  });
});

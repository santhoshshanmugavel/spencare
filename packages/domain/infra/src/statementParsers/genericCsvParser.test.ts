import { describe, expect, it } from "vitest";
import { GenericCsvParser, detectCsvColumnMapping, parseCsvWithMapping } from "./genericCsvParser.js";

describe("detectCsvColumnMapping", () => {
  it("detects a single signed-amount column layout", () => {
    const mapping = detectCsvColumnMapping(["Date", "Amount", "Description"]);
    expect(mapping).toEqual({ dateColumn: 0, amountColumn: 1, debitColumn: undefined, creditColumn: undefined, markerColumn: undefined, merchantColumn: 2 });
  });

  it("detects a separate debit/credit column layout", () => {
    const mapping = detectCsvColumnMapping(["Value Date", "Withdrawal", "Deposit", "Narration"]);
    expect(mapping).toEqual({ dateColumn: 0, amountColumn: undefined, debitColumn: 1, creditColumn: 2, markerColumn: undefined, merchantColumn: 3 });
  });

  it("returns null when no date column can be found", () => {
    expect(detectCsvColumnMapping(["Amount", "Description"])).toBeNull();
  });

  it("is case- and whitespace-insensitive", () => {
    const mapping = detectCsvColumnMapping(["  DATE  ", "AMOUNT"]);
    expect(mapping?.dateColumn).toBe(0);
    expect(mapping?.amountColumn).toBe(1);
  });
});

describe("parseCsvWithMapping — signed amount column", () => {
  const csv = "Date,Amount,Description\n12/08/2026,-450.00,Swiggy Order\n13/08/2026,50000.00,Salary Credit\n";

  it("parses an expense from a negative signed amount", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, merchantColumn: 2 });
    expect(rows[0]).toMatchObject({ dateIso: "2026-08-12", amountMinor: 45000, type: "expense", merchant: "Swiggy Order" });
  });

  it("parses income from a positive signed amount", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, merchantColumn: 2 });
    expect(rows[1]).toMatchObject({ dateIso: "2026-08-13", amountMinor: 5000000, type: "income", merchant: "Salary Credit" });
  });

  it("never produces a negative amountMinor", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, merchantColumn: 2 });
    for (const row of rows) expect(row.amountMinor === null || row.amountMinor > 0).toBe(true);
  });
});

describe("parseCsvWithMapping — debit/credit columns", () => {
  const csv = "Date,Withdrawal,Deposit,Narration\n12/08/2026,450.00,,Swiggy\n13/08/2026,,50000.00,Salary\n14/08/2026,,,Balance enquiry\n";

  it("treats a populated debit column as an expense", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, debitColumn: 1, creditColumn: 2, merchantColumn: 3 });
    expect(rows[0]).toMatchObject({ amountMinor: 45000, type: "expense" });
  });

  it("treats a populated credit column as income", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, debitColumn: 1, creditColumn: 2, merchantColumn: 3 });
    expect(rows[1]).toMatchObject({ amountMinor: 5000000, type: "income" });
  });

  it("leaves direction unresolved (null) when both debit and credit are empty -- never guesses", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, debitColumn: 1, creditColumn: 2, merchantColumn: 3 });
    expect(rows[2]!.type).toBeNull();
    expect(rows[2]!.amountMinor).toBeNull();
  });
});

describe("parseCsvWithMapping — CR/DR marker column", () => {
  const csv = "Date,Amount,Type,Description\n12/08/2026,450.00,DR,Swiggy\n13/08/2026,50000.00,CR,Salary\n";

  it("treats DR as expense", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, markerColumn: 2, merchantColumn: 3 });
    expect(rows[0]).toMatchObject({ amountMinor: 45000, type: "expense" });
  });

  it("treats CR as income", () => {
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, markerColumn: 2, merchantColumn: 3 });
    expect(rows[1]).toMatchObject({ amountMinor: 5000000, type: "income" });
  });
});

describe("parseCsvWithMapping — quoted fields", () => {
  it("handles a quoted description containing a comma", () => {
    const csv = 'Date,Amount,Description\n12/08/2026,-450.00,"Swiggy, Koramangala"\n';
    const rows = parseCsvWithMapping(csv, { dateColumn: 0, amountColumn: 1, merchantColumn: 2 });
    expect(rows[0]!.merchant).toBe("Swiggy, Koramangala");
  });
});

describe("GenericCsvParser (StatementParser interface)", () => {
  it("canParse accepts a recognizable header row", () => {
    expect(GenericCsvParser.canParse("Date,Amount,Description\n12/08/2026,-450,Swiggy")).toBe(true);
  });

  it("canParse rejects text with no recognizable date column", () => {
    expect(GenericCsvParser.canParse("Foo,Bar\n1,2")).toBe(false);
  });

  it("parse end-to-end produces rows tagged fromSpecificParser: false", () => {
    const rows = GenericCsvParser.parse("Date,Amount,Description\n12/08/2026,-450.00,Swiggy\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fromSpecificParser).toBe(false);
  });

  it("returns an empty array for a header-only file", () => {
    expect(GenericCsvParser.parse("Date,Amount,Description\n")).toEqual([]);
  });
});

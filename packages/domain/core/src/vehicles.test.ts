import { describe, expect, it } from "vitest";
import {
  calculateFuelEfficiency,
  calculateCostPerKm,
  aggregateMonthlyCosts,
  parseFuelioCSV,
  parseFuelioOdometer,
  parseFuelioFuelMl,
  parseFuelioCurrencyMinor,
  fuelioFuelTypeCode,
  parseGenericCSV,
  suggestColumnMapping,
  validateGenericRow,
  hasAmbiguousDates,
  type FuelEfficiencyEntry,
  type CostPerKmEntry,
  type MonthlyCostFuelInput,
  type MonthlyCostExpenseInput,
  type GenericCsvColumnMap,
} from "./vehicles.js";

// ============================================================
// calculateFuelEfficiency
// ============================================================

describe("calculateFuelEfficiency", () => {
  it("returns no_entries for empty input", () => {
    expect(calculateFuelEfficiency([])).toEqual({ type: "no_entries" });
  });

  it("returns insufficient_data when no full-tank entries", () => {
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 1000n, fuelQuantityMl: 5000n, isFullTank: false, isMissed: false, excludeDistance: false },
      { odometer: 1500n, fuelQuantityMl: 3000n, isFullTank: false, isMissed: false, excludeDistance: false },
    ];
    expect(calculateFuelEfficiency(entries)).toEqual({ type: "insufficient_data" });
  });

  it("returns insufficient_data when only one full-tank entry", () => {
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 1000n, fuelQuantityMl: 10000n, isFullTank: true, isMissed: false, excludeDistance: false },
      { odometer: 1200n, fuelQuantityMl: 5000n, isFullTank: false, isMissed: false, excludeDistance: false },
    ];
    expect(calculateFuelEfficiency(entries)).toEqual({ type: "insufficient_data" });
  });

  it("computes efficiency for a single full-tank-to-full-tank interval", () => {
    // 100 km at 10 L = 10 km/L = kmPerLitreCx100: 1000n
    // distance = 1000 dkm, fuel = 10_000 ml
    // kmPerLitreCx100 = (1000 * 10_000) / 10_000 = 1000
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 0n,    fuelQuantityMl: 10000n, isFullTank: true, isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 10000n, isFullTank: true, isMissed: false, excludeDistance: false },
    ];
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      expect(result.intervalCount).toBe(1);
      expect(result.kmPerLitreCx100).toBe(1000n); // 10.00 km/L
    }
  });

  it("accumulates multiple intervals correctly", () => {
    // Interval 1: 100 km, 10L = 10 km/L
    // Interval 2: 50 km, 5L = 10 km/L
    // Combined: 150 km / 15L = 10 km/L = 1000 cx100
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 0n,    fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1500n, fuelQuantityMl: 5000n,  isFullTank: true,  isMissed: false, excludeDistance: false },
    ];
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      expect(result.intervalCount).toBe(2);
      expect(result.kmPerLitreCx100).toBe(1000n);
    }
  });

  it("includes partial fills between full-tank events in the fuel sum", () => {
    // FT at 0, partial at 100km (3L), FT at 200km (7L)
    // interval: distance=2000dkm, fuel=3000+7000=10000ml
    // 200km / 10L = 20 km/L = 2000 cx100
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 0n,    fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 3000n,  isFullTank: false, isMissed: false, excludeDistance: false },
      { odometer: 2000n, fuelQuantityMl: 7000n,  isFullTank: true,  isMissed: false, excludeDistance: false },
    ];
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      expect(result.intervalCount).toBe(1);
      expect(result.kmPerLitreCx100).toBe(2000n);
    }
  });

  it("skips intervals containing a missed fill", () => {
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 0n,    fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 5000n,  isFullTank: false, isMissed: true,  excludeDistance: false },
      { odometer: 2000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 3000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
    ];
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      // Only interval 2->3 is valid (1->2 has a missed entry)
      expect(result.intervalCount).toBe(1);
    }
  });

  it("skips intervals with zero or negative distance", () => {
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 1000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 5000n,  isFullTank: true,  isMissed: false, excludeDistance: false }, // same odometer
      { odometer: 2000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
    ];
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      expect(result.intervalCount).toBe(1);
    }
  });

  it("excludes excluded-distance entries from full-tank index", () => {
    const entries: FuelEfficiencyEntry[] = [
      { odometer: 0n,    fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
      { odometer: 1000n, fuelQuantityMl: 5000n,  isFullTank: true,  isMissed: false, excludeDistance: true  },
      { odometer: 2000n, fuelQuantityMl: 10000n, isFullTank: true,  isMissed: false, excludeDistance: false },
    ];
    // The middle entry is full-tank but excludeDistance=true, so it is not an anchor.
    // Single interval: 0->2000, fuel=5000+10000=15000ml, distance=2000dkm
    // 200km / 15L = 13.33 km/L => cx100 = 1333
    const result = calculateFuelEfficiency(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      expect(result.intervalCount).toBe(1);
      expect(result.kmPerLitreCx100).toBe(1333n);
    }
  });
});

// ============================================================
// calculateCostPerKm
// ============================================================

describe("calculateCostPerKm", () => {
  it("returns no_data for fewer than 2 entries", () => {
    const entries: CostPerKmEntry[] = [
      { odometer: 0n, totalCostMinor: 1000n, isMissed: false, excludeDistance: false, currency: "INR" },
    ];
    expect(calculateCostPerKm(entries)).toEqual({ type: "no_data" });
  });

  it("returns no_data when no entry has a cost", () => {
    const entries: CostPerKmEntry[] = [
      { odometer: 0n,    totalCostMinor: null, isMissed: false, excludeDistance: false, currency: "INR" },
      { odometer: 1000n, totalCostMinor: null, isMissed: false, excludeDistance: false, currency: "INR" },
    ];
    expect(calculateCostPerKm(entries)).toEqual({ type: "no_data" });
  });

  it("computes cost per km correctly", () => {
    // 100 km, total cost = 10000 paise = 100 INR
    // paise/km = 100, cx100 = 10000
    const entries: CostPerKmEntry[] = [
      { odometer: 0n,    totalCostMinor: 5000n,  isMissed: false, excludeDistance: false, currency: "INR" },
      { odometer: 1000n, totalCostMinor: 5000n,  isMissed: false, excludeDistance: false, currency: "INR" },
    ];
    const result = calculateCostPerKm(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      // totalCost=10000, distanceDkm=1000
      // costPerKmCx100 = (10000 * 1000) / 1000 = 10000
      expect(result.costPerKmCx100).toBe(10000n);
      expect(result.currency).toBe("INR");
    }
  });

  it("skips missed entries from distance calculation", () => {
    const entries: CostPerKmEntry[] = [
      { odometer: 0n,    totalCostMinor: 1000n, isMissed: false, excludeDistance: false, currency: "INR" },
      { odometer: 500n,  totalCostMinor: 1000n, isMissed: true,  excludeDistance: false, currency: "INR" },
      { odometer: 1000n, totalCostMinor: 1000n, isMissed: false, excludeDistance: false, currency: "INR" },
    ];
    const result = calculateCostPerKm(entries);
    expect(result.type).toBe("computed");
    if (result.type === "computed") {
      // valid entries: 0 and 1000; missed is excluded from both distance and cost
      // cost = 1000 + 1000 (missed cost included in sum because the loop skips missed for cost)
      // Actually looking at the implementation: missed entries are skipped for COST too
      // So cost = 1000 + 1000 = 2000 (first + last)
      // Actually no, the missed skips cost accumulation. Let's trace:
      // entries loop: e.isMissed -> continue, so only 0n and 1000n entries count for cost
      // totalCost = 1000 + 1000 = 2000
      // validEntries (not missed, not excludeDistance) = [0n, 1000n]
      // distance = 1000dkm
      // costPerKmCx100 = (2000 * 1000) / 1000 = 2000
      expect(result.costPerKmCx100).toBe(2000n);
    }
  });
});

// ============================================================
// aggregateMonthlyCosts
// ============================================================

describe("aggregateMonthlyCosts", () => {
  it("returns empty array when no inputs", () => {
    expect(aggregateMonthlyCosts("INR", [], [])).toEqual([]);
  });

  it("aggregates fuel and expenses into months", () => {
    const fuel: MonthlyCostFuelInput[] = [
      { occurredAt: "2026-01-05T10:00:00Z", totalCostMinor: 5000n, fuelQuantityMl: 10000n, currency: "INR" },
      { occurredAt: "2026-01-20T10:00:00Z", totalCostMinor: 4000n, fuelQuantityMl: 8000n,  currency: "INR" },
      { occurredAt: "2026-02-10T10:00:00Z", totalCostMinor: 6000n, fuelQuantityMl: 12000n, currency: "INR" },
    ];
    const expenses: MonthlyCostExpenseInput[] = [
      { occurredAt: "2026-01-15T10:00:00Z", amountMinor: 2000n, currency: "INR" },
    ];
    const result = aggregateMonthlyCosts("INR", fuel, expenses);
    expect(result).toHaveLength(2);

    const jan = result.find((m) => m.month === "2026-01");
    expect(jan?.fuelCostMinor).toBe(9000n);
    expect(jan?.otherCostMinor).toBe(2000n);
    expect(jan?.totalCostMinor).toBe(11000n);
    expect(jan?.fuelLitresMl).toBe(18000n);
    expect(jan?.fuelEntryCount).toBe(2);
    expect(jan?.expenseCount).toBe(1);

    const feb = result.find((m) => m.month === "2026-02");
    expect(feb?.fuelCostMinor).toBe(6000n);
    expect(feb?.otherCostMinor).toBe(0n);
  });

  it("filters out entries with a different currency", () => {
    const fuel: MonthlyCostFuelInput[] = [
      { occurredAt: "2026-01-05T10:00:00Z", totalCostMinor: 5000n, fuelQuantityMl: 10000n, currency: "USD" },
    ];
    expect(aggregateMonthlyCosts("INR", fuel, [])).toEqual([]);
  });

  it("ignores fuel entries with null cost", () => {
    const fuel: MonthlyCostFuelInput[] = [
      { occurredAt: "2026-01-05T10:00:00Z", totalCostMinor: null, fuelQuantityMl: 10000n, currency: "INR" },
    ];
    const result = aggregateMonthlyCosts("INR", fuel, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.fuelCostMinor).toBe(0n);
    expect(result[0]!.fuelLitresMl).toBe(10000n); // ml still accumulated
  });

  it("returns months in chronological order", () => {
    const fuel: MonthlyCostFuelInput[] = [
      { occurredAt: "2026-03-01T00:00:00Z", totalCostMinor: 1000n, fuelQuantityMl: 1000n, currency: "INR" },
      { occurredAt: "2026-01-01T00:00:00Z", totalCostMinor: 1000n, fuelQuantityMl: 1000n, currency: "INR" },
    ];
    const result = aggregateMonthlyCosts("INR", fuel, []);
    expect(result[0]!.month).toBe("2026-01");
    expect(result[1]!.month).toBe("2026-03");
  });
});

// ============================================================
// parseFuelioOdometer
// ============================================================

describe("parseFuelioOdometer", () => {
  it("parses integer km string", () => {
    expect(parseFuelioOdometer("3257")).toBe(32570n);
  });

  it("parses decimal km string", () => {
    expect(parseFuelioOdometer("681.5")).toBe(6815n);
  });

  it("parses .0 decimal", () => {
    expect(parseFuelioOdometer("433.0")).toBe(4330n);
  });

  it("returns null for empty string", () => {
    expect(parseFuelioOdometer("")).toBeNull();
  });

  it("returns null for whitespace string", () => {
    expect(parseFuelioOdometer("   ")).toBeNull();
  });

  it("takes only the first decimal digit (truncates hundredths)", () => {
    // "100.89" -> tenths = 8 (from "89".charAt(0))
    expect(parseFuelioOdometer("100.89")).toBe(1008n);
  });
});

// ============================================================
// parseFuelioFuelMl
// ============================================================

describe("parseFuelioFuelMl", () => {
  it("parses integer litres to millilitres", () => {
    // 10 L = 10000 mL
    expect(parseFuelioFuelMl("10")).toBe(10000n);
  });

  it("parses decimal litres", () => {
    // 10.08 L = 10080 mL
    expect(parseFuelioFuelMl("10.08")).toBe(10080n);
  });

  it("returns null for empty string", () => {
    expect(parseFuelioFuelMl("")).toBeNull();
  });
});

// ============================================================
// parseFuelioCurrencyMinor
// ============================================================

describe("parseFuelioCurrencyMinor", () => {
  it("parses integer amount to minor units", () => {
    // "150" -> 15000 paise
    expect(parseFuelioCurrencyMinor("150")).toBe(15000n);
  });

  it("parses decimal amount", () => {
    // "116.55" -> 11655 paise
    expect(parseFuelioCurrencyMinor("116.55")).toBe(11655n);
  });

  it("returns null for empty string", () => {
    expect(parseFuelioCurrencyMinor("")).toBeNull();
  });
});

// ============================================================
// fuelioFuelTypeCode
// ============================================================

describe("fuelioFuelTypeCode", () => {
  it("maps 100 and 112 to petrol", () => {
    expect(fuelioFuelTypeCode("100")).toBe("petrol");
    expect(fuelioFuelTypeCode("112")).toBe("petrol");
  });

  it("maps 121 to petrol_premium", () => {
    expect(fuelioFuelTypeCode("121")).toBe("petrol_premium");
  });

  it("maps 200 and 210 to diesel", () => {
    expect(fuelioFuelTypeCode("200")).toBe("diesel");
    expect(fuelioFuelTypeCode("210")).toBe("diesel");
  });

  it("maps 300 to lpg", () => {
    expect(fuelioFuelTypeCode("300")).toBe("lpg");
  });

  it("maps 310 to cng", () => {
    expect(fuelioFuelTypeCode("310")).toBe("cng");
  });

  it("maps 400 to electric", () => {
    expect(fuelioFuelTypeCode("400")).toBe("electric");
  });

  it("defaults unknown codes to petrol", () => {
    expect(fuelioFuelTypeCode("999")).toBe("petrol");
    expect(fuelioFuelTypeCode("")).toBe("petrol");
  });
});

// ============================================================
// parseFuelioCSV
// ============================================================

const SAMPLE_FUELIO_CSV = `## Vehicle
Name,DistUnit,FuelUnit,ConsumptionUnit,Tank1Capacity,Tank1Type,GUID,LastUpdated
Royal Enfield Hunter 350,0,0,3,13.0,112,test-guid-001,1720000000000

## Log
Data,Odo (km),Fuel (Litres),Full,Price (optional),City (optional),Notes (optional),Missed,TankNumber,FuelType,VolumePrice,StationId (optional),ExcludeDistance,UniqueId,GUID,LastUpdated
2026-01-05 10:00,3000.0,10.08,1,116.55,Bengaluru,,0,1,112,,,,fill-001,log-guid-001,1720000001000
2026-01-15 10:00,3100.5,5.04,0,58.00,Bengaluru,,0,1,112,,,,fill-002,log-guid-002,1720000002000
2026-01-25 10:00,3200.0,10.00,1,115.00,Bengaluru,,0,1,112,,,,fill-003,log-guid-003,1720000003000
`;

describe("parseFuelioCSV", () => {
  it("parses the vehicle section", () => {
    const result = parseFuelioCSV(SAMPLE_FUELIO_CSV);
    expect(result.vehicle).not.toBeNull();
    expect(result.vehicle?.name).toBe("Royal Enfield Hunter 350");
    expect(result.vehicle?.distUnit).toBe(0); // km
    expect(result.vehicle?.fuelUnit).toBe(0); // litre
    expect(result.vehicle?.tank1Capacity).toBe(13.0);
    expect(result.vehicle?.guid).toBe("test-guid-001");
  });

  it("parses all log rows", () => {
    const result = parseFuelioCSV(SAMPLE_FUELIO_CSV);
    expect(result.logs).toHaveLength(3);
  });

  it("parses the first log row correctly", () => {
    const result = parseFuelioCSV(SAMPLE_FUELIO_CSV);
    const row = result.logs[0]!;
    expect(row.date).toBe("2026-01-05 10:00");
    expect(row.odoRaw).toBe("3000.0");
    expect(row.fuelRaw).toBe("10.08");
    expect(row.full).toBe("1");
    expect(row.priceRaw).toBe("116.55");
    expect(row.missed).toBe("0");
    expect(row.fuelType).toBe("112");
    expect(row.uniqueId).toBe("fill-001");
  });

  it("parses partial fill correctly", () => {
    const result = parseFuelioCSV(SAMPLE_FUELIO_CSV);
    const row = result.logs[1]!;
    expect(row.full).toBe("0"); // partial fill
  });

  it("returns no parse errors for a well-formed CSV", () => {
    const result = parseFuelioCSV(SAMPLE_FUELIO_CSV);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("returns null vehicle for CSV with no vehicle section", () => {
    const logOnly = `## Log\nData,Odo (km),Fuel (Litres),Full\n2026-01-01 10:00,1000.0,10.0,1\n`;
    const result = parseFuelioCSV(logOnly);
    expect(result.vehicle).toBeNull();
    expect(result.logs).toHaveLength(1);
  });

  it("handles empty content gracefully", () => {
    const result = parseFuelioCSV("");
    expect(result.vehicle).toBeNull();
    expect(result.logs).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("handles CRLF line endings", () => {
    const crlf = SAMPLE_FUELIO_CSV.replace(/\n/g, "\r\n");
    const result = parseFuelioCSV(crlf);
    expect(result.vehicle).not.toBeNull();
    expect(result.logs).toHaveLength(3);
  });
});

// ============================================================
// Generic CSV import
// ============================================================

const GENERIC_CSV_BASIC = `Date,Odometer,Litres,Total Cost,Currency,Fuel Type,Full Tank,Station
2024-01-15,68150,42.5,3500,INR,Petrol,Yes,HP Petrol
2024-02-10,70200,38.0,3200,INR,Diesel,No,Indian Oil
`;

const GENERIC_CSV_WITH_BOM = "﻿" + GENERIC_CSV_BASIC;

const GENERIC_CSV_CRLF = GENERIC_CSV_BASIC.replace(/\n/g, "\r\n");

const GENERIC_CSV_QUOTED = `Date,Odometer,Notes,Total Cost
2024-03-01,72000,"Filled up at ""Shell"", near highway",4500
`;

describe("parseGenericCSV", () => {
  it("parses a basic CSV and returns headers and rows", () => {
    const result = parseGenericCSV(GENERIC_CSV_BASIC);
    expect(result).not.toBeNull();
    expect(result!.isFuelio).toBe(false);
    expect(result!.headers).toEqual(["Date", "Odometer", "Litres", "Total Cost", "Currency", "Fuel Type", "Full Tank", "Station"]);
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0]![0]).toBe("2024-01-15");
  });

  it("strips a UTF-8 BOM before parsing", () => {
    const result = parseGenericCSV(GENERIC_CSV_WITH_BOM);
    expect(result).not.toBeNull();
    expect(result!.headers[0]).toBe("Date");
  });

  it("handles CRLF line endings", () => {
    const result = parseGenericCSV(GENERIC_CSV_CRLF);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(2);
  });

  it("handles quoted fields with embedded commas and escaped quotes", () => {
    const result = parseGenericCSV(GENERIC_CSV_QUOTED);
    expect(result).not.toBeNull();
    expect(result!.rows[0]![2]).toBe('Filled up at "Shell", near highway');
  });

  it("detects Fuelio format by section markers", () => {
    const result = parseGenericCSV(SAMPLE_FUELIO_CSV);
    expect(result).not.toBeNull();
    expect(result!.isFuelio).toBe(true);
  });

  it("returns null for an empty string", () => {
    expect(parseGenericCSV("")).toBeNull();
  });

  it("returns null for a file with only a header and no data rows", () => {
    expect(parseGenericCSV("Date,Odometer\n")).toBeNull();
  });
});

describe("suggestColumnMapping", () => {
  it("maps obvious column names to the correct fields", () => {
    const headers = ["Date", "Odometer", "Litres", "Total Cost", "Station", "Notes"];
    const map = suggestColumnMapping(headers);
    expect(map[0]).toBe("date");
    expect(map[1]).toBe("odometer");
    expect(map[2]).toBe("fuelQuantity");
    expect(map[3]).toBe("totalCost");
    expect(map[4]).toBe("stationName");
    expect(map[5]).toBe("notes");
  });

  it("maps alternative header spellings", () => {
    const headers = ["Tanken", "Km Reading", "Volume", "Price"];
    const map = suggestColumnMapping(headers);
    expect(map[0]).toBe("date");
    expect(map[1]).toBe("odometer");
    expect(map[2]).toBe("fuelQuantity");
    expect(map[3]).toBe("totalCost");
  });

  it("marks unrecognised columns as ignore", () => {
    const headers = ["Foo", "Bar", "Baz"];
    const map = suggestColumnMapping(headers);
    expect(map[0]).toBe("ignore");
    expect(map[1]).toBe("ignore");
    expect(map[2]).toBe("ignore");
  });

  it("does not map the same field twice", () => {
    const headers = ["Date", "DateTime", "Odometer", "Mileage"];
    const map = suggestColumnMapping(headers);
    const fields = Object.values(map).filter((f) => f !== "ignore");
    const unique = new Set(fields);
    expect(unique.size).toBe(fields.length);
  });
});

describe("validateGenericRow", () => {
  const defaultMap: GenericCsvColumnMap = {
    0: "date",
    1: "odometer",
    2: "fuelQuantity",
    3: "totalCost",
    4: "currency",
  };

  it("validates a correct row and produces a ValidatedGenericRow", () => {
    const row = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.occurredAt).toBe("2024-01-15");
    expect(result.odometerDkm).toBe(681500n);
    expect(result.fuelQuantityMl).toBe(42500n);
    expect(result.totalCostMinor).toBe(350000n);
    expect(result.currency).toBe("INR");
  });

  it("parses DD/MM/YYYY date format", () => {
    const row = ["15/01/2024", "68150", "42.5", "3500", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.occurredAt).toBe("2024-01-15");
  });

  it("returns an error for a missing date", () => {
    const row = ["", "68150", "42.5", "3500", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("date"))).toBe(true);
  });

  it("returns an error for an invalid odometer", () => {
    const row = ["2024-01-15", "abc", "42.5", "3500", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("odometer"))).toBe(true);
  });

  it("returns an error when fuel quantity column is missing from the map", () => {
    const mapNofuel: GenericCsvColumnMap = { 0: "date", 1: "odometer" };
    const row = ["2024-01-15", "68150"];
    const result = validateGenericRow(row, mapNofuel, 2, "INR", "litre");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("fuel quantity"))).toBe(true);
  });

  it("returns an error for a zero fuel quantity", () => {
    const row = ["2024-01-15", "68150", "0", "3500", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(false);
  });

  it("uses the default currency when the currency column is absent", () => {
    const mapNoCurrency: GenericCsvColumnMap = { 0: "date", 1: "odometer", 2: "fuelQuantity" };
    const row = ["2024-01-15", "68150", "42.5"];
    const result = validateGenericRow(row, mapNoCurrency, 2, "USD", "litre");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.currency).toBe("USD");
  });

  it("produces a deterministic importGuid for the same row data", () => {
    const row = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const r1 = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    const r2 = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).toBe(r2.importGuid);
  });

  it("produces different importGuids for rows with different odometer or fuel quantity", () => {
    const row1 = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const row2 = ["2024-01-15", "68200", "42.5", "3500", "INR"];
    const r1 = validateGenericRow(row1, defaultMap, 2, "INR", "litre");
    const r2 = validateGenericRow(row2, defaultMap, 2, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).not.toBe(r2.importGuid);
  });

  it("converts US gallons to millilitres correctly", () => {
    const row = ["2024-01-15", "68150", "10", "", "USD"];
    const result = validateGenericRow(row, defaultMap, 2, "USD", "gallon_us");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.fuelQuantityMl).toBe(37850n);
  });

  it("odometerDkm is stored in tenths (x10), not km", () => {
    // 68150 km input -> parseFuelioOdometer("68150") -> 681500n (tenths)
    // The UI must pass Number(r.odometerDkm) = 681500, NOT divide by 10.
    const row = ["2024-01-15", "68150", "42.5", "", "INR"];
    const result = validateGenericRow(row, defaultMap, 2, "INR", "litre");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.odometerDkm).toBe(681500n);
    // Regression: dividing by 10 would give 68150 -- wrong
    expect(result.odometerDkm).not.toBe(68150n);
  });
});

describe("parseDateString via validateGenericRow", () => {
  const map: GenericCsvColumnMap = { 0: "date", 1: "odometer", 2: "fuelQuantity" };

  function parseDate(dateStr: string): string | null {
    const row = [dateStr, "68150", "42.5"];
    const result = validateGenericRow(row, map, 1, "INR", "litre");
    if (!result.valid) return null;
    return result.occurredAt;
  }

  it("parses ISO date YYYY-MM-DD", () => {
    expect(parseDate("2024-01-15")).toBe("2024-01-15");
  });

  it("parses DD/MM/YYYY where day is unambiguous (day > 12)", () => {
    expect(parseDate("13/01/2024")).toBe("2024-01-13");
  });

  it("parses DD/MM/YYYY where date is ambiguous (both parts <= 12)", () => {
    // Convention: first number is day, second is month
    expect(parseDate("01/02/2024")).toBe("2024-02-01");
  });

  it("parses MM/DD/YYYY when month part is <= 12 but second number > 12 (regression: swap path was broken)", () => {
    // "01/15/2024" -> d=01, m=15 -> mm=15>12 so swap: month=1, day=15
    expect(parseDate("01/15/2024")).toBe("2024-01-15");
  });

  it("parses D MMM YYYY named month format", () => {
    expect(parseDate("5 Jan 2024")).toBe("2024-01-05");
  });

  it("returns null for an invalid date", () => {
    expect(parseDate("32/01/2024")).toBeNull();
    expect(parseDate("notadate")).toBeNull();
  });

  it("parses a leap day in a leap year", () => {
    expect(parseDate("29/02/2024")).toBe("2024-02-29");
  });

  it("returns null for a leap day in a non-leap year", () => {
    expect(parseDate("29/02/2023")).toBeNull();
  });

  it("parses an ambiguous date where both parts equal 12 as DD/MM (December 12)", () => {
    // Convention: first number is day, second is month -> 12 Dec 2024
    expect(parseDate("12/12/2024")).toBe("2024-12-12");
  });

  it("returns null for 31 February (calendar-impossible date)", () => {
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("2024-02-31")).toBeNull();
  });

  it("returns null for an empty date string", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("   ")).toBeNull();
  });

  it("dateFormat mdy: parses 03/05/2024 as March 5 (MM/DD)", () => {
    const row = ["03/05/2024", "68150", "42.5"];
    const r = validateGenericRow(row, map, 1, "INR", "litre", "mdy");
    expect(r.valid ? r.occurredAt : null).toBe("2024-03-05");
  });

  it("dateFormat dmy (default): parses 03/05/2024 as May 3 (DD/MM)", () => {
    const row = ["03/05/2024", "68150", "42.5"];
    const r = validateGenericRow(row, map, 1, "INR", "litre", "dmy");
    expect(r.valid ? r.occurredAt : null).toBe("2024-05-03");
  });

  it("dateFormat mdy: unambiguous day > 12 still parsed correctly", () => {
    // 15/03/2024 -- first=15 > 12 so it is unambiguously DD/MM regardless of format
    const row = ["15/03/2024", "68150", "42.5"];
    const r = validateGenericRow(row, map, 1, "INR", "litre", "mdy");
    expect(r.valid ? r.occurredAt : null).toBe("2024-03-15");
  });

  it("dateFormat mdy: ISO date is never affected by format selector", () => {
    const row = ["2024-01-15", "68150", "42.5"];
    const r = validateGenericRow(row, map, 1, "INR", "litre", "mdy");
    expect(r.valid ? r.occurredAt : null).toBe("2024-01-15");
  });
});

describe("within-file importGuid collision", () => {
  const map: GenericCsvColumnMap = { 0: "date", 1: "odometer", 2: "fuelQuantity", 3: "totalCost", 4: "currency" };

  it("two rows with identical date, odometer, and fuel quantity produce the same importGuid", () => {
    const row = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const r1 = validateGenericRow(row, map, 2, "INR", "litre");
    const r2 = validateGenericRow(row, map, 3, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    // Identical guid means only one insert will succeed; pre-import detection
    // must show these as same-file duplicates in the preview.
    expect(r1.importGuid).toBe(r2.importGuid);
  });

  it("two rows that differ only in cost produce the same importGuid (cost is not part of the key)", () => {
    const row1 = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const row2 = ["2024-01-15", "68150", "42.5", "4000", "INR"];
    const r1 = validateGenericRow(row1, map, 2, "INR", "litre");
    const r2 = validateGenericRow(row2, map, 3, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).toBe(r2.importGuid);
  });

  it("two rows that differ in fuel quantity produce different importGuids", () => {
    const row1 = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const row2 = ["2024-01-15", "68150", "45.0", "3500", "INR"];
    const r1 = validateGenericRow(row1, map, 2, "INR", "litre");
    const r2 = validateGenericRow(row2, map, 3, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).not.toBe(r2.importGuid);
  });

  it("two rows that differ in date produce different importGuids", () => {
    const row1 = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const row2 = ["2024-01-16", "68150", "42.5", "3500", "INR"];
    const r1 = validateGenericRow(row1, map, 2, "INR", "litre");
    const r2 = validateGenericRow(row2, map, 3, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).not.toBe(r2.importGuid);
  });

  it("two rows that differ in odometer produce different importGuids", () => {
    const row1 = ["2024-01-15", "68150", "42.5", "3500", "INR"];
    const row2 = ["2024-01-15", "68200", "42.5", "3500", "INR"];
    const r1 = validateGenericRow(row1, map, 2, "INR", "litre");
    const r2 = validateGenericRow(row2, map, 3, "INR", "litre");
    expect(r1.valid && r2.valid).toBe(true);
    if (!r1.valid || !r2.valid) return;
    expect(r1.importGuid).not.toBe(r2.importGuid);
  });
});

describe("hasAmbiguousDates", () => {
  const map: GenericCsvColumnMap = { 0: "date", 1: "odometer", 2: "fuelQuantity" };

  it("returns true when any row has both parts <= 12", () => {
    const rows = [["2024-01-15", "100", "40"], ["03/05/2024", "200", "45"]];
    expect(hasAmbiguousDates(rows, map)).toBe(true);
  });

  it("returns false when all dates are ISO", () => {
    const rows = [["2024-01-15", "100", "40"], ["2024-03-20", "200", "45"]];
    expect(hasAmbiguousDates(rows, map)).toBe(false);
  });

  it("returns false when all dates have an unambiguous part > 12", () => {
    const rows = [["13/01/2024", "100", "40"], ["01/15/2024", "200", "45"]];
    expect(hasAmbiguousDates(rows, map)).toBe(false);
  });

  it("returns false when no date column is mapped", () => {
    const rows = [["03/05/2024", "100", "40"]];
    expect(hasAmbiguousDates(rows, {})).toBe(false);
  });

  it("returns false for named-month dates", () => {
    const rows = [["5 Jan 2024", "100", "40"], ["12 Dec 2023", "200", "45"]];
    expect(hasAmbiguousDates(rows, map)).toBe(false);
  });
});

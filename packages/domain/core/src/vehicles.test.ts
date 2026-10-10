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
  type FuelEfficiencyEntry,
  type CostPerKmEntry,
  type MonthlyCostFuelInput,
  type MonthlyCostExpenseInput,
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

/**
 * Pure vehicle domain types and calculation functions.
 *
 * Quantity conventions (no floating point):
 *   - Odometer:      bigint in TENTHS of the vehicle's odometer_unit (dkm or dmi, ×10).
 *                    681.5 km → 6815. Column/field name: *_odo or odometer.
 *   - Fuel quantity: bigint MILLILITRES (×1000). 10.08 L → 10080 mL.
 *   - Money:         bigint MINOR UNITS via Money class (ADR-0002).
 *   - Unit price:    bigint minor units PER LITRE (or per gallon). 116.55 INR/L → 11655 paise/L.
 *
 * Fuel efficiency (km/L or mpg) is computed only from full-tank-to-full-tank
 * intervals. A run of partial fills between two consecutive full-tank events
 * represents one measurable interval; any sequence without at least two full-
 * tank events produces { type: "insufficient_data" }.
 *
 * This module has zero dependency on React, Supabase, or any I/O.
 */

// ============================================================
// Vehicle profile
// ============================================================

export type VehicleType = "motorcycle" | "scooter" | "car" | "ev" | "truck" | "van" | "other";
export type VehicleFuelType = "petrol" | "diesel" | "cng" | "lpg" | "electric" | "hybrid" | "other";
export type VehicleOdometerUnit = "km" | "mi";
export type VehicleFuelUnit = "litre" | "gallon_us" | "gallon_uk";
export type VehicleStatus = "active" | "archived";

export interface Vehicle {
  id: string;
  userId: string;
  name: string;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
  variant: string | null;
  manufacturingYear: number | null;
  registrationNumber: string | null;
  vin: string | null;
  fuelType: VehicleFuelType;
  transmission: string | null;
  odometerUnit: VehicleOdometerUnit;
  fuelUnit: VehicleFuelUnit;
  /** Tank capacity in millilitres. */
  tankCapacityMl: bigint | null;
  photoStoragePath: string | null;
  purchaseDate: string | null;
  purchaseAmountMinor: bigint | null;
  purchaseCurrency: string | null;
  /** Latest odometer in tenths of odometerUnit (×10). */
  currentOdometer: bigint;
  notes: string | null;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Fuel entries
// ============================================================

export type FuelEntryFuelType =
  | "petrol"
  | "petrol_premium"
  | "diesel"
  | "cng"
  | "lpg"
  | "electric"
  | "other";

export interface VehicleFuelEntry {
  id: string;
  userId: string;
  vehicleId: string;
  occurredAt: string;
  /** Odometer at fill-up in tenths of vehicle's odometerUnit (×10). */
  odometer: bigint;
  /** Fuel quantity in millilitres. */
  fuelQuantityMl: bigint;
  /** Total cost in minor units. Null if not recorded. */
  totalCostMinor: bigint | null;
  /** Price per litre (or gallon) in minor units. Null if not recorded. */
  pricePerUnitMinor: bigint | null;
  currency: string;
  fuelType: FuelEntryFuelType;
  isFullTank: boolean;
  isMissed: boolean;
  excludeDistance: boolean;
  stationName: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  transactionId: string | null;
  importSource: string | null;
  importGuid: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Vehicle expenses
// ============================================================

export type VehicleExpenseCategory =
  | "service"
  | "tyres"
  | "insurance"
  | "fuel"
  | "parking"
  | "toll"
  | "wash"
  | "accessories"
  | "tax"
  | "registration"
  | "puc"
  | "repair"
  | "battery"
  | "chain"
  | "other";

export interface VehicleExpense {
  id: string;
  userId: string;
  vehicleId: string;
  occurredAt: string;
  amountMinor: bigint;
  currency: string;
  expenseCategory: VehicleExpenseCategory;
  description: string | null;
  vendor: string | null;
  odometer: bigint | null;
  notes: string | null;
  transactionId: string | null;
  importGuid: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Maintenance records
// ============================================================

export type MaintenanceCategory =
  | "service"
  | "oil_change"
  | "tyre"
  | "brake"
  | "battery"
  | "chain"
  | "air_filter"
  | "spark_plug"
  | "inspection"
  | "repair"
  | "other";

export type MaintenanceStatus = "completed" | "upcoming" | "overdue";

export interface VehicleMaintenanceRecord {
  id: string;
  userId: string;
  vehicleId: string;
  title: string;
  maintenanceCategory: MaintenanceCategory;
  servicedAt: string | null;
  odometer: bigint | null;
  costMinor: bigint | null;
  currency: string | null;
  vendor: string | null;
  notes: string | null;
  nextDueDate: string | null;
  nextDueOdometer: bigint | null;
  recurrenceMonths: number | null;
  recurrenceKm: number | null;
  status: MaintenanceStatus;
  transactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Documents
// ============================================================

export type VehicleDocumentType =
  | "insurance"
  | "puc"
  | "rc"
  | "road_tax"
  | "permit"
  | "warranty"
  | "other";

export type VehicleDocumentStatus = "active" | "expired" | "archived";

export interface VehicleDocument {
  id: string;
  userId: string;
  vehicleId: string;
  documentType: VehicleDocumentType;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  storagePath: string | null;
  reminderDaysBefore: number[];
  notes: string | null;
  status: VehicleDocumentStatus;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Reminders
// ============================================================

export type VehicleReminderType =
  | "maintenance_date"
  | "maintenance_odometer"
  | "document_expiry"
  | "custom";

export interface VehicleReminder {
  id: string;
  userId: string;
  vehicleId: string;
  reminderType: VehicleReminderType;
  title: string;
  dueDate: string | null;
  /** Due odometer in tenths of vehicle's odometerUnit (×10). */
  dueOdometer: bigint | null;
  sourceType: "maintenance_record" | "document" | null;
  sourceId: string | null;
  isDismissed: boolean;
  isCompleted: boolean;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Fuel efficiency calculations (full-tank-to-full-tank semantics)
// ============================================================

/**
 * The result of a fuel efficiency calculation.
 *
 * - "computed": at least one valid full-tank interval was found.
 *   kmPerLitre is stored as an integer of "km per litre × 100" to
 *   preserve 2dp without floating point (e.g. 23.45 km/L → 2345).
 * - "insufficient_data": no full-tank-to-full-tank interval exists in
 *   the supplied entries (e.g. all entries are partial fills).
 * - "no_entries": the entry list is empty.
 */
export type FuelEfficiencyResult =
  | { type: "computed"; intervalCount: number; kmPerLitreCx100: bigint }
  | { type: "insufficient_data" }
  | { type: "no_entries" };

/**
 * Minimal projection of a fuel entry needed for efficiency calculation.
 * Sorted in ascending occurred_at order by the caller.
 */
export interface FuelEfficiencyEntry {
  /** Odometer in tenths of km (×10). */
  odometer: bigint;
  /** Fuel quantity in millilitres. */
  fuelQuantityMl: bigint;
  isFullTank: boolean;
  isMissed: boolean;
  excludeDistance: boolean;
}

/**
 * Calculate overall fuel efficiency across a chronologically sorted
 * list of fuel entries using full-tank-to-full-tank interval semantics.
 *
 * Algorithm:
 *   1. Find all indices where isFullTank = true and isMissed = false and
 *      excludeDistance = false.
 *   2. For each consecutive pair of full-tank indices [i, j]:
 *      - distance = (odometer[j] - odometer[i]) in tenths-km (dkm).
 *      - fuel     = sum of fuelQuantityMl for entries (i+1 .. j] inclusive.
 *      - If distance ≤ 0 (OBD/entry error) skip this interval.
 *      - Otherwise accumulate distance and fuel across all such intervals.
 *   3. If at least one valid interval: return km per litre scaled ×100.
 *      kmPerLitreCx100 = (totalDistanceDkm * 100_000) / (totalFuelMl * 10)
 *                      = (totalDistanceDkm * 10_000) / totalFuelMl
 *      derivation:
 *        km = dkm / 10
 *        L  = ml / 1000
 *        km/L = (dkm/10) / (ml/1000) = dkm * 100 / ml
 *        (km/L) * 100 = dkm * 10_000 / ml
 *
 * This produces exact integer arithmetic throughout; no floating-point ever.
 */
export function calculateFuelEfficiency(
  entries: readonly FuelEfficiencyEntry[],
): FuelEfficiencyResult {
  if (entries.length === 0) return { type: "no_entries" };

  // Collect indices of qualifying full-tank entries.
  const fullTankIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e !== undefined && e.isFullTank && !e.isMissed && !e.excludeDistance) {
      fullTankIndices.push(i);
    }
  }

  if (fullTankIndices.length < 2) return { type: "insufficient_data" };

  let totalDistanceDkm = 0n;
  let totalFuelMl = 0n;
  let intervalCount = 0;

  for (let k = 0; k < fullTankIndices.length - 1; k++) {
    const startIdx = fullTankIndices[k];
    const endIdx = fullTankIndices[k + 1];
    if (startIdx === undefined || endIdx === undefined) continue;

    const startEntry = entries[startIdx];
    const endEntry = entries[endIdx];
    if (startEntry === undefined || endEntry === undefined) continue;

    const distanceDkm = endEntry.odometer - startEntry.odometer;
    if (distanceDkm <= 0n) continue;

    // Sum fuel for entries from startIdx+1 to endIdx (inclusive).
    let intervalFuelMl = 0n;
    let missed = false;
    for (let j = startIdx + 1; j <= endIdx; j++) {
      const entry = entries[j];
      if (entry === undefined) continue;
      if (entry.isMissed) { missed = true; break; }
      intervalFuelMl += entry.fuelQuantityMl;
    }
    if (missed || intervalFuelMl === 0n) continue;

    totalDistanceDkm += distanceDkm;
    totalFuelMl += intervalFuelMl;
    intervalCount += 1;
  }

  if (intervalCount === 0 || totalFuelMl === 0n) return { type: "insufficient_data" };

  const kmPerLitreCx100 = (totalDistanceDkm * 10_000n) / totalFuelMl;
  return { type: "computed", intervalCount, kmPerLitreCx100 };
}

// ============================================================
// Cost-per-km (paise per km, or minor-units per km)
// ============================================================

/**
 * Cost per unit distance for a set of fuel entries that have a total cost
 * recorded. Returns null when no costed entries are present.
 *
 * All entries are expected to share the same currency. The caller is
 * responsible for filtering to a single currency before calling this.
 *
 * Result: bigint paise per km × 100 (i.e. 2dp precision for paise/km).
 * Derivation:
 *   paise/km = totalCostMinor / (totalDistanceDkm / 10)
 *            = (totalCostMinor * 10) / totalDistanceDkm
 *   paise/km × 100 = (totalCostMinor * 1000) / totalDistanceDkm
 */
export type CostPerKmResult =
  | { type: "computed"; costPerKmCx100: bigint; currency: string }
  | { type: "no_data" };

export interface CostPerKmEntry {
  odometer: bigint;
  totalCostMinor: bigint | null;
  isMissed: boolean;
  excludeDistance: boolean;
  currency: string;
}

export function calculateCostPerKm(
  entries: readonly CostPerKmEntry[],
): CostPerKmResult {
  if (entries.length < 2) return { type: "no_data" };

  let totalCostMinor = 0n;
  let hasCost = false;
  const firstEntry = entries[0];
  if (firstEntry === undefined) return { type: "no_data" };
  const currency = firstEntry.currency;

  for (const e of entries) {
    if (e.isMissed || e.excludeDistance) continue;
    if (e.totalCostMinor !== null && e.totalCostMinor > 0n) {
      totalCostMinor += e.totalCostMinor;
      hasCost = true;
    }
  }

  if (!hasCost) return { type: "no_data" };

  // Distance from first to last non-excluded entry.
  const validEntries = entries.filter((e) => !e.isMissed && !e.excludeDistance);
  if (validEntries.length < 2) return { type: "no_data" };

  const firstValid = validEntries[0];
  const lastValid = validEntries[validEntries.length - 1];
  if (firstValid === undefined || lastValid === undefined) return { type: "no_data" };
  const firstOdo = firstValid.odometer;
  const lastOdo = lastValid.odometer;
  const distanceDkm = lastOdo - firstOdo;
  if (distanceDkm <= 0n) return { type: "no_data" };

  const costPerKmCx100 = (totalCostMinor * 1000n) / distanceDkm;
  return { type: "computed", costPerKmCx100, currency };
}

// ============================================================
// Monthly cost aggregation
// ============================================================

/** A single month's vehicle cost summary. */
export interface VehicleMonthlyCost {
  /** "YYYY-MM" */
  month: string;
  fuelCostMinor: bigint;
  otherCostMinor: bigint;
  totalCostMinor: bigint;
  currency: string;
  fuelLitresMl: bigint;
  fuelEntryCount: number;
  expenseCount: number;
}

export interface MonthlyCostFuelInput {
  occurredAt: string;
  totalCostMinor: bigint | null;
  fuelQuantityMl: bigint;
  currency: string;
}

export interface MonthlyCostExpenseInput {
  occurredAt: string;
  amountMinor: bigint;
  currency: string;
}

/**
 * Aggregate fuel and expense records into per-month summaries.
 * Only entries sharing the given currency are counted.
 * Returns months sorted chronologically.
 */
export function aggregateMonthlyCosts(
  currency: string,
  fuelEntries: readonly MonthlyCostFuelInput[],
  expenses: readonly MonthlyCostExpenseInput[],
): VehicleMonthlyCost[] {
  const monthMap = new Map<string, VehicleMonthlyCost>();

  const getOrCreate = (month: string): VehicleMonthlyCost => {
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        month,
        fuelCostMinor: 0n,
        otherCostMinor: 0n,
        totalCostMinor: 0n,
        currency,
        fuelLitresMl: 0n,
        fuelEntryCount: 0,
        expenseCount: 0,
      });
    }
    return monthMap.get(month)!;
  };

  for (const fe of fuelEntries) {
    if (fe.currency !== currency) continue;
    const month = fe.occurredAt.slice(0, 7);
    const bucket = getOrCreate(month);
    bucket.fuelLitresMl += fe.fuelQuantityMl;
    bucket.fuelEntryCount++;
    if (fe.totalCostMinor !== null && fe.totalCostMinor > 0n) {
      bucket.fuelCostMinor += fe.totalCostMinor;
      bucket.totalCostMinor += fe.totalCostMinor;
    }
  }

  for (const ex of expenses) {
    if (ex.currency !== currency) continue;
    const month = ex.occurredAt.slice(0, 7);
    const bucket = getOrCreate(month);
    bucket.otherCostMinor += ex.amountMinor;
    bucket.totalCostMinor += ex.amountMinor;
    bucket.expenseCount++;
  }

  return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ============================================================
// Fuelio CSV import parser
// ============================================================

/** Raw vehicle row parsed from the ## Vehicle section. */
export interface FuelioVehicleRow {
  name: string;
  distUnit: number;       // 0 = km, 1 = mi
  fuelUnit: number;       // 0 = litre, 1 = gallon_us, 2 = gallon_uk
  consumptionUnit: number;
  tank1Capacity: number;  // decimal litres
  tank1Type: number;      // 100 = petrol, 112 = regular petrol, 121 = premium petrol, etc.
  guid: string;
  lastupdated: string;    // Java epoch milliseconds string
}

/** Raw log row parsed from the ## Log section. */
export interface FuelioLogRow {
  date: string;           // "YYYY-MM-DD HH:mm"
  odoRaw: string;         // decimal km/mi string as-is
  fuelRaw: string;        // decimal litres/gallons as-is
  full: string;           // "0" = partial, "1" = full
  priceRaw: string;       // total cost decimal, optional
  city: string;
  notes: string;
  missed: string;         // "0" = not missed
  tankNumber: string;
  fuelType: string;       // Fuelio numeric code
  volumePriceRaw: string; // price per litre decimal, optional
  stationId: string;
  excludeDistance: string;
  uniqueId: string;
  guid: string;
  lastupdated: string;
}

export interface FuelioParsedCSV {
  vehicle: FuelioVehicleRow | null;
  logs: FuelioLogRow[];
  parseErrors: string[];
}

/**
 * Parse a Fuelio CSV export.
 *
 * The Fuelio CSV is a multi-section file — not a standard flat CSV:
 *   ## Vehicle
 *   <header row>
 *   <data row>
 *   ## Log
 *   <header row>
 *   <data row> ...
 *   ## Category
 *   ...
 *
 * The parser splits on section markers and parses each section
 * independently. The Vehicle section has exactly one data row.
 * The Log section may have many rows.
 */
export function parseFuelioCSV(content: string): FuelioParsedCSV {
  const lines = content.split(/\r?\n/);
  const errors: string[] = [];
  let section: "none" | "vehicle" | "log" | "category" = "none";
  let headerRow: string[] | null = null;
  let vehicle: FuelioVehicleRow | null = null;
  const logs: FuelioLogRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (raw === "") continue;

    const firstField = parseCsvLine(raw)[0] ?? "";
    if (firstField === "## Vehicle") { section = "vehicle"; headerRow = null; continue; }
    if (firstField === "## Log")     { section = "log";     headerRow = null; continue; }
    if (firstField === "## Category"){ section = "category"; headerRow = null; continue; }
    if (firstField.startsWith("##")) { section = "none"; continue; }

    const cols = parseCsvLine(raw);

    if (section === "vehicle") {
      if (headerRow === null) { headerRow = cols.map(normalizeHeader); continue; }
      if (vehicle !== null) continue; // only first data row
      const r = zipToRecord(headerRow, cols);
      vehicle = {
        name:            r["name"]             ?? "",
        distUnit:        Number(r["distunit"]   ?? "0"),
        fuelUnit:        Number(r["fuelunit"]   ?? "0"),
        consumptionUnit: Number(r["consumptionunit"] ?? "3"),
        tank1Capacity:   Number(r["tank1capacity"] ?? "0"),
        tank1Type:       Number(r["tank1type"]  ?? "100"),
        guid:            r["guid"]             ?? "",
        lastupdated:     r["lastupdated"]      ?? "0",
      };
    } else if (section === "log") {
      if (headerRow === null) { headerRow = cols.map(normalizeHeader); continue; }
      const r = zipToRecord(headerRow, cols);
      logs.push({
        date:             r["data"]             ?? "",
        odoRaw:           r["odo (km)"]         ?? r["odo (mi)"] ?? r["odo"] ?? "",
        fuelRaw:          r["fuel (litres)"]    ?? r["fuel (gallons)"] ?? r["fuel"] ?? "",
        full:             r["full"]             ?? "0",
        priceRaw:         r["price (optional)"] ?? r["price"]   ?? "",
        city:             r["city (optional)"]  ?? r["city"]    ?? "",
        notes:            r["notes (optional)"] ?? r["notes"]   ?? "",
        missed:           r["missed"]           ?? "0",
        tankNumber:       r["tanknumber"]       ?? "1",
        fuelType:         r["fueltype"]         ?? "112",
        volumePriceRaw:   r["volumeprice"]      ?? "",
        stationId:        r["stationid (optional)"] ?? r["stationid"] ?? "",
        excludeDistance:  r["excludedistance"]  ?? "0",
        uniqueId:         r["uniqueid"]         ?? "",
        guid:             r["guid"]             ?? "",
        lastupdated:      r["lastupdated"]      ?? "0",
      });
    }
  }

  return { vehicle, logs, parseErrors: errors };
}

// ============================================================
// Conversion helpers: Fuelio raw → domain quantities
// ============================================================

/**
 * Map Fuelio numeric fuel type codes to the canonical domain fuel type.
 * Types not recognised default to "petrol".
 */
export function fuelioFuelTypeCode(code: string): FuelEntryFuelType {
  switch (code.trim()) {
    case "100":
    case "112": return "petrol";
    case "121": return "petrol_premium";
    case "200":
    case "210": return "diesel";
    case "300": return "lpg";
    case "310": return "cng";
    case "400": return "electric";
    default:    return "petrol";
  }
}

/**
 * Parse a Fuelio decimal odometer string to bigint tenths-of-unit (×10).
 * "681.5" → 6815n; "433.0" → 4330n; "3257" → 32570n.
 * Returns null if the string is empty or unparseable.
 */
export function parseFuelioOdometer(raw: string): bigint | null {
  if (!raw || raw.trim() === "") return null;
  const parts = raw.trim().split(".");
  const intStr = parts[0] ?? "0";
  const fracStr = parts[1] ?? "0";
  const intVal = BigInt(intStr);
  // Take only the first digit of the fractional part (tenths).
  const tenths = BigInt(fracStr.charAt(0) || "0");
  const sign = intVal < 0n ? -1n : 1n;
  return sign * (intVal < 0n ? -intVal : intVal) * 10n + tenths;
}

/**
 * Parse a Fuelio decimal litre string to bigint millilitres (×1000).
 * "10.08" → 10080n; "8.84" → 8840n.
 * Returns null if the string is empty or unparseable.
 */
export function parseFuelioFuelMl(raw: string): bigint | null {
  if (!raw || raw.trim() === "") return null;
  // Scale to millilitres: multiply by 1000, round to nearest integer.
  // Use string arithmetic to avoid floating point.
  const parts = raw.trim().split(".");
  const intStr = parts[0] ?? "0";
  const fracStr = parts[1] ?? "";
  const intVal = BigInt(intStr);
  // Pad or truncate fracPart to exactly 3 digits for mL precision.
  const frac3 = fracStr.padEnd(3, "0").slice(0, 3);
  const fracVal = BigInt(frac3 || "0");
  return intVal * 1000n + fracVal;
}

/**
 * Parse a Fuelio decimal currency string to bigint minor units (paise for INR).
 * "1174.82" → 117482n; "116.55" → 11655n.
 * Returns null if the string is empty or unparseable.
 */
export function parseFuelioCurrencyMinor(raw: string): bigint | null {
  if (!raw || raw.trim() === "") return null;
  const parts = raw.trim().split(".");
  const intStr = parts[0] ?? "0";
  const fracStr = parts[1] ?? "";
  const intVal = BigInt(intStr);
  const frac2 = fracStr.padEnd(2, "0").slice(0, 2);
  const fracVal = BigInt(frac2 || "0");
  return intVal * 100n + fracVal;
}

// ============================================================
// Odometer display helpers
// ============================================================

/**
 * Convert a bigint tenths-of-km value to a formatted decimal string.
 * 6815n → "681.5"
 */
export function formatOdometer(dkm: bigint): string {
  const whole = dkm / 10n;
  const frac  = dkm % 10n;
  return `${whole}.${frac}`;
}

/**
 * Convert a bigint millilitres value to a formatted decimal string in litres.
 * 10080n → "10.08"
 */
export function formatFuelLitres(ml: bigint): string {
  const whole = ml / 1000n;
  const frac3 = (ml % 1000n).toString().padStart(3, "0");
  // Trim trailing zeros after decimal but keep at least one digit.
  const trimmed = frac3.replace(/0+$/, "") || "0";
  return `${whole}.${trimmed}`;
}

// ============================================================
// Generic CSV import
// ============================================================

/**
 * Result of parsing a flat (non-Fuelio) CSV file.
 * isFuelio is true when Fuelio section markers are detected; callers should
 * redirect to the Fuelio import flow in that case.
 */
export interface GenericCsvParseResult {
  headers: string[];
  /** Raw rows as arrays of strings (one element per column). */
  rows: string[][];
  isFuelio: boolean;
}

/**
 * Parse a flat CSV file, stripping a UTF-8 BOM if present.
 * Returns null when the file is empty or has only one non-empty line.
 */
export function parseGenericCSV(content: string): GenericCsvParseResult | null {
  const raw = content.startsWith("﻿") ? content.slice(1) : content;
  const lines = raw.split(/\r?\n/);
  const isFuelio = lines.some((l) => { const f = parseCsvLine(l.trim())[0] ?? ""; return f === "## Vehicle" || f === "## Log"; });
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return null;
  const firstLine = nonEmpty[0];
  if (firstLine === undefined) return null;
  const headers = parseCsvLine(firstLine).map((h) => h.trim());
  if (headers.length === 0) return null;
  const rows = nonEmpty.slice(1).map(parseCsvLine);
  return { headers, rows, isFuelio };
}

/**
 * Domain fields that a generic CSV column may be mapped to.
 * "ignore" means the column is present but should not be imported.
 */
export type GenericCsvField =
  | "date"
  | "odometer"
  | "fuelQuantity"
  | "totalCost"
  | "currency"
  | "fuelType"
  | "isFullTank"
  | "isMissed"
  | "stationName"
  | "notes"
  | "ignore";

/** Maps column index to the domain field it should populate. */
export type GenericCsvColumnMap = Record<number, GenericCsvField>;

/**
 * Return a best-effort initial mapping from column indices to domain fields
 * based on header names. All results are suggestions; the user must confirm.
 */
export function suggestColumnMapping(headers: string[]): GenericCsvColumnMap {
  const map: GenericCsvColumnMap = {};
  const used = new Set<GenericCsvField>();

  const matchers: [GenericCsvField, string[]][] = [
    ["date", ["date", "datetime", "time", "filled", "fill date", "tanken", "datum", "tanked on"]],
    ["odometer", ["odometer", "odo", "mileage", "km reading", "mile", "reading", "kilometre", "kilometer", "kms"]],
    ["fuelQuantity", ["qty", "quantity", "litres", "liters", "gallons", "volume", "fuel (", "fuel qty", "ml", "liter"]],
    ["totalCost", ["total cost", "total price", "cost", "price", "amount paid", "total", "spending", "paid", "charge"]],
    ["isFullTank", ["full tank", "full fill", "complete fill", "topped", "full up", "full,"]],
    ["stationName", ["station", "petrol station", "gas station", "location", "place", "pump", "brand"]],
    ["notes", ["notes", "remarks", "comments", "note", "memo"]],
    ["fuelType", ["fuel type", "fueltype", "type", "grade", "fuel grade"]],
    ["currency", ["currency", " cur ", "curr", "ccy", "iso"]],
    ["isMissed", ["missed", "skip", "incomplete"]],
  ];

  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? "").toLowerCase().trim();
    let found: GenericCsvField = "ignore";
    for (const [field, terms] of matchers) {
      if (!used.has(field) && terms.some((t) => h.includes(t))) {
        found = field;
        used.add(field);
        break;
      }
    }
    map[i] = found;
  }
  return map;
}

export interface ValidatedGenericRow {
  valid: true;
  occurredAt: string;
  /** Odometer in tenths of unit (x10). */
  odometerDkm: bigint;
  fuelQuantityMl: bigint;
  totalCostMinor: bigint | null;
  currency: string;
  fuelType: string;
  isFullTank: boolean;
  isMissed: boolean;
  stationName: string | null;
  notes: string | null;
  /** Deterministic key for duplicate detection. */
  importGuid: string;
  sourceRow: number;
}

export interface InvalidGenericRow {
  valid: false;
  sourceRow: number;
  errors: string[];
}

export type GenericRowResult = ValidatedGenericRow | InvalidGenericRow;

/**
 * Validate a single raw CSV row against the provided column mapping.
 * sourceRow is the 1-based display row number (2 = first data row).
 */
export function validateGenericRow(
  row: string[],
  map: GenericCsvColumnMap,
  sourceRow: number,
  defaultCurrency: string,
  fuelUnit: "litre" | "gallon_us" | "gallon_uk",
  dateFormat: "dmy" | "mdy" = "dmy",
): GenericRowResult {
  const errors: string[] = [];

  const get = (field: GenericCsvField): string => {
    for (const [idx, f] of Object.entries(map)) {
      if (f === field) return (row[Number(idx)] ?? "").trim();
    }
    return "";
  };

  // Date (required)
  const dateRaw = get("date");
  const occurredAt = parseDateString(dateRaw, dateFormat);
  if (!occurredAt) {
    errors.push(
      dateRaw
        ? `"${dateRaw}" is not a recognised date. Use YYYY-MM-DD or DD/MM/YYYY.`
        : "Date is required.",
    );
  }

  // Odometer (required)
  const odoRaw = get("odometer");
  let odometerDkm: bigint | null = null;
  if (odoRaw) {
    try { odometerDkm = parseFuelioOdometer(odoRaw); } catch { odometerDkm = null; }
  }
  if (odometerDkm === null || odometerDkm < 0n) {
    errors.push(odoRaw ? `"${odoRaw}" is not a valid odometer reading.` : "Odometer is required.");
  }

  // Fuel quantity (required by schema)
  const fuelRaw = get("fuelQuantity");
  let fuelQuantityMl: bigint | null = null;
  if (!fuelRaw) {
    errors.push("Fuel quantity is required. Map a column to Fuel quantity.");
  } else {
    fuelQuantityMl = parseDecimalScaled(fuelRaw, fuelUnitToMlMultiplier(fuelUnit));
    if (fuelQuantityMl === null || fuelQuantityMl <= 0n) {
      errors.push(`"${fuelRaw}" is not a valid fuel quantity.`);
      fuelQuantityMl = null;
    }
  }

  // Total cost (optional)
  const costRaw = get("totalCost");
  let totalCostMinor: bigint | null = null;
  if (costRaw) {
    try {
      const parsed = parseFuelioCurrencyMinor(costRaw);
      if (parsed !== null && parsed > 0n) totalCostMinor = parsed;
    } catch { totalCostMinor = null; }
  }

  // Currency (optional, default from vehicle)
  const currencyRaw = get("currency").toUpperCase();
  const currency = currencyRaw || defaultCurrency;

  // Fuel type (optional)
  const fuelTypeRaw = get("fuelType");
  const fuelType = normalizeFuelTypeName(fuelTypeRaw) || "petrol";

  // Full tank (optional, default false)
  const isFullTank = parseBooleanToken(get("isFullTank"));

  // Missed (optional, default false)
  const isMissed = parseBooleanToken(get("isMissed"));

  // Station name (optional)
  const stationName = get("stationName") || null;

  // Notes (optional)
  const notes = get("notes") || null;

  if (errors.length > 0) return { valid: false, sourceRow, errors };

  const importGuid =
    `${occurredAt}|${odometerDkm!.toString()}|${fuelQuantityMl!.toString()}`;

  return {
    valid: true,
    occurredAt: occurredAt!,
    odometerDkm: odometerDkm!,
    fuelQuantityMl: fuelQuantityMl!,
    totalCostMinor,
    currency,
    fuelType,
    isFullTank,
    isMissed,
    stationName,
    notes,
    importGuid,
    sourceRow,
  };
}

// ============================================================
// Generic CSV parse helpers
// ============================================================

function fuelUnitToMlMultiplier(unit: "litre" | "gallon_us" | "gallon_uk"): bigint {
  if (unit === "gallon_us") return 3785n;
  if (unit === "gallon_uk") return 4546n;
  return 1000n; // litres
}

/**
 * Parse a decimal string and multiply by an integer multiplier, dividing by
 * 1000 to apply the decimal portion.
 * "10.08" with multiplier 1000 -> 10080n (millilitres from litres).
 * "3.5" with multiplier 3785 -> 13247n (mL from US gallons, integer arithmetic).
 * Returns null if the string is empty or cannot be parsed.
 */
function parseDecimalScaled(raw: string, multiplier: bigint): bigint | null {
  if (!raw.trim()) return null;
  const parts = raw.trim().replace(/,/g, "").split(".");
  const intStr = parts[0] ?? "0";
  const fracStr = parts[1] ?? "";
  try {
    const intVal = BigInt(intStr);
    const frac3 = fracStr.padEnd(3, "0").slice(0, 3);
    const fracVal = BigInt(frac3);
    return (intVal * 1000n + fracVal) * multiplier / 1000n;
  } catch {
    return null;
  }
}

/**
 * Parse a date string in several common formats. Returns ISO YYYY-MM-DD or null.
 * ISO and named-month formats are always unambiguous.
 * For numeric two-part dates where both parts are <= 12, dateFormat selects the
 * interpretation: "dmy" (default) = DD/MM/YYYY, "mdy" = MM/DD/YYYY.
 */
function parseDateString(raw: string, dateFormat: "dmy" | "mdy" = "dmy"): string | null {
  if (!raw.trim()) return null;
  const s = raw.trim();

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    if (isValidDate(Number(y), Number(m), Number(d))) return `${y}-${m}-${d}`;
  }

  // Numeric two-part: handles DD/MM/YYYY, MM/DD/YYYY, and the ambiguous overlap
  const num = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (num) {
    const first = num[1] ?? "";
    const second = num[2] ?? "";
    const y = num[3] ?? "";
    const fv = Number(first);
    const sv = Number(second);
    if (sv > 12 && fv <= 12) {
      // Second part > 12: unambiguously the day; first part is the month (MM/DD)
      const pm = first.padStart(2, "0");
      const pd = second.padStart(2, "0");
      if (isValidDate(Number(y), fv, sv)) return `${y}-${pm}-${pd}`;
    } else if (fv > 12 && sv <= 12) {
      // First part > 12: unambiguously the day; second part is the month (DD/MM)
      const pd = first.padStart(2, "0");
      const pm = second.padStart(2, "0");
      if (isValidDate(Number(y), sv, fv)) return `${y}-${pm}-${pd}`;
    } else if (dateFormat === "mdy") {
      // Both <= 12: explicit MM/DD format -- first=month, second=day
      const pm = first.padStart(2, "0");
      const pd = second.padStart(2, "0");
      if (isValidDate(Number(y), fv, sv)) return `${y}-${pm}-${pd}`;
    } else {
      // Both <= 12: explicit DD/MM format (default) -- first=day, second=month
      const pd = first.padStart(2, "0");
      const pm = second.padStart(2, "0");
      if (isValidDate(Number(y), sv, fv)) return `${y}-${pm}-${pd}`;
    }
  }

  // "D MMM YYYY" or "DD MMM YYYY"
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const named = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (named) {
    const [, d, mon, y] = named;
    const m = months[(mon ?? "").toLowerCase()];
    if (m) {
      const pd = (Number(d)).toString().padStart(2, "0");
      if (isValidDate(Number(y), Number(m), Number(d))) return `${y}-${m}-${pd}`;
    }
  }

  return null;
}

/**
 * Returns true if any date cell in the mapped rows contains a numeric date
 * where both the first and second parts are <= 12, making the DD/MM vs MM/DD
 * interpretation ambiguous.
 */
export function hasAmbiguousDates(rows: string[][], map: GenericCsvColumnMap): boolean {
  const dateColIdx = Object.entries(map).find(([, f]) => f === "date")?.[0];
  if (dateColIdx === undefined) return false;
  const idx = Number(dateColIdx);
  for (const row of rows) {
    const raw = (row[idx] ?? "").trim();
    if (!raw) continue;
    // Skip ISO (YYYY-...) and named-month formats
    if (/^\d{4}[-\/]/.test(raw)) continue;
    if (/\d\s+[A-Za-z]{3}\s+\d{4}/.test(raw)) continue;
    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{4}/);
    if (m) {
      const fv = Number(m[1]);
      const sv = Number(m[2]);
      if (fv <= 12 && sv <= 12) return true;
    }
  }
  return false;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function parseBooleanToken(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return s === "1" || s === "yes" || s === "true" || s === "y" || s === "full" || s === "x";
}

function normalizeFuelTypeName(raw: string): FuelEntryFuelType | "" {
  const s = raw.toLowerCase().trim();
  if (!s) return "";
  if (s.includes("premium") || s.includes("super")) return "petrol_premium";
  if (s.includes("petrol") || s.includes("gasoline") || s.includes("unleaded") || s.includes("ron")) return "petrol";
  if (s.includes("diesel") || s.includes("hsd")) return "diesel";
  if (s.includes("cng") || s.includes("compressed natural")) return "cng";
  if (s.includes("lpg") || s.includes("autogas")) return "lpg";
  if (s.includes("electric") || s.includes(" ev") || s.includes("kwh")) return "electric";
  return "";
}

// ============================================================
// Private parse utilities
// ============================================================

/** Parse a single CSV line handling quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim();
}

function zipToRecord(headers: string[], cols: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    if (key !== undefined) {
      out[key] = cols[i] ?? "";
    }
  }
  return out;
}

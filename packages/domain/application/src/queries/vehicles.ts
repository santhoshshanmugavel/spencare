import {
  listVehicles as listVehiclesRow,
  getVehicle as getVehicleRow,
  listFuelEntries as listFuelEntriesRow,
  getFuelEntry as getFuelEntryRow,
  listVehicleExpenses as listVehicleExpensesRow,
  listMaintenanceRecords as listMaintenanceRecordsRow,
  listVehicleDocuments as listVehicleDocumentsRow,
  listVehicleReminders as listVehicleRemindersRow,
  getExistingImportGuids as getExistingImportGuidsRow,
  type ListFuelEntriesOptions,
  type VehicleRow,
  type VehicleFuelEntryRow,
  type VehicleExpenseRow,
  type VehicleMaintenanceRow,
  type VehicleDocumentRow,
  type VehicleReminderRow,
} from "@spencare/domain-infra";
import {
  calculateFuelEfficiency,
  calculateCostPerKm,
  aggregateMonthlyCosts,
  type FuelEfficiencyResult,
  type CostPerKmResult,
  type VehicleMonthlyCost,
} from "@spencare/domain-core";
import type { AuthContext } from "../types.js";

export type {
  VehicleRow,
  VehicleFuelEntryRow,
  VehicleExpenseRow,
  VehicleMaintenanceRow,
  VehicleDocumentRow,
  VehicleReminderRow,
};

export async function listVehicles(ctx: AuthContext): Promise<VehicleRow[]> {
  return listVehiclesRow(ctx.supabase, ctx.userId);
}

export async function getVehicle(ctx: AuthContext, vehicleId: string): Promise<VehicleRow | null> {
  return getVehicleRow(ctx.supabase, ctx.userId, vehicleId);
}

export async function listFuelEntries(
  ctx: AuthContext,
  options: ListFuelEntriesOptions,
): Promise<VehicleFuelEntryRow[]> {
  return listFuelEntriesRow(ctx.supabase, ctx.userId, options);
}

export async function getFuelEntry(
  ctx: AuthContext,
  entryId: string,
): Promise<VehicleFuelEntryRow | null> {
  return getFuelEntryRow(ctx.supabase, ctx.userId, entryId);
}

export async function listVehicleExpenses(
  ctx: AuthContext,
  vehicleId: string,
): Promise<VehicleExpenseRow[]> {
  return listVehicleExpensesRow(ctx.supabase, ctx.userId, vehicleId);
}

export async function listMaintenanceRecords(
  ctx: AuthContext,
  vehicleId: string,
): Promise<VehicleMaintenanceRow[]> {
  return listMaintenanceRecordsRow(ctx.supabase, ctx.userId, vehicleId);
}

export async function listVehicleDocuments(
  ctx: AuthContext,
  vehicleId: string,
): Promise<VehicleDocumentRow[]> {
  return listVehicleDocumentsRow(ctx.supabase, ctx.userId, vehicleId);
}

export async function listVehicleReminders(
  ctx: AuthContext,
  vehicleId: string,
  includeDismissed = false,
): Promise<VehicleReminderRow[]> {
  return listVehicleRemindersRow(ctx.supabase, ctx.userId, vehicleId, includeDismissed);
}

export async function getExistingImportGuids(
  ctx: AuthContext,
  vehicleId: string,
  source: string,
  guids: string[],
): Promise<string[]> {
  return getExistingImportGuidsRow(ctx.supabase, ctx.userId, vehicleId, source, guids);
}

// ============================================================
// Computed summaries (pure, no extra DB calls)
// ============================================================

export interface VehicleDashboardData {
  vehicle: VehicleRow;
  fuelEntries: VehicleFuelEntryRow[];
  expenses: VehicleExpenseRow[];
  efficiency: FuelEfficiencyResult;
  costPerKm: CostPerKmResult;
  monthlyCosts: VehicleMonthlyCost[];
  totalFuelCostMinor: number;
  totalOtherCostMinor: number;
  totalCostMinor: number;
  currency: string;
}

export async function getVehicleDashboard(
  ctx: AuthContext,
  vehicleId: string,
): Promise<VehicleDashboardData | null> {
  const [vehicle, fuelEntries, expenses] = await Promise.all([
    getVehicleRow(ctx.supabase, ctx.userId, vehicleId),
    listFuelEntriesRow(ctx.supabase, ctx.userId, { vehicleId }),
    listVehicleExpensesRow(ctx.supabase, ctx.userId, vehicleId),
  ]);

  if (!vehicle) return null;

  const efficiencyEntries = fuelEntries.map((e) => ({
    odometer: BigInt(e.odometer),
    fuelQuantityMl: BigInt(e.fuel_quantity_ml),
    isFullTank: e.is_full_tank,
    isMissed: e.is_missed,
    excludeDistance: e.exclude_distance,
  }));

  const efficiency = calculateFuelEfficiency(efficiencyEntries);

  // Infer primary currency from fuel entries, falling back to first expense.
  const currency =
    fuelEntries[0]?.currency ??
    expenses[0]?.currency ??
    "INR";

  const costPerKmEntries = fuelEntries
    .filter((e) => e.currency === currency)
    .map((e) => ({
      odometer: BigInt(e.odometer),
      totalCostMinor: e.total_cost_minor !== null ? BigInt(e.total_cost_minor) : null,
      isMissed: e.is_missed,
      excludeDistance: e.exclude_distance,
      currency: e.currency,
    }));

  const costPerKm = calculateCostPerKm(costPerKmEntries);

  const monthlyCosts = aggregateMonthlyCosts(
    currency,
    fuelEntries
      .filter((e) => e.currency === currency)
      .map((e) => ({
        occurredAt: e.occurred_at,
        totalCostMinor: e.total_cost_minor !== null ? BigInt(e.total_cost_minor) : null,
        fuelQuantityMl: BigInt(e.fuel_quantity_ml),
        currency: e.currency,
      })),
    expenses
      .filter((e) => e.currency === currency)
      .map((e) => ({
        occurredAt: e.occurred_at,
        amountMinor: BigInt(e.amount_minor),
        currency: e.currency,
      })),
  );

  const totalFuelCostMinor = fuelEntries
    .filter((e) => e.currency === currency && e.total_cost_minor !== null)
    .reduce((acc, e) => acc + Number(e.total_cost_minor!), 0);

  const totalOtherCostMinor = expenses
    .filter((e) => e.currency === currency)
    .reduce((acc, e) => acc + Number(e.amount_minor), 0);

  return {
    vehicle,
    fuelEntries,
    expenses,
    efficiency,
    costPerKm,
    monthlyCosts,
    totalFuelCostMinor,
    totalOtherCostMinor,
    totalCostMinor: totalFuelCostMinor + totalOtherCostMinor,  // both are now number
    currency,
  };
}

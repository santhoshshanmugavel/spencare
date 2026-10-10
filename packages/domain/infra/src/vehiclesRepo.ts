import type { TypedSupabaseClient } from "./supabaseClients.js";

// TYPING NOTE: the vehicle tables (vehicles, vehicle_fuel_entries,
// vehicle_expenses, vehicle_maintenance_records, vehicle_documents,
// vehicle_reminders) were added in migration 20261010000001 but the
// generated database.types.ts has not been regenerated yet (no live
// Supabase CLI invocation in this session). All .from() calls for
// these tables go through `(client as any)` to escape the type check;
// the row shapes are enforced by the explicit Row interfaces above.
// Run `supabase gen types typescript ...` after applying the migration
// to replace these casts with real generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (client: TypedSupabaseClient) => client as any;

/**
 * Vehicles repository.
 *
 * All mutations use the caller's own RLS-scoped client with explicit
 * .eq("user_id", userId) alongside RLS ("own-only" pattern from
 * security-architecture.md §2). There is no derived balance table to
 * keep in sync atomically (unlike accounts/transactions), so direct
 * table operations suffice. Transaction linking (vehicle_fuel_entry_id
 * / vehicle_expense_id on the transactions table) is handled at the
 * server action layer to ensure both rows are written in the same
 * request, but without requiring a SECURITY DEFINER RPC since no
 * audit_log write is needed for vehicle mutations.
 */

// ============================================================
// Row types (manually maintained — do not derive from generated/)
// ============================================================

export interface VehicleRow {
  id: string;
  user_id: string;
  name: string;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  manufacturing_year: number | null;
  registration_number: string | null;
  vin: string | null;
  fuel_type: string;
  transmission: string | null;
  odometer_unit: string;
  fuel_unit: string;
  tank_capacity_ml: number | null;
  photo_storage_path: string | null;
  purchase_date: string | null;
  purchase_amount_minor: number | null;
  purchase_currency: string | null;
  current_odometer: number;
  notes: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface VehicleFuelEntryRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  occurred_at: string;
  odometer: number;
  fuel_quantity_ml: number;
  total_cost_minor: number | null;
  price_per_unit_minor: number | null;
  currency: string;
  fuel_type: string;
  is_full_tank: boolean;
  is_missed: boolean;
  exclude_distance: boolean;
  station_name: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  transaction_id: string | null;
  import_source: string | null;
  import_guid: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleExpenseRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  occurred_at: string;
  amount_minor: number;
  currency: string;
  expense_category: string;
  description: string | null;
  vendor: string | null;
  odometer: number | null;
  notes: string | null;
  transaction_id: string | null;
  import_guid: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleMaintenanceRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  title: string;
  maintenance_category: string;
  serviced_at: string | null;
  odometer: number | null;
  cost_minor: number | null;
  currency: string | null;
  vendor: string | null;
  notes: string | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
  recurrence_months: number | null;
  recurrence_km: number | null;
  status: "completed" | "upcoming" | "overdue";
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleDocumentRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  document_type: "insurance" | "puc" | "rc" | "road_tax" | "permit" | "warranty" | "other";
  title: string;
  issuer: string | null;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  storage_path: string | null;
  reminder_days_before: number[];
  notes: string | null;
  status: "active" | "expired" | "archived";
  created_at: string;
  updated_at: string;
}

export interface VehicleReminderRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  reminder_type: "maintenance_date" | "maintenance_odometer" | "document_expiry" | "custom";
  title: string;
  due_date: string | null;
  due_odometer: number | null;
  source_type: "maintenance_record" | "document" | null;
  source_id: string | null;
  is_dismissed: boolean;
  is_completed: boolean;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Column selects
// ============================================================

const VEHICLE_COLS =
  "id, user_id, name, vehicle_type, make, model, variant, manufacturing_year, " +
  "registration_number, vin, fuel_type, transmission, odometer_unit, fuel_unit, " +
  "tank_capacity_ml, photo_storage_path, purchase_date, purchase_amount_minor, " +
  "purchase_currency, current_odometer, notes, status, created_at, updated_at";

const FUEL_ENTRY_COLS =
  "id, user_id, vehicle_id, occurred_at, odometer, fuel_quantity_ml, " +
  "total_cost_minor, price_per_unit_minor, currency, fuel_type, is_full_tank, " +
  "is_missed, exclude_distance, station_name, city, latitude, longitude, notes, " +
  "transaction_id, import_source, import_guid, import_batch_id, created_at, updated_at";

const EXPENSE_COLS =
  "id, user_id, vehicle_id, occurred_at, amount_minor, currency, expense_category, " +
  "description, vendor, odometer, notes, transaction_id, import_guid, import_batch_id, " +
  "created_at, updated_at";

const MAINTENANCE_COLS =
  "id, user_id, vehicle_id, title, maintenance_category, serviced_at, odometer, " +
  "cost_minor, currency, vendor, notes, next_due_date, next_due_odometer, " +
  "recurrence_months, recurrence_km, status, transaction_id, created_at, updated_at";

const DOCUMENT_COLS =
  "id, user_id, vehicle_id, document_type, title, issuer, reference_number, " +
  "issue_date, expiry_date, storage_path, reminder_days_before, notes, status, " +
  "created_at, updated_at";

const REMINDER_COLS =
  "id, user_id, vehicle_id, reminder_type, title, due_date, due_odometer, " +
  "source_type, source_id, is_dismissed, is_completed, notified_at, " +
  "created_at, updated_at";

// ============================================================
// Vehicles
// ============================================================

export async function listVehicles(
  client: TypedSupabaseClient,
  userId: string,
): Promise<VehicleRow[]> {
  const { data, error } = await db(client)
    .from("vehicles")
    .select(VEHICLE_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listVehicles: ${error.message}`);
  return (data ?? []) as VehicleRow[];
}

export async function getVehicle(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VehicleRow | null> {
  const { data, error } = await db(client)
    .from("vehicles")
    .select(VEHICLE_COLS)
    .eq("user_id", userId)
    .eq("id", vehicleId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw new Error(`getVehicle: ${error.message}`);
  return data as VehicleRow;
}

export interface CreateVehiclePatch {
  name: string;
  vehicleType: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  manufacturingYear?: number | null;
  registrationNumber?: string | null;
  vin?: string | null;
  fuelType: string;
  transmission?: string | null;
  odometerUnit: string;
  fuelUnit: string;
  tankCapacityMl?: number | null;
  purchaseDate?: string | null;
  purchaseAmountMinor?: number | null;
  purchaseCurrency?: string | null;
  currentOdometer?: number;
  notes?: string | null;
}

export async function createVehicle(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateVehiclePatch,
): Promise<VehicleRow> {
  const { data, error } = await db(client)
    .from("vehicles")
    .insert({
      user_id: userId,
      name: patch.name,
      vehicle_type: patch.vehicleType,
      make: patch.make ?? null,
      model: patch.model ?? null,
      variant: patch.variant ?? null,
      manufacturing_year: patch.manufacturingYear ?? null,
      registration_number: patch.registrationNumber ?? null,
      vin: patch.vin ?? null,
      fuel_type: patch.fuelType,
      transmission: patch.transmission ?? null,
      odometer_unit: patch.odometerUnit,
      fuel_unit: patch.fuelUnit,
      tank_capacity_ml: patch.tankCapacityMl ?? null,
      purchase_date: patch.purchaseDate ?? null,
      purchase_amount_minor: patch.purchaseAmountMinor ?? null,
      purchase_currency: patch.purchaseCurrency ?? null,
      current_odometer: patch.currentOdometer ?? 0,
      notes: patch.notes ?? null,
      status: "active",
    })
    .select(VEHICLE_COLS)
    .single();
  if (error) throw new Error(`createVehicle: ${error.message}`);
  return data as VehicleRow;
}

export interface UpdateVehiclePatch extends Partial<CreateVehiclePatch> {
  photoStoragePath?: string | null;
  status?: "active" | "archived";
  currentOdometer?: number;
}

export async function updateVehicle(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
  patch: UpdateVehiclePatch,
): Promise<VehicleRow> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.vehicleType !== undefined) update.vehicle_type = patch.vehicleType;
  if (patch.make !== undefined) update.make = patch.make;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.variant !== undefined) update.variant = patch.variant;
  if (patch.manufacturingYear !== undefined) update.manufacturing_year = patch.manufacturingYear;
  if (patch.registrationNumber !== undefined) update.registration_number = patch.registrationNumber;
  if (patch.vin !== undefined) update.vin = patch.vin;
  if (patch.fuelType !== undefined) update.fuel_type = patch.fuelType;
  if (patch.transmission !== undefined) update.transmission = patch.transmission;
  if (patch.odometerUnit !== undefined) update.odometer_unit = patch.odometerUnit;
  if (patch.fuelUnit !== undefined) update.fuel_unit = patch.fuelUnit;
  if (patch.tankCapacityMl !== undefined) update.tank_capacity_ml = patch.tankCapacityMl;
  if (patch.photoStoragePath !== undefined) update.photo_storage_path = patch.photoStoragePath;
  if (patch.purchaseDate !== undefined) update.purchase_date = patch.purchaseDate;
  if (patch.purchaseAmountMinor !== undefined) update.purchase_amount_minor = patch.purchaseAmountMinor;
  if (patch.purchaseCurrency !== undefined) update.purchase_currency = patch.purchaseCurrency;
  if (patch.currentOdometer !== undefined) update.current_odometer = patch.currentOdometer;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.status !== undefined) update.status = patch.status;

  const { data, error } = await db(client)
    .from("vehicles")
    .update(update)
    .eq("user_id", userId)
    .eq("id", vehicleId)
    .select(VEHICLE_COLS)
    .single();
  if (error) throw new Error(`updateVehicle: ${error.message}`);
  return data as VehicleRow;
}

export async function deleteVehicle(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicles")
    .delete()
    .eq("user_id", userId)
    .eq("id", vehicleId);
  if (error) throw new Error(`deleteVehicle: ${error.message}`);
}

// ============================================================
// Fuel entries
// ============================================================

export interface ListFuelEntriesOptions {
  vehicleId: string;
  limit?: number;
  occurredFrom?: string;
  occurredTo?: string;
}

export async function listFuelEntries(
  client: TypedSupabaseClient,
  userId: string,
  options: ListFuelEntriesOptions,
): Promise<VehicleFuelEntryRow[]> {
  let query = db(client)
    .from("vehicle_fuel_entries")
    .select(FUEL_ENTRY_COLS)
    .eq("user_id", userId)
    .eq("vehicle_id", options.vehicleId)
    .order("occurred_at", { ascending: true });

  if (options.occurredFrom) query = query.gte("occurred_at", options.occurredFrom);
  if (options.occurredTo)   query = query.lte("occurred_at", options.occurredTo);
  if (options.limit)        query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw new Error(`listFuelEntries: ${error.message}`);
  return (data ?? []) as VehicleFuelEntryRow[];
}

export async function getFuelEntry(
  client: TypedSupabaseClient,
  userId: string,
  entryId: string,
): Promise<VehicleFuelEntryRow | null> {
  const { data, error } = await db(client)
    .from("vehicle_fuel_entries")
    .select(FUEL_ENTRY_COLS)
    .eq("user_id", userId)
    .eq("id", entryId)
    .single();
  if (error && error.code === "PGRST116") return null;
  if (error) throw new Error(`getFuelEntry: ${error.message}`);
  return data as VehicleFuelEntryRow;
}

export interface CreateFuelEntryPatch {
  vehicleId: string;
  occurredAt: string;
  odometer: number;
  fuelQuantityMl: number;
  totalCostMinor?: number | null;
  pricePerUnitMinor?: number | null;
  currency: string;
  fuelType: string;
  isFullTank: boolean;
  isMissed?: boolean;
  excludeDistance?: boolean;
  stationName?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  transactionId?: string | null;
  importSource?: string | null;
  importGuid?: string | null;
  importBatchId?: string | null;
}

export async function createFuelEntry(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateFuelEntryPatch,
): Promise<VehicleFuelEntryRow> {
  const { data, error } = await db(client)
    .from("vehicle_fuel_entries")
    .insert({
      user_id: userId,
      vehicle_id: patch.vehicleId,
      occurred_at: patch.occurredAt,
      odometer: patch.odometer,
      fuel_quantity_ml: patch.fuelQuantityMl,
      total_cost_minor: patch.totalCostMinor ?? null,
      price_per_unit_minor: patch.pricePerUnitMinor ?? null,
      currency: patch.currency,
      fuel_type: patch.fuelType,
      is_full_tank: patch.isFullTank,
      is_missed: patch.isMissed ?? false,
      exclude_distance: patch.excludeDistance ?? false,
      station_name: patch.stationName ?? null,
      city: patch.city ?? null,
      latitude: patch.latitude ?? null,
      longitude: patch.longitude ?? null,
      notes: patch.notes ?? null,
      transaction_id: patch.transactionId ?? null,
      import_source: patch.importSource ?? null,
      import_guid: patch.importGuid ?? null,
      import_batch_id: patch.importBatchId ?? null,
    })
    .select(FUEL_ENTRY_COLS)
    .single();
  if (error) throw new Error(`createFuelEntry: ${error.message}`);
  return data as VehicleFuelEntryRow;
}

export interface UpdateFuelEntryPatch extends Partial<Omit<CreateFuelEntryPatch, "vehicleId">> {
  transactionId?: string | null;
}

export async function updateFuelEntry(
  client: TypedSupabaseClient,
  userId: string,
  entryId: string,
  patch: UpdateFuelEntryPatch,
): Promise<VehicleFuelEntryRow> {
  const update: Record<string, unknown> = {};
  if (patch.occurredAt !== undefined)        update.occurred_at = patch.occurredAt;
  if (patch.odometer !== undefined)          update.odometer = patch.odometer;
  if (patch.fuelQuantityMl !== undefined)    update.fuel_quantity_ml = patch.fuelQuantityMl;
  if (patch.totalCostMinor !== undefined)    update.total_cost_minor = patch.totalCostMinor;
  if (patch.pricePerUnitMinor !== undefined) update.price_per_unit_minor = patch.pricePerUnitMinor;
  if (patch.currency !== undefined)          update.currency = patch.currency;
  if (patch.fuelType !== undefined)          update.fuel_type = patch.fuelType;
  if (patch.isFullTank !== undefined)        update.is_full_tank = patch.isFullTank;
  if (patch.isMissed !== undefined)          update.is_missed = patch.isMissed;
  if (patch.excludeDistance !== undefined)   update.exclude_distance = patch.excludeDistance;
  if (patch.stationName !== undefined)       update.station_name = patch.stationName;
  if (patch.city !== undefined)              update.city = patch.city;
  if (patch.latitude !== undefined)          update.latitude = patch.latitude;
  if (patch.longitude !== undefined)         update.longitude = patch.longitude;
  if (patch.notes !== undefined)             update.notes = patch.notes;
  if (patch.transactionId !== undefined)     update.transaction_id = patch.transactionId;

  const { data, error } = await db(client)
    .from("vehicle_fuel_entries")
    .update(update)
    .eq("user_id", userId)
    .eq("id", entryId)
    .select(FUEL_ENTRY_COLS)
    .single();
  if (error) throw new Error(`updateFuelEntry: ${error.message}`);
  return data as VehicleFuelEntryRow;
}

export async function deleteFuelEntry(
  client: TypedSupabaseClient,
  userId: string,
  entryId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicle_fuel_entries")
    .delete()
    .eq("user_id", userId)
    .eq("id", entryId);
  if (error) throw new Error(`deleteFuelEntry: ${error.message}`);
}

// ============================================================
// Vehicle expenses
// ============================================================

export async function listVehicleExpenses(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VehicleExpenseRow[]> {
  const { data, error } = await db(client)
    .from("vehicle_expenses")
    .select(EXPENSE_COLS)
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(`listVehicleExpenses: ${error.message}`);
  return (data ?? []) as VehicleExpenseRow[];
}

export interface CreateVehicleExpensePatch {
  vehicleId: string;
  occurredAt: string;
  amountMinor: number;
  currency: string;
  expenseCategory: string;
  description?: string | null;
  vendor?: string | null;
  odometer?: number | null;
  notes?: string | null;
  transactionId?: string | null;
  importGuid?: string | null;
  importBatchId?: string | null;
}

export async function createVehicleExpense(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateVehicleExpensePatch,
): Promise<VehicleExpenseRow> {
  const { data, error } = await db(client)
    .from("vehicle_expenses")
    .insert({
      user_id: userId,
      vehicle_id: patch.vehicleId,
      occurred_at: patch.occurredAt,
      amount_minor: patch.amountMinor,
      currency: patch.currency,
      expense_category: patch.expenseCategory,
      description: patch.description ?? null,
      vendor: patch.vendor ?? null,
      odometer: patch.odometer ?? null,
      notes: patch.notes ?? null,
      transaction_id: patch.transactionId ?? null,
      import_guid: patch.importGuid ?? null,
      import_batch_id: patch.importBatchId ?? null,
    })
    .select(EXPENSE_COLS)
    .single();
  if (error) throw new Error(`createVehicleExpense: ${error.message}`);
  return data as VehicleExpenseRow;
}

export async function deleteVehicleExpense(
  client: TypedSupabaseClient,
  userId: string,
  expenseId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicle_expenses")
    .delete()
    .eq("user_id", userId)
    .eq("id", expenseId);
  if (error) throw new Error(`deleteVehicleExpense: ${error.message}`);
}

// ============================================================
// Maintenance records
// ============================================================

export async function listMaintenanceRecords(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VehicleMaintenanceRow[]> {
  const { data, error } = await db(client)
    .from("vehicle_maintenance_records")
    .select(MAINTENANCE_COLS)
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .order("serviced_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listMaintenanceRecords: ${error.message}`);
  return (data ?? []) as VehicleMaintenanceRow[];
}

export interface CreateMaintenancePatch {
  vehicleId: string;
  title: string;
  maintenanceCategory: string;
  servicedAt?: string | null;
  odometer?: number | null;
  costMinor?: number | null;
  currency?: string | null;
  vendor?: string | null;
  notes?: string | null;
  nextDueDate?: string | null;
  nextDueOdometer?: number | null;
  recurrenceMonths?: number | null;
  recurrenceKm?: number | null;
  status?: "completed" | "upcoming" | "overdue";
  transactionId?: string | null;
}

export async function createMaintenanceRecord(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateMaintenancePatch,
): Promise<VehicleMaintenanceRow> {
  const { data, error } = await db(client)
    .from("vehicle_maintenance_records")
    .insert({
      user_id: userId,
      vehicle_id: patch.vehicleId,
      title: patch.title,
      maintenance_category: patch.maintenanceCategory,
      serviced_at: patch.servicedAt ?? null,
      odometer: patch.odometer ?? null,
      cost_minor: patch.costMinor ?? null,
      currency: patch.currency ?? null,
      vendor: patch.vendor ?? null,
      notes: patch.notes ?? null,
      next_due_date: patch.nextDueDate ?? null,
      next_due_odometer: patch.nextDueOdometer ?? null,
      recurrence_months: patch.recurrenceMonths ?? null,
      recurrence_km: patch.recurrenceKm ?? null,
      status: patch.status ?? "completed",
      transaction_id: patch.transactionId ?? null,
    })
    .select(MAINTENANCE_COLS)
    .single();
  if (error) throw new Error(`createMaintenanceRecord: ${error.message}`);
  return data as VehicleMaintenanceRow;
}

export async function deleteMaintenanceRecord(
  client: TypedSupabaseClient,
  userId: string,
  recordId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicle_maintenance_records")
    .delete()
    .eq("user_id", userId)
    .eq("id", recordId);
  if (error) throw new Error(`deleteMaintenanceRecord: ${error.message}`);
}

// ============================================================
// Documents
// ============================================================

export async function listVehicleDocuments(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<VehicleDocumentRow[]> {
  const { data, error } = await db(client)
    .from("vehicle_documents")
    .select(DOCUMENT_COLS)
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .order("expiry_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listVehicleDocuments: ${error.message}`);
  return (data ?? []) as VehicleDocumentRow[];
}

export interface CreateVehicleDocumentPatch {
  vehicleId: string;
  documentType: "insurance" | "puc" | "rc" | "road_tax" | "permit" | "warranty" | "other";
  title: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  storagePath?: string | null;
  reminderDaysBefore?: number[];
  notes?: string | null;
}

export async function createVehicleDocument(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateVehicleDocumentPatch,
): Promise<VehicleDocumentRow> {
  const { data, error } = await db(client)
    .from("vehicle_documents")
    .insert({
      user_id: userId,
      vehicle_id: patch.vehicleId,
      document_type: patch.documentType,
      title: patch.title,
      issuer: patch.issuer ?? null,
      reference_number: patch.referenceNumber ?? null,
      issue_date: patch.issueDate ?? null,
      expiry_date: patch.expiryDate ?? null,
      storage_path: patch.storagePath ?? null,
      reminder_days_before: patch.reminderDaysBefore ?? [30, 7, 1],
      notes: patch.notes ?? null,
      status: "active",
    })
    .select(DOCUMENT_COLS)
    .single();
  if (error) throw new Error(`createVehicleDocument: ${error.message}`);
  return data as VehicleDocumentRow;
}

export async function deleteVehicleDocument(
  client: TypedSupabaseClient,
  userId: string,
  documentId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicle_documents")
    .delete()
    .eq("user_id", userId)
    .eq("id", documentId);
  if (error) throw new Error(`deleteVehicleDocument: ${error.message}`);
}

// ============================================================
// Reminders
// ============================================================

export async function listVehicleReminders(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
  includeDismissed = false,
): Promise<VehicleReminderRow[]> {
  let query = db(client)
    .from("vehicle_reminders")
    .select(REMINDER_COLS)
    .eq("user_id", userId)
    .eq("vehicle_id", vehicleId)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (!includeDismissed) {
    query = query.eq("is_dismissed", false).eq("is_completed", false);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listVehicleReminders: ${error.message}`);
  return (data ?? []) as VehicleReminderRow[];
}

export async function upsertReminderForMaintenance(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
  maintenanceId: string,
  title: string,
  dueDate: string | null,
  dueOdometer: number | null,
): Promise<void> {
  if (!dueDate && !dueOdometer) return;

  // Delete any prior reminder tied to this maintenance record before inserting.
  await db(client)
    .from("vehicle_reminders")
    .delete()
    .eq("user_id", userId)
    .eq("source_id", maintenanceId)
    .eq("source_type", "maintenance_record");

  const reminderType: VehicleReminderRow["reminder_type"] = dueOdometer
    ? "maintenance_odometer"
    : "maintenance_date";

  const { error } = await db(client)
    .from("vehicle_reminders")
    .insert({
      user_id: userId,
      vehicle_id: vehicleId,
      reminder_type: reminderType,
      title,
      due_date: dueDate,
      due_odometer: dueOdometer,
      source_type: "maintenance_record",
      source_id: maintenanceId,
    });
  if (error) throw new Error(`upsertReminderForMaintenance: ${error.message}`);
}

export async function upsertReminderForDocument(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
  documentId: string,
  title: string,
  dueDates: string[],
): Promise<void> {
  // Delete prior reminders tied to this document.
  await db(client)
    .from("vehicle_reminders")
    .delete()
    .eq("user_id", userId)
    .eq("source_id", documentId)
    .eq("source_type", "document");

  if (dueDates.length === 0) return;

  const rows = dueDates.map((d) => ({
    user_id: userId,
    vehicle_id: vehicleId,
    reminder_type: "document_expiry" as const,
    title,
    due_date: d,
    due_odometer: null,
    source_type: "document" as const,
    source_id: documentId,
  }));

  const { error } = await db(client).from("vehicle_reminders").insert(rows);
  if (error) throw new Error(`upsertReminderForDocument: ${error.message}`);
}

export async function dismissReminder(
  client: TypedSupabaseClient,
  userId: string,
  reminderId: string,
): Promise<void> {
  const { error } = await db(client)
    .from("vehicle_reminders")
    .update({ is_dismissed: true })
    .eq("user_id", userId)
    .eq("id", reminderId);
  if (error) throw new Error(`dismissReminder: ${error.message}`);
}

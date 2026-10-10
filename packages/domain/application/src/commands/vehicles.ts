import {
  createVehicle as createVehicleRow,
  updateVehicle as updateVehicleRow,
  deleteVehicle as deleteVehicleRow,
  createFuelEntry as createFuelEntryRow,
  updateFuelEntry as updateFuelEntryRow,
  deleteFuelEntry as deleteFuelEntryRow,
  createVehicleExpense as createVehicleExpenseRow,
  deleteVehicleExpense as deleteVehicleExpenseRow,
  createMaintenanceRecord as createMaintenanceRow,
  deleteMaintenanceRecord as deleteMaintenanceRow,
  createVehicleDocument as createVehicleDocumentRow,
  deleteVehicleDocument as deleteVehicleDocumentRow,
  dismissReminder as dismissReminderRow,
  upsertReminderForMaintenance,
  upsertReminderForDocument,
  updateVehicle as updateVehicleRowPatch,
  type VehicleRow,
  type VehicleFuelEntryRow,
  type VehicleExpenseRow,
  type VehicleMaintenanceRow,
  type VehicleDocumentRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

// ============================================================
// Vehicle CRUD
// ============================================================

export interface CreateVehicleInput {
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

export const createVehicle: Command<CreateVehicleInput, VehicleRow> = {
  name: "createVehicle",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateVehicleInput): Promise<Result<VehicleRow>> {
    if (!input.name?.trim()) {
      return err({ code: "validation_error", message: "Vehicle name is required." });
    }
    const validTypes = ["motorcycle", "scooter", "car", "ev", "truck", "van", "other"];
    if (!validTypes.includes(input.vehicleType)) {
      return err({ code: "validation_error", message: "Invalid vehicle type." });
    }
    try {
      const row = await createVehicleRow(ctx.supabase, ctx.userId, input);
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't create the vehicle. Try again." });
    }
  },
};

export interface UpdateVehicleInput extends Partial<CreateVehicleInput> {
  vehicleId: string;
  photoStoragePath?: string | null;
  status?: "active" | "archived";
}

export const updateVehicle: Command<UpdateVehicleInput, VehicleRow> = {
  name: "updateVehicle",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateVehicleInput): Promise<Result<VehicleRow>> {
    if (!input.vehicleId) {
      return err({ code: "validation_error", message: "Missing vehicle id." });
    }
    try {
      const { vehicleId, ...patch } = input;
      const row = await updateVehicleRow(ctx.supabase, ctx.userId, vehicleId, patch);
      return ok(row);
    } catch {
      return err({ code: "update_failed", message: "Couldn't update the vehicle. Try again." });
    }
  },
};

export interface DeleteVehicleInput { vehicleId: string }

export const deleteVehicle: Command<DeleteVehicleInput, void> = {
  name: "deleteVehicle",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteVehicleInput): Promise<Result<void>> {
    if (!input.vehicleId) {
      return err({ code: "validation_error", message: "Missing vehicle id." });
    }
    try {
      await deleteVehicleRow(ctx.supabase, ctx.userId, input.vehicleId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete the vehicle. Try again." });
    }
  },
};

// ============================================================
// Fuel entries
// ============================================================

export interface CreateFuelEntryInput {
  vehicleId: string;
  occurredAt: string;
  /** Odometer in tenths of vehicle's odometerUnit (×10). */
  odometer: number;
  /** Fuel quantity in millilitres. */
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

export const createFuelEntry: Command<CreateFuelEntryInput, VehicleFuelEntryRow> = {
  name: "createFuelEntry",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateFuelEntryInput): Promise<Result<VehicleFuelEntryRow>> {
    if (!input.vehicleId) return err({ code: "validation_error", message: "Missing vehicle id." });
    if (!input.occurredAt) return err({ code: "validation_error", message: "Occurred at is required." });
    if (input.fuelQuantityMl <= 0) {
      return err({ code: "validation_error", message: "Fuel quantity must be positive." });
    }
    if (input.odometer < 0) {
      return err({ code: "validation_error", message: "Odometer must be non-negative." });
    }
    try {
      const row = await createFuelEntryRow(ctx.supabase, ctx.userId, input);
      // Keep vehicle's current_odometer up to date if this entry is higher.
      await updateVehicleRowPatch(ctx.supabase, ctx.userId, input.vehicleId, {
        currentOdometer: input.odometer,
      }).catch(() => {
        // Non-fatal: odometer sync failure doesn't roll back the fuel entry.
      });
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't save the fuel entry. Try again." });
    }
  },
};

export interface UpdateFuelEntryInput extends Partial<Omit<CreateFuelEntryInput, "vehicleId">> {
  entryId: string;
  vehicleId: string;
}

export const updateFuelEntry: Command<UpdateFuelEntryInput, VehicleFuelEntryRow> = {
  name: "updateFuelEntry",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateFuelEntryInput): Promise<Result<VehicleFuelEntryRow>> {
    if (!input.entryId) return err({ code: "validation_error", message: "Missing entry id." });
    try {
      const { entryId, vehicleId: _vid, ...patch } = input;
      const row = await updateFuelEntryRow(ctx.supabase, ctx.userId, entryId, patch);
      return ok(row);
    } catch {
      return err({ code: "update_failed", message: "Couldn't update the fuel entry. Try again." });
    }
  },
};

export interface DeleteFuelEntryInput { entryId: string }

export const deleteFuelEntry: Command<DeleteFuelEntryInput, void> = {
  name: "deleteFuelEntry",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteFuelEntryInput): Promise<Result<void>> {
    if (!input.entryId) return err({ code: "validation_error", message: "Missing entry id." });
    try {
      await deleteFuelEntryRow(ctx.supabase, ctx.userId, input.entryId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete the fuel entry. Try again." });
    }
  },
};

// ============================================================
// Vehicle expenses
// ============================================================

export interface CreateVehicleExpenseInput {
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
}

export const createVehicleExpense: Command<CreateVehicleExpenseInput, VehicleExpenseRow> = {
  name: "createVehicleExpense",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateVehicleExpenseInput): Promise<Result<VehicleExpenseRow>> {
    if (!input.vehicleId) return err({ code: "validation_error", message: "Missing vehicle id." });
    if (input.amountMinor <= 0) {
      return err({ code: "validation_error", message: "Amount must be positive." });
    }
    try {
      const row = await createVehicleExpenseRow(ctx.supabase, ctx.userId, input);
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't save the expense. Try again." });
    }
  },
};

export interface DeleteVehicleExpenseInput { expenseId: string }

export const deleteVehicleExpense: Command<DeleteVehicleExpenseInput, void> = {
  name: "deleteVehicleExpense",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteVehicleExpenseInput): Promise<Result<void>> {
    if (!input.expenseId) return err({ code: "validation_error", message: "Missing expense id." });
    try {
      await deleteVehicleExpenseRow(ctx.supabase, ctx.userId, input.expenseId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete the expense. Try again." });
    }
  },
};

// ============================================================
// Maintenance records
// ============================================================

export interface CreateMaintenanceInput {
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

export const createMaintenanceRecord: Command<CreateMaintenanceInput, VehicleMaintenanceRow> = {
  name: "createMaintenanceRecord",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateMaintenanceInput): Promise<Result<VehicleMaintenanceRow>> {
    if (!input.vehicleId) return err({ code: "validation_error", message: "Missing vehicle id." });
    if (!input.title?.trim()) return err({ code: "validation_error", message: "Title is required." });
    try {
      const row = await createMaintenanceRow(ctx.supabase, ctx.userId, input);
      // Create reminder if next-due info present.
      if (input.nextDueDate ?? input.nextDueOdometer) {
        await upsertReminderForMaintenance(
          ctx.supabase,
          ctx.userId,
          input.vehicleId,
          row.id,
          input.title,
          input.nextDueDate ?? null,
          input.nextDueOdometer ?? null,
        ).catch(() => { /* non-fatal */ });
      }
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't save the maintenance record. Try again." });
    }
  },
};

export interface DeleteMaintenanceInput { recordId: string }

export const deleteMaintenanceRecord: Command<DeleteMaintenanceInput, void> = {
  name: "deleteMaintenanceRecord",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteMaintenanceInput): Promise<Result<void>> {
    if (!input.recordId) return err({ code: "validation_error", message: "Missing record id." });
    try {
      await deleteMaintenanceRow(ctx.supabase, ctx.userId, input.recordId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete the maintenance record. Try again." });
    }
  },
};

// ============================================================
// Documents
// ============================================================

export interface CreateVehicleDocumentInput {
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

export const createVehicleDocument: Command<CreateVehicleDocumentInput, VehicleDocumentRow> = {
  name: "createVehicleDocument",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateVehicleDocumentInput): Promise<Result<VehicleDocumentRow>> {
    if (!input.vehicleId) return err({ code: "validation_error", message: "Missing vehicle id." });
    if (!input.title?.trim()) return err({ code: "validation_error", message: "Title is required." });
    try {
      const row = await createVehicleDocumentRow(ctx.supabase, ctx.userId, input);
      // Create expiry reminders if expiryDate is set.
      if (input.expiryDate) {
        const reminderDays = input.reminderDaysBefore ?? [30, 7, 1];
        const expiryMs = Date.parse(input.expiryDate);
        if (!isNaN(expiryMs)) {
          const dueDates = reminderDays
            .map((days) => {
              const d = new Date(expiryMs - days * 86_400_000);
              return d.toISOString().slice(0, 10);
            })
            .filter((d) => d >= new Date().toISOString().slice(0, 10));
          if (dueDates.length > 0) {
            await upsertReminderForDocument(
              ctx.supabase,
              ctx.userId,
              input.vehicleId,
              row.id,
              input.title,
              dueDates,
            ).catch(() => { /* non-fatal */ });
          }
        }
      }
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't save the document. Try again." });
    }
  },
};

export interface DeleteVehicleDocumentInput { documentId: string }

export const deleteVehicleDocument: Command<DeleteVehicleDocumentInput, void> = {
  name: "deleteVehicleDocument",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteVehicleDocumentInput): Promise<Result<void>> {
    if (!input.documentId) return err({ code: "validation_error", message: "Missing document id." });
    try {
      await deleteVehicleDocumentRow(ctx.supabase, ctx.userId, input.documentId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't delete the document. Try again." });
    }
  },
};

// ============================================================
// Reminders
// ============================================================

export interface DismissReminderInput { reminderId: string }

export const dismissVehicleReminder: Command<DismissReminderInput, void> = {
  name: "dismissVehicleReminder",
  consequential: false,
  async execute(ctx: AuthContext, input: DismissReminderInput): Promise<Result<void>> {
    if (!input.reminderId) return err({ code: "validation_error", message: "Missing reminder id." });
    try {
      await dismissReminderRow(ctx.supabase, ctx.userId, input.reminderId);
      return ok(undefined);
    } catch {
      return err({ code: "dismiss_failed", message: "Couldn't dismiss the reminder. Try again." });
    }
  },
};

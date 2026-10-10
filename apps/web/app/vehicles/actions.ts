"use server";

import { revalidatePath } from "next/cache";
import {
  createVehicle,
  updateVehicle,
  deleteVehicle,
  createFuelEntry,
  updateFuelEntry,
  deleteFuelEntry,
  createVehicleExpense,
  deleteVehicleExpense,
  createMaintenanceRecord,
  deleteMaintenanceRecord,
  createVehicleDocument,
  deleteVehicleDocument,
  dismissVehicleReminder,
  createTransaction,
  getVehicle,
  getExistingImportGuids,
  type CreateVehicleInput,
  type UpdateVehicleInput,
  type CreateFuelEntryInput,
  type UpdateFuelEntryInput,
  type CreateVehicleExpenseInput,
  type CreateMaintenanceInput,
  type CreateVehicleDocumentInput,
  type AuthContext,
} from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function createVehicleAction(input: CreateVehicleInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await createVehicle.execute(ctx, input);
  if (result.ok) revalidatePath("/vehicles");
  return result;
}

export async function updateVehicleAction(input: UpdateVehicleInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await updateVehicle.execute(ctx, input);
  if (result.ok) {
    revalidatePath("/vehicles");
    revalidatePath(`/vehicles/${input.vehicleId}`);
  }
  return result;
}

export async function deleteVehicleAction(vehicleId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await deleteVehicle.execute(ctx, { vehicleId });
  if (result.ok) revalidatePath("/vehicles");
  return result;
}

export async function createFuelEntryAction(input: CreateFuelEntryInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await createFuelEntry.execute(ctx, input);
  if (result.ok) revalidatePath(`/vehicles/${input.vehicleId}`);
  return result;
}

export async function updateFuelEntryAction(input: UpdateFuelEntryInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await updateFuelEntry.execute(ctx, input);
  if (result.ok) revalidatePath(`/vehicles/${input.vehicleId}`);
  return result;
}

export async function deleteFuelEntryAction(vehicleId: string, entryId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await deleteFuelEntry.execute(ctx, { entryId });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}

export async function createVehicleExpenseAction(input: CreateVehicleExpenseInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await createVehicleExpense.execute(ctx, input);
  if (result.ok) revalidatePath(`/vehicles/${input.vehicleId}`);
  return result;
}

export async function deleteVehicleExpenseAction(vehicleId: string, expenseId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await deleteVehicleExpense.execute(ctx, { expenseId });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}

export async function createMaintenanceRecordAction(input: CreateMaintenanceInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await createMaintenanceRecord.execute(ctx, input);
  if (result.ok) revalidatePath(`/vehicles/${input.vehicleId}`);
  return result;
}

export async function deleteMaintenanceRecordAction(vehicleId: string, recordId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await deleteMaintenanceRecord.execute(ctx, { recordId });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}

export async function createVehicleDocumentAction(input: CreateVehicleDocumentInput) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await createVehicleDocument.execute(ctx, input);
  if (result.ok) revalidatePath(`/vehicles/${input.vehicleId}`);
  return result;
}

export async function deleteVehicleDocumentAction(vehicleId: string, documentId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await deleteVehicleDocument.execute(ctx, { documentId });
  if (result.ok) revalidatePath(`/vehicles/${vehicleId}`);
  return result;
}

export interface BulkImportFuelEntry {
  occurredAt: string;
  odometer: number;
  fuelQuantityMl: number;
  totalCostMinor: number | null;
  currency: string;
  fuelType: string;
  isFullTank: boolean;
  isMissed: boolean;
  importGuid: string;
  stationName?: string | null;
  notes?: string | null;
}

const MAX_IMPORT_BATCH = 500;

export async function bulkImportFuelEntriesAction(
  vehicleId: string,
  entries: BulkImportFuelEntry[],
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  if (entries.length > MAX_IMPORT_BATCH) {
    return { ok: false as const, error: { code: "batch_too_large", message: `Import is limited to ${MAX_IMPORT_BATCH} rows per batch.` } };
  }

  const vehicle = await getVehicle(ctx, vehicleId);
  if (!vehicle) return { ok: false as const, error: { code: "not_found", message: "Vehicle not found." } };

  const results = { imported: 0, skipped: 0, errors: 0 };
  for (const e of entries) {
    const result = await createFuelEntry.execute(ctx, {
      vehicleId,
      occurredAt: e.occurredAt,
      odometer: e.odometer,
      fuelQuantityMl: e.fuelQuantityMl,
      totalCostMinor: e.totalCostMinor,
      currency: e.currency,
      fuelType: e.fuelType,
      isFullTank: e.isFullTank,
      isMissed: e.isMissed,
      importSource: "fuelio",
      importGuid: e.importGuid,
    });
    if (result.ok) {
      results.imported++;
    } else if (result.error.code === "create_failed") {
      // Likely duplicate import_guid constraint — skip silently.
      results.skipped++;
    } else {
      results.errors++;
    }
  }
  revalidatePath(`/vehicles/${vehicleId}`);
  return { ok: true as const, value: results };
}

export async function dismissVehicleReminderAction(reminderId: string) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  const result = await dismissVehicleReminder.execute(ctx, { reminderId });
  if (result.ok) revalidatePath("/vehicles");
  return result;
}

// ============================================================
// Transaction integration
// ============================================================
// These actions follow the canonical pattern: fuel entries and vehicle
// expenses are separate domain records, but they can be linked to a
// canonical transaction so the amount appears in the user's ledger.
// Invariants:
//   - Never create a second transaction for an already-linked entry.
//   - Editing a fuel entry quantity never creates a new transaction.
//   - Deleting an entry unlinks its transaction (DB ON DELETE SET NULL)
//     but does not delete the transaction itself.

export interface TransactionLinkDetails {
  accountId: string;
  categoryId: string;
  amountMinor: number;
  description?: string | null;
  merchant?: string | null;
  occurredAt: string;
}

export async function createFuelEntryAndTransactionAction(
  input: CreateFuelEntryInput,
  txn: TransactionLinkDetails,
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  // Create transaction first so the entry's transaction_id can be set in one insert.
  const txnResult = await createTransaction.execute(ctx, {
    kind: "expense",
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    amountMinor: txn.amountMinor,
    description: txn.description ?? undefined,
    merchant: txn.merchant ?? undefined,
    occurredAt: txn.occurredAt,
  });
  if (!txnResult.ok) return txnResult;

  const entryResult = await createFuelEntry.execute(ctx, {
    ...input,
    transactionId: txnResult.value.id,
  });
  if (!entryResult.ok) {
    // Roll back the orphaned transaction so no ghost expense is left behind.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("transactions")
      .delete()
      .eq("id", txnResult.value.id)
      .eq("user_id", ctx.userId);
    return entryResult;
  }

  // Set the reverse FK: transaction -> fuel entry. Using supabase as any
  // because UpdateTransactionInput does not expose vehicle FK fields (they
  // are an infra concern, not a financial mutation).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: reverseFkError } = await (ctx.supabase as any).from("transactions")
    .update({ vehicle_fuel_entry_id: entryResult.value.id })
    .eq("id", txnResult.value.id)
    .eq("user_id", ctx.userId);

  if (reverseFkError) {
    // Roll back both the entry and the transaction to leave the DB clean.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("vehicle_fuel_entries")
      .delete()
      .eq("id", entryResult.value.id)
      .eq("user_id", ctx.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("transactions")
      .delete()
      .eq("id", txnResult.value.id)
      .eq("user_id", ctx.userId);
    return { ok: false as const, error: { code: "link_failed", message: "Could not link the fuel entry to the transaction. Please try again." } };
  }

  revalidatePath(`/vehicles/${input.vehicleId}`);
  revalidatePath("/cash-flow");
  return { ok: true as const, value: { entry: entryResult.value, transaction: txnResult.value } };
}

export async function createVehicleExpenseAndTransactionAction(
  input: CreateVehicleExpenseInput,
  txn: TransactionLinkDetails,
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  const txnResult = await createTransaction.execute(ctx, {
    kind: "expense",
    accountId: txn.accountId,
    categoryId: txn.categoryId,
    amountMinor: txn.amountMinor,
    description: txn.description ?? undefined,
    merchant: txn.merchant ?? undefined,
    occurredAt: txn.occurredAt,
  });
  if (!txnResult.ok) return txnResult;

  const expenseResult = await createVehicleExpense.execute(ctx, {
    ...input,
    transactionId: txnResult.value.id,
  });
  if (!expenseResult.ok) {
    // Roll back the orphaned transaction so no ghost expense is left behind.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("transactions")
      .delete()
      .eq("id", txnResult.value.id)
      .eq("user_id", ctx.userId);
    return expenseResult;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: reverseFkError } = await (ctx.supabase as any).from("transactions")
    .update({ vehicle_expense_id: expenseResult.value.id })
    .eq("id", txnResult.value.id)
    .eq("user_id", ctx.userId);

  if (reverseFkError) {
    // Roll back both the expense and the transaction to leave the DB clean.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("vehicle_expenses")
      .delete()
      .eq("id", expenseResult.value.id)
      .eq("user_id", ctx.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.supabase as any).from("transactions")
      .delete()
      .eq("id", txnResult.value.id)
      .eq("user_id", ctx.userId);
    return { ok: false as const, error: { code: "link_failed", message: "Could not link the expense to the transaction. Please try again." } };
  }

  revalidatePath(`/vehicles/${input.vehicleId}`);
  revalidatePath("/cash-flow");
  return { ok: true as const, value: { expense: expenseResult.value, transaction: txnResult.value } };
}

export async function linkFuelEntryToTransactionAction(
  vehicleId: string,
  fuelEntryId: string,
  transactionId: string,
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.supabase as any;

  // Verify both records belong to this user before linking.
  const { data: entry } = await db.from("vehicle_fuel_entries")
    .select("id, transaction_id")
    .eq("id", fuelEntryId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!entry) return { ok: false as const, error: { code: "not_found", message: "Fuel entry not found." } };

  if (entry.transaction_id) {
    return { ok: false as const, error: { code: "already_linked", message: "This fuel entry is already linked to a transaction." } };
  }

  const { data: txn } = await db.from("transactions")
    .select("id, vehicle_fuel_entry_id")
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!txn) return { ok: false as const, error: { code: "not_found", message: "Transaction not found." } };

  if (txn.vehicle_fuel_entry_id) {
    return { ok: false as const, error: { code: "already_linked", message: "This transaction is already linked to a fuel entry." } };
  }

  // Atomic guard: only update if still unlinked (prevents TOCTOU race).
  const { count: entryUpdated } = await db.from("vehicle_fuel_entries")
    .update({ transaction_id: transactionId })
    .eq("id", fuelEntryId)
    .eq("user_id", ctx.userId)
    .is("transaction_id", null)
    .select("id", { count: "exact", head: true });

  if (!entryUpdated) {
    return { ok: false as const, error: { code: "already_linked", message: "Fuel entry was linked by a concurrent request." } };
  }

  const { count: txnUpdated } = await db.from("transactions")
    .update({ vehicle_fuel_entry_id: fuelEntryId })
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .is("vehicle_fuel_entry_id", null)
    .select("id", { count: "exact", head: true });

  if (!txnUpdated) {
    // Roll back the entry update so the state remains consistent.
    await db.from("vehicle_fuel_entries")
      .update({ transaction_id: null })
      .eq("id", fuelEntryId)
      .eq("user_id", ctx.userId);
    return { ok: false as const, error: { code: "already_linked", message: "Transaction was linked by a concurrent request." } };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath("/cash-flow");
  return { ok: true as const, value: { fuelEntryId, transactionId } };
}

export async function linkVehicleExpenseToTransactionAction(
  vehicleId: string,
  expenseId: string,
  transactionId: string,
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = ctx.supabase as any;

  const { data: expense } = await db.from("vehicle_expenses")
    .select("id, transaction_id")
    .eq("id", expenseId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!expense) return { ok: false as const, error: { code: "not_found", message: "Expense not found." } };

  if (expense.transaction_id) {
    return { ok: false as const, error: { code: "already_linked", message: "This expense is already linked to a transaction." } };
  }

  const { data: txn } = await db.from("transactions")
    .select("id, vehicle_expense_id")
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!txn) return { ok: false as const, error: { code: "not_found", message: "Transaction not found." } };

  if (txn.vehicle_expense_id) {
    return { ok: false as const, error: { code: "already_linked", message: "This transaction is already linked to an expense." } };
  }

  // Atomic guard: only update if still unlinked (prevents TOCTOU race).
  const { count: expenseUpdated } = await db.from("vehicle_expenses")
    .update({ transaction_id: transactionId })
    .eq("id", expenseId)
    .eq("user_id", ctx.userId)
    .is("transaction_id", null)
    .select("id", { count: "exact", head: true });

  if (!expenseUpdated) {
    return { ok: false as const, error: { code: "already_linked", message: "Expense was linked by a concurrent request." } };
  }

  const { count: txnUpdated } = await db.from("transactions")
    .update({ vehicle_expense_id: expenseId })
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .is("vehicle_expense_id", null)
    .select("id", { count: "exact", head: true });

  if (!txnUpdated) {
    await db.from("vehicle_expenses")
      .update({ transaction_id: null })
      .eq("id", expenseId)
      .eq("user_id", ctx.userId);
    return { ok: false as const, error: { code: "already_linked", message: "Transaction was linked by a concurrent request." } };
  }

  revalidatePath(`/vehicles/${vehicleId}`);
  revalidatePath("/cash-flow");
  return { ok: true as const, value: { expenseId, transactionId } };
}

export async function bulkImportGenericFuelEntriesAction(
  vehicleId: string,
  entries: BulkImportFuelEntry[],
) {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };

  if (entries.length > MAX_IMPORT_BATCH) {
    return { ok: false as const, error: { code: "batch_too_large", message: `Import is limited to ${MAX_IMPORT_BATCH} rows per batch.` } };
  }

  const vehicle = await getVehicle(ctx, vehicleId);
  if (!vehicle) return { ok: false as const, error: { code: "not_found", message: "Vehicle not found." } };

  const results = { imported: 0, skipped: 0, errors: 0 };
  const possibleDuplicates: Array<{ occurredAt: string; odometer: number; fuelQuantityMl: number }> = [];
  for (const e of entries) {
    const result = await createFuelEntry.execute(ctx, {
      vehicleId,
      occurredAt: e.occurredAt,
      odometer: e.odometer,
      fuelQuantityMl: e.fuelQuantityMl,
      totalCostMinor: e.totalCostMinor,
      currency: e.currency,
      fuelType: e.fuelType,
      isFullTank: e.isFullTank,
      isMissed: e.isMissed,
      importSource: "generic_csv",
      importGuid: e.importGuid,
    });
    if (result.ok) {
      results.imported++;
    } else if (result.error.code === "create_failed") {
      results.skipped++;
      possibleDuplicates.push({ occurredAt: e.occurredAt, odometer: e.odometer, fuelQuantityMl: e.fuelQuantityMl });
    } else {
      results.errors++;
    }
  }
  revalidatePath(`/vehicles/${vehicleId}`);
  return { ok: true as const, value: { ...results, possibleDuplicates } };
}

export async function checkImportDuplicatesAction(
  vehicleId: string,
  source: string,
  guids: string[],
): Promise<{ ok: true; value: string[] } | { ok: false; error: { code: string; message: string } }> {
  const ctx = await getAuthContext();
  if (!ctx) return { ok: false as const, error: { code: "unauthenticated", message: "Not signed in." } };
  try {
    const existing = await getExistingImportGuids(ctx, vehicleId, source, guids);
    return { ok: true as const, value: existing };
  } catch (e) {
    return { ok: false as const, error: { code: "query_failed", message: e instanceof Error ? e.message : "Failed to check duplicates." } };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import {
  createBill,
  deleteBill,
  getBill,
  listAccounts,
  listBillPredictions,
  listCategories,
  markPaid,
  matchTransaction,
  restoreBill,
  undoPaid,
  updateBill,
  type AuthContext,
} from "@spencare/domain-application";
import type { CreateBillInput, MarkPaidInput, MatchTransactionInput, UpdateBillInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every Bill action resolves AuthContext from the verified session -- never a client-supplied user id, same pattern as every prior phase. */
async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function listBillPredictionsAction() {
  const ctx = await requireAuthContext();
  return listBillPredictions(ctx);
}

/** Fetches one bill definition on demand -- used by Edit/Delete, which need the full definition (amount/category/detection_source) that the predictions list's joined view deliberately doesn't carry. */
export async function getBillAction(billId: string) {
  const ctx = await requireAuthContext();
  return getBill(ctx, billId);
}

export async function listAccountsAction() {
  const ctx = await requireAuthContext();
  return listAccounts(ctx);
}

export async function listCategoriesAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

export async function createBillAction(input: CreateBillInput) {
  const ctx = await requireAuthContext();
  const result = await createBill.execute(ctx, input);
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

export async function updateBillAction(billId: string, input: UpdateBillInput) {
  const ctx = await requireAuthContext();
  const result = await updateBill.execute(ctx, { billId, ...input });
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

export async function deleteBillAction(billId: string) {
  const ctx = await requireAuthContext();
  const result = await deleteBill.execute(ctx, { billId });
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

export async function restoreBillAction(billId: string) {
  const ctx = await requireAuthContext();
  const result = await restoreBill.execute(ctx, { billId });
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

export async function markPaidAction(input: MarkPaidInput) {
  const ctx = await requireAuthContext();
  const result = await markPaid.execute(ctx, input);
  if (result.ok) {
    revalidatePath("/cash-flow/bills");
    revalidatePath("/cash-flow");
  }
  return result;
}

export async function undoPaidAction(predictionId: string) {
  const ctx = await requireAuthContext();
  const result = await undoPaid.execute(ctx, { predictionId });
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

/** No dedicated UI trigger this phase (Phase 12 locked decision) -- exposed here only so a future caller (e.g. an import-confirmation flow) has a ready server action, matching the command's own standalone-capability status. */
export async function matchTransactionAction(input: MatchTransactionInput) {
  const ctx = await requireAuthContext();
  const result = await matchTransaction.execute(ctx, input);
  if (result.ok) revalidatePath("/cash-flow/bills");
  return result;
}

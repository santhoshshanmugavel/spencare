"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  createTransaction,
  deleteTransaction,
  listCategories,
  listTransactions,
  transfer,
  updateTransaction,
  type AuthContext,
} from "@spencare/domain-application";
import type { CreateCategoryInput, CreateTransactionInput, UpdateTransactionInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every transaction action resolves AuthContext from the verified session -- never a client-supplied user id (system model §22, api-architecture.md §1). */
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

export async function listTransactionsAction() {
  const ctx = await requireAuthContext();
  return listTransactions(ctx);
}

export async function listCategoriesAction() {
  const ctx = await requireAuthContext();
  return listCategories(ctx);
}

export async function createTransactionAction(input: CreateTransactionInput) {
  const ctx = await requireAuthContext();
  const result = await createTransaction.execute(ctx, input);
  if (result.ok) {
    revalidatePath("/cash-flow/transactions");
    revalidatePath("/cash-flow");
  }
  return result;
}

export async function transferAction(input: {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  description?: string;
  occurredAt: string;
}) {
  const ctx = await requireAuthContext();
  const result = await transfer.execute(ctx, input);
  if (result.ok) {
    revalidatePath("/cash-flow/transactions");
    revalidatePath("/cash-flow");
  }
  return result;
}

export async function updateTransactionAction(transactionId: string, input: UpdateTransactionInput) {
  const ctx = await requireAuthContext();
  const result = await updateTransaction.execute(ctx, { transactionId, ...input });
  if (result.ok) {
    revalidatePath("/cash-flow/transactions");
    revalidatePath("/cash-flow");
  }
  return result;
}

export async function deleteTransactionAction(transactionId: string) {
  const ctx = await requireAuthContext();
  const result = await deleteTransaction.execute(ctx, { transactionId });
  if (result.ok) {
    revalidatePath("/cash-flow/transactions");
    revalidatePath("/cash-flow");
  }
  return result;
}

export async function createCategoryAction(input: CreateCategoryInput) {
  const ctx = await requireAuthContext();
  const result = await createCategory.execute(ctx, input);
  if (result.ok) {
    revalidatePath("/cash-flow/transactions");
  }
  return result;
}

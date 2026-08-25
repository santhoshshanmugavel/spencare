"use server";

import { revalidatePath } from "next/cache";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  updateAccount,
  type AuthContext,
} from "@spencare/domain-application";
import type { CreateAccountInput, UpdateAccountInput } from "@spencare/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/** Every account action resolves AuthContext from the verified session -- never a client-supplied user id (system model §22). */
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

export async function listAccountsAction() {
  const ctx = await requireAuthContext();
  return listAccounts(ctx);
}

export async function createAccountAction(input: CreateAccountInput) {
  const ctx = await requireAuthContext();
  const result = await createAccount.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function updateAccountAction(accountId: string, input: UpdateAccountInput) {
  const ctx = await requireAuthContext();
  const result = await updateAccount.execute(ctx, { accountId, ...input });
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function archiveAccountAction(accountId: string) {
  const ctx = await requireAuthContext();
  const result = await archiveAccount.execute(ctx, { accountId });
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

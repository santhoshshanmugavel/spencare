import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Accounts use the CALLER'S OWN RLS-scoped client throughout -- `accounts`
 * has no revoked columns, so RLS's "own only" policy is the live
 * enforcement layer, with the explicit `.eq('user_id', userId)` below as
 * the required application-layer check alongside it (security-
 * architecture.md §2). Archiving is the one exception: it calls the
 * `archive_account` SECURITY DEFINER RPC so the audit_log write can happen
 * atomically with the mutation (audit_log denies client insert entirely).
 */

export interface AccountRow {
  id: string;
  user_id: string;
  type: "bank" | "cash" | "credit_card" | "investment";
  name: string;
  currency: string;
  balance_minor: number;
  credit_limit_minor: number | null;
  credit_used_minor: number | null;
  market_value_minor: number | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

const ACCOUNT_COLUMNS =
  "id, user_id, type, name, currency, balance_minor, credit_limit_minor, credit_used_minor, market_value_minor, is_archived, created_at, updated_at";

export interface CreateAccountPatch {
  type: "bank" | "cash" | "credit_card" | "investment";
  name: string;
  currency: string;
  balanceMinor?: number;
  creditLimitMinor?: number;
  creditUsedMinor?: number;
  marketValueMinor?: number;
}

export async function createAccount(
  client: TypedSupabaseClient,
  userId: string,
  patch: CreateAccountPatch,
): Promise<AccountRow> {
  const { data, error } = await client
    .from("accounts")
    .insert({
      user_id: userId,
      type: patch.type,
      name: patch.name,
      currency: patch.currency,
      balance_minor: patch.balanceMinor ?? 0,
      credit_limit_minor: patch.creditLimitMinor ?? null,
      credit_used_minor: patch.creditUsedMinor ?? null,
      market_value_minor: patch.marketValueMinor ?? null,
    })
    .select(ACCOUNT_COLUMNS)
    .single();
  if (error) throw error;
  return data as AccountRow;
}

export interface UpdateAccountPatch {
  name?: string;
  balanceMinor?: number;
  creditLimitMinor?: number;
  creditUsedMinor?: number;
  marketValueMinor?: number;
}

export async function updateAccount(
  client: TypedSupabaseClient,
  userId: string,
  accountId: string,
  patch: UpdateAccountPatch,
): Promise<AccountRow> {
  const { data, error } = await client
    .from("accounts")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.balanceMinor !== undefined ? { balance_minor: patch.balanceMinor } : {}),
      ...(patch.creditLimitMinor !== undefined ? { credit_limit_minor: patch.creditLimitMinor } : {}),
      ...(patch.creditUsedMinor !== undefined ? { credit_used_minor: patch.creditUsedMinor } : {}),
      ...(patch.marketValueMinor !== undefined ? { market_value_minor: patch.marketValueMinor } : {}),
    })
    .eq("id", accountId)
    .eq("user_id", userId)
    .select(ACCOUNT_COLUMNS)
    .single();
  if (error) throw error;
  return data as AccountRow;
}

export async function listAccounts(
  client: TypedSupabaseClient,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  let query = client.from("accounts").select(ACCOUNT_COLUMNS).eq("user_id", userId);
  if (!options.includeArchived) query = query.eq("is_archived", false);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccountRow[];
}

export async function getAccount(
  client: TypedSupabaseClient,
  userId: string,
  accountId: string,
): Promise<AccountRow | null> {
  const { data, error } = await client
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as AccountRow | null;
}

/** Calls the archive_account SECURITY DEFINER RPC -- atomic mutation + audit_log write. */
export async function callArchiveAccount(
  client: TypedSupabaseClient,
  userId: string,
  accountId: string,
): Promise<AccountRow> {
  const { data, error } = await client.rpc("archive_account", {
    p_user_id: userId,
    p_account_id: accountId,
    p_actor: "web",
  });
  if (error) throw error;
  return data as AccountRow;
}

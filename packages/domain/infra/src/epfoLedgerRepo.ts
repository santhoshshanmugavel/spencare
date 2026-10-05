/**
 * EPFO ledger repository (Phase 2: read-only).
 *
 * Writes to `epfo_ledger_entries` happen only through Phase 4+ SECURITY
 * DEFINER RPCs (see migration 20261005000001's note on the restrictive
 * RLS "no insert for authenticated" policy). This file only reads --
 * sufficient for Phase 2's `getNetWorth` + Phase 3 UI preview + Spensa
 * context.
 *
 * TYPING NOTE: the generated database.types.ts was not regenerated as
 * part of this migration (no live Supabase CLI invocation in this
 * session). The `.from("epfo_ledger_entries")` call therefore escapes
 * through a cast; the row shape is enforced here by the mapping
 * function that returns a typed `EpfoLedgerEntry`. Phase 4 should run
 * `supabase gen types typescript ...` to replace the cast with real
 * types.
 */

import type { EpfoLedgerEntry } from "@spencare/domain-core";
import type { TypedSupabaseClient } from "./supabaseClients.js";

interface RawEpfoLedgerRow {
  id: string;
  account_id: string;
  employment_id: string | null;
  entry_type: EpfoLedgerEntry["entryType"];
  amount_minor: number;
  currency: string;
  occurred_at: string;
  source: string;
  description: string | null;
  import_batch_id: string | null;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  created_by: string;
}

function toEntry(row: RawEpfoLedgerRow): EpfoLedgerEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    employmentId: row.employment_id,
    entryType: row.entry_type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredAt: row.occurred_at,
    source: row.source,
    description: row.description,
    importBatchId: row.import_batch_id,
    externalReference: row.external_reference,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const EPFO_LEDGER_COLUMNS =
  "id, account_id, employment_id, entry_type, amount_minor, currency, occurred_at, source, description, import_batch_id, external_reference, metadata, created_at, created_by";

export interface ListEpfoLedgerFilter {
  accountId?: string;
  entryType?: EpfoLedgerEntry["entryType"];
  limit?: number;
}

export async function listEpfoLedgerEntries(
  client: TypedSupabaseClient,
  userId: string,
  filter: ListEpfoLedgerFilter = {},
): Promise<EpfoLedgerEntry[]> {
  // See TYPING NOTE at top -- cast is intentional and localized.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (client as any)
    .from("epfo_ledger_entries")
    .select(EPFO_LEDGER_COLUMNS)
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });
  if (filter.accountId) q = q.eq("account_id", filter.accountId);
  if (filter.entryType) q = q.eq("entry_type", filter.entryType);
  if (filter.limit !== undefined) q = q.limit(filter.limit);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as RawEpfoLedgerRow[];
  return rows.map(toEntry);
}

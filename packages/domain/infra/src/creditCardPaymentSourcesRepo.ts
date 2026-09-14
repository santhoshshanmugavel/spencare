import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Credit Card Payment Sources repository.
 *
 * A payment source is a CONFIGURATION RELATIONSHIP: it tells the Safe-to-Spend
 * engine to reserve the card's outstanding balance (credit_used_minor) from the
 * linked bank/cash account. No money moves. The reserve is derived, not stored.
 *
 * Invariants enforced here:
 * - credit_card_account_id is unique (one payment account per card)
 * - user_id ownership is always asserted alongside RLS
 * - payment_account_id must be a bank/cash account (validated in application layer)
 */

export interface CreditCardPaymentSourceRow {
  id: string;
  user_id: string;
  credit_card_account_id: string;
  payment_account_id: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, user_id, credit_card_account_id, payment_account_id, created_at, updated_at";

/** Lists all payment-source relationships for the user. */
export async function listCreditCardPaymentSources(
  client: TypedSupabaseClient,
  userId: string,
): Promise<CreditCardPaymentSourceRow[]> {
  const { data, error } = await client
    .from("credit_card_payment_sources")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CreditCardPaymentSourceRow[];
}

/** Returns the payment source for a single credit card, or null if unset. */
export async function getCreditCardPaymentSource(
  client: TypedSupabaseClient,
  userId: string,
  creditCardAccountId: string,
): Promise<CreditCardPaymentSourceRow | null> {
  const { data, error } = await client
    .from("credit_card_payment_sources")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("credit_card_account_id", creditCardAccountId)
    .maybeSingle();
  if (error) throw error;
  return data as CreditCardPaymentSourceRow | null;
}

/**
 * Creates or replaces the payment source for a credit card (upsert on
 * the unique credit_card_account_id constraint).
 *
 * The application layer must validate that:
 * - credit_card_account_id is a credit_card account owned by userId
 * - payment_account_id is a bank or cash account owned by userId
 * - the two are not the same account
 */
export async function upsertCreditCardPaymentSource(
  client: TypedSupabaseClient,
  userId: string,
  creditCardAccountId: string,
  paymentAccountId: string,
): Promise<CreditCardPaymentSourceRow> {
  const { data, error } = await client
    .from("credit_card_payment_sources")
    .upsert(
      {
        user_id: userId,
        credit_card_account_id: creditCardAccountId,
        payment_account_id: paymentAccountId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "credit_card_account_id" },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as CreditCardPaymentSourceRow;
}

/** Removes the payment source for a credit card (idempotent — no error if not found). */
export async function deleteCreditCardPaymentSource(
  client: TypedSupabaseClient,
  userId: string,
  creditCardAccountId: string,
): Promise<void> {
  const { error } = await client
    .from("credit_card_payment_sources")
    .delete()
    .eq("user_id", userId)
    .eq("credit_card_account_id", creditCardAccountId);
  if (error) throw error;
}

/**
 * Returns a map: paymentAccountId → total reserved minor units.
 *
 * For each active credit card that has a payment source, the reserved amount
 * equals the card's current credit_used_minor (outstanding balance). This is
 * the canonical derivation — never a manually stored reserve amount.
 *
 * Accepts pre-loaded accounts and payment sources to avoid N+1 queries.
 * Callers (getSafeToSpend) load both in one batch and pass them here.
 */
export interface CardPaymentReserveState {
  /** Total reserved minor units across all linked credit cards, globally. */
  totalMinor: number;
  /**
   * Per bank/cash account: total reserved for card payments.
   * Key: payment_account_id. Value: sum of credit_used_minor for all
   * credit cards pointing at that account.
   */
  perPaymentAccount: Record<string, number>;
  /**
   * Per credit card: the reserve detail.
   */
  perCard: CardReserveDetail[];
}

export interface CardReserveDetail {
  creditCardAccountId: string;
  creditCardName: string;
  outstandingMinor: number;
  reservedMinor: number;
  paymentAccountId: string;
  paymentAccountName: string;
}

export interface AccountLike {
  id: string;
  name: string;
  type: string;
  credit_used_minor: number | null;
}

/**
 * Derives the card payment reserve state from already-loaded accounts and
 * payment-source rows. Pure computation — no I/O.
 *
 * Only credit cards whose credit_used_minor > 0 contribute a meaningful reserve.
 * Cards without a payment source contribute zero (opt-in behavior per spec §53).
 */
export function deriveCardPaymentReserveState(
  accounts: AccountLike[],
  paymentSources: CreditCardPaymentSourceRow[],
): CardPaymentReserveState {
  const accountById = new Map<string, AccountLike>(accounts.map((a) => [a.id, a]));
  const perPaymentAccount: Record<string, number> = {};
  const perCard: CardReserveDetail[] = [];
  let totalMinor = 0;

  for (const src of paymentSources) {
    const card = accountById.get(src.credit_card_account_id);
    const paymentAccount = accountById.get(src.payment_account_id);
    if (!card || card.type !== "credit_card") continue;
    if (!paymentAccount) continue;

    const outstandingMinor = card.credit_used_minor ?? 0;
    const reservedMinor = Math.max(0, outstandingMinor);

    totalMinor += reservedMinor;
    perPaymentAccount[src.payment_account_id] = (perPaymentAccount[src.payment_account_id] ?? 0) + reservedMinor;
    perCard.push({
      creditCardAccountId: src.credit_card_account_id,
      creditCardName: card.name,
      outstandingMinor,
      reservedMinor,
      paymentAccountId: src.payment_account_id,
      paymentAccountName: paymentAccount.name,
    });
  }

  return { totalMinor, perPaymentAccount, perCard };
}

import {
  listAccounts as listAccountsRow,
  listCreditCardPaymentSources,
  upsertCreditCardPaymentSource,
  deleteCreditCardPaymentSource,
  type CreditCardPaymentSourceRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * Sets (or replaces) the bank/cash account that will "fund" a credit card's
 * outstanding balance in the Safe-to-Spend reserve calculation.
 *
 * SAFETY INVARIANTS enforced here (not at the Supabase layer):
 * - creditCardAccountId must be a credit_card account owned by the user
 * - paymentAccountId must be a bank or cash account owned by the user
 * - the two must not be the same account
 *
 * This command DOES NOT move money. It only stores a configuration
 * relationship that the Safe-to-Spend engine uses to derive a logical reserve.
 */
export interface SetCardPaymentSourceInput {
  creditCardAccountId: string;
  paymentAccountId: string;
}

export const setCardPaymentSource: Command<SetCardPaymentSourceInput, CreditCardPaymentSourceRow> = {
  name: "setCardPaymentSource",
  consequential: false,
  async execute(ctx: AuthContext, input: SetCardPaymentSourceInput): Promise<Result<CreditCardPaymentSourceRow>> {
    if (input.creditCardAccountId === input.paymentAccountId) {
      return err({ code: "validation_error", message: "A credit card cannot pay itself." });
    }

    const accounts = await listAccountsRow(ctx.supabase, ctx.userId, {});
    const cardAccount = accounts.find((a) => a.id === input.creditCardAccountId);
    const paymentAccount = accounts.find((a) => a.id === input.paymentAccountId);

    if (!cardAccount || cardAccount.type !== "credit_card") {
      return err({ code: "not_found", message: "Credit card account not found." });
    }
    if (!paymentAccount || (paymentAccount.type !== "bank" && paymentAccount.type !== "cash")) {
      return err({ code: "validation_error", message: "Payment account must be a bank or cash account." });
    }

    try {
      const row = await upsertCreditCardPaymentSource(
        ctx.supabase,
        ctx.userId,
        input.creditCardAccountId,
        input.paymentAccountId,
      );
      return ok(row);
    } catch {
      return err({ code: "upsert_failed", message: "Couldn't save the payment source. Try again." });
    }
  },
};

export interface RemoveCardPaymentSourceInput {
  creditCardAccountId: string;
}

export const removeCardPaymentSource: Command<RemoveCardPaymentSourceInput, void> = {
  name: "removeCardPaymentSource",
  consequential: false,
  async execute(ctx: AuthContext, input: RemoveCardPaymentSourceInput): Promise<Result<void>> {
    try {
      await deleteCreditCardPaymentSource(ctx.supabase, ctx.userId, input.creditCardAccountId);
      return ok(undefined);
    } catch {
      return err({ code: "delete_failed", message: "Couldn't remove the payment source. Try again." });
    }
  },
};

export async function listCardPaymentSources(ctx: AuthContext): Promise<CreditCardPaymentSourceRow[]> {
  return listCreditCardPaymentSources(ctx.supabase, ctx.userId);
}

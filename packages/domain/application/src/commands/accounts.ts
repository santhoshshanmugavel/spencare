import {
  createAccountSchema,
  updateAccountSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "@spencare/validation";
import {
  callArchiveAccount,
  createAccount as createAccountRow,
  getAccount as getAccountRow,
  updateAccount as updateAccountRow,
  type AccountRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

/**
 * Exactly the three commands domain-architecture.md §3 lists --
 * createAccount, updateAccount, archiveAccount. No deleteAccount, no
 * restoreAccount (not in the approved list -- Phase 7 §5: "do not invent
 * commands simply because they are common").
 */

export const createAccount: Command<CreateAccountInput, AccountRow> = {
  name: "createAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateAccountInput): Promise<Result<AccountRow>> {
    const parsed = createAccountSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid account details.",
      });
    }
    const data = parsed.data;
    try {
      const row = await createAccountRow(ctx.supabase, ctx.userId, {
        type: data.type,
        name: data.name,
        currency: data.currency,
        ...(data.type === "bank" || data.type === "cash" ? { balanceMinor: data.balanceMinor } : {}),
        ...(data.type === "credit_card"
          ? { creditLimitMinor: data.creditLimitMinor, creditUsedMinor: data.creditUsedMinor }
          : {}),
        ...(data.type === "investment" ? { marketValueMinor: data.marketValueMinor } : {}),
      });
      return ok(row);
    } catch {
      return err({ code: "create_failed", message: "Couldn't create the account. Try again." });
    }
  },
};

export interface UpdateAccountCommandInput extends UpdateAccountInput {
  accountId: string;
}

export const updateAccount: Command<UpdateAccountCommandInput, AccountRow> = {
  name: "updateAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateAccountCommandInput): Promise<Result<AccountRow>> {
    const { accountId, ...rest } = input;
    if (!accountId) {
      return err({ code: "validation_error", message: "Missing account id." });
    }
    const parsed = updateAccountSchema.safeParse(rest);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid account details.",
      });
    }
    try {
      const row = await updateAccountRow(ctx.supabase, ctx.userId, accountId, parsed.data);
      return ok(row);
    } catch {
      return err({ code: "update_failed", message: "Couldn't save your changes. Try again." });
    }
  },
};

export interface ArchiveAccountInput {
  accountId: string;
}

/**
 * Non-consequential per api-architecture.md §2's own classification
 * ("archiveAccount (non-destructive metadata)") -- one round-trip, no
 * server-side pending_confirmations row. The CLIENT still renders a
 * confirmation card before ever calling this (confirmation-ui-
 * specification.md §5 lists "Account create/edit/delete" as a
 * ConsequentialActionPreview use case) -- see the reconnaissance note on
 * this exact tension between the two architecture documents.
 */
export const archiveAccount: Command<ArchiveAccountInput, AccountRow> = {
  name: "archiveAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: ArchiveAccountInput): Promise<Result<AccountRow>> {
    if (!input.accountId) {
      return err({ code: "validation_error", message: "Missing account id." });
    }
    // Re-validate ownership/existence explicitly before calling the RPC --
    // defense in depth alongside the RPC's own internal re-check
    // (security-architecture.md §2), and lets us return a clean
    // "not_found" rather than a raw Postgres exception for the common case
    // of a stale/already-gone account id.
    const existing = await getAccountRow(ctx.supabase, ctx.userId, input.accountId);
    if (!existing) {
      return err({ code: "not_found", message: "That account no longer exists." });
    }
    if (existing.is_archived) {
      return ok(existing); // idempotent: already archived is a success, not an error
    }
    try {
      const row = await callArchiveAccount(ctx.supabase, ctx.userId, input.accountId);
      return ok(row);
    } catch {
      return err({ code: "archive_failed", message: "Couldn't archive the account. Try again." });
    }
  },
};

/**
 * EPFO Phase 3 commands.
 *
 * Each command: validates with Zod, dispatches to the SECURITY DEFINER
 * RPC in @spencare/domain-infra (which does the audit write + locking),
 * returns a `Result<T>`. UI code never writes to EPFO tables directly;
 * every mutation flows through here.
 */

import {
  createEpfoAccountSchema,
  addEpfoEmploymentSchema,
  endEpfoEmploymentSchema,
  upsertEpfoContributionProfileSchema,
  recordEpfoContributionSchema,
  correctEpfoBalanceSchema,
  type CreateEpfoAccountInput,
  type AddEpfoEmploymentInput,
  type EndEpfoEmploymentInput,
  type UpsertEpfoContributionProfileInput,
  type RecordEpfoContributionInput,
  type CorrectEpfoBalanceInput,
} from "@spencare/validation";
import {
  callCreateEpfoAccount,
  callAddEpfoEmployment,
  callEndEpfoEmployment,
  callUpsertEpfoContributionProfile,
  callRecordEpfoContribution,
  callCorrectEpfoBalance,
  type AccountRow,
  type EpfoEmploymentRow,
  type EpfoContributionProfileRow,
} from "@spencare/domain-infra";
import type { EpfoLedgerEntry } from "@spencare/domain-core";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export const createEpfoAccount: Command<CreateEpfoAccountInput, AccountRow> = {
  name: "createEpfoAccount",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateEpfoAccountInput): Promise<Result<AccountRow>> {
    const parsed = createEpfoAccountSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid EPFO account details.",
      });
    }
    try {
      const row = await callCreateEpfoAccount(ctx.supabase, ctx.userId, parsed.data);
      return ok(row);
    } catch (e) {
      return err({
        code: "create_failed",
        message:
          "Couldn't create the EPFO account. Please try again." +
          (e instanceof Error && e.message.includes("invalid") ? ` (${e.message})` : ""),
      });
    }
  },
};

export const addEpfoEmployment: Command<AddEpfoEmploymentInput, EpfoEmploymentRow> = {
  name: "addEpfoEmployment",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoEmploymentRow>> {
    const parsed = addEpfoEmploymentSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid employment details.",
      });
    }
    try {
      const row = await callAddEpfoEmployment(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employerName: parsed.data.employerName,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate ?? null,
        memberId: parsed.data.memberId ?? null,
        notes: parsed.data.notes ?? null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      return err({ code: "add_failed", message: "Couldn't add the employment. Please try again." });
    }
  },
};

export const endEpfoEmployment: Command<EndEpfoEmploymentInput, EpfoEmploymentRow> = {
  name: "endEpfoEmployment",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoEmploymentRow>> {
    const parsed = endEpfoEmploymentSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid end date.",
      });
    }
    try {
      const row = await callEndEpfoEmployment(ctx.supabase, ctx.userId, parsed.data.employmentId, parsed.data.endDate);
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      if (msg.includes("end_before_start")) {
        return err({ code: "end_before_start", message: "End date must be on or after the start date." });
      }
      return err({ code: "end_failed", message: "Couldn't end the employment. Please try again." });
    }
  },
};

export const upsertEpfoContributionProfile: Command<UpsertEpfoContributionProfileInput, EpfoContributionProfileRow> = {
  name: "upsertEpfoContributionProfile",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoContributionProfileRow>> {
    const parsed = upsertEpfoContributionProfileSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid contribution profile.",
      });
    }
    try {
      const row = await callUpsertEpfoContributionProfile(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employmentId: parsed.data.employmentId ?? null,
        kind: parsed.data.kind,
        effectiveFrom: parsed.data.effectiveFrom,
        ...(parsed.data.mode === "fixed"
          ? { mode: "fixed", amountMinor: parsed.data.amountMinor }
          : parsed.data.mode === "percent"
            ? {
                mode: "percent",
                percentNum: parsed.data.percentNum,
                percentDen: parsed.data.percentDen,
                baseAmountMinor: parsed.data.baseAmountMinor,
              }
            : parsed.data.mode === "imported"
              ? { mode: "imported" }
              : { mode: "none" }),
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      return err({ code: "upsert_failed", message: "Couldn't save the contribution profile. Please try again." });
    }
  },
};

export const recordEpfoContribution: Command<RecordEpfoContributionInput, EpfoLedgerEntry> = {
  name: "recordEpfoContribution",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoLedgerEntry>> {
    const parsed = recordEpfoContributionSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid contribution.",
      });
    }
    try {
      const row = await callRecordEpfoContribution(ctx.supabase, ctx.userId, {
        accountId: parsed.data.accountId,
        employmentId: parsed.data.employmentId ?? null,
        kind: parsed.data.kind,
        amountMinor: parsed.data.amountMinor,
        occurredAt: parsed.data.occurredAt,
        description: parsed.data.description ?? null,
        externalReference: parsed.data.externalReference ?? null,
      });
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("employment_not_found")) {
        return err({ code: "not_found", message: "That employment doesn't exist." });
      }
      if (msg.includes("invalid_amount")) {
        return err({ code: "validation_error", message: "Amount must be positive." });
      }
      return err({ code: "record_failed", message: "Couldn't record the contribution. Please try again." });
    }
  },
};

export const correctEpfoBalance: Command<CorrectEpfoBalanceInput, EpfoLedgerEntry> = {
  name: "correctEpfoBalance",
  consequential: false,
  async execute(ctx, input): Promise<Result<EpfoLedgerEntry>> {
    const parsed = correctEpfoBalanceSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid correction.",
      });
    }
    try {
      const row = await callCorrectEpfoBalance(ctx.supabase, ctx.userId, parsed.data);
      return ok(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("account_not_eligible")) {
        return err({ code: "account_not_eligible", message: "That account is not an active EPFO account." });
      }
      if (msg.includes("invalid_amount")) {
        return err({ code: "validation_error", message: "Adjustment amount cannot be zero." });
      }
      if (msg.includes("reason_required")) {
        return err({ code: "validation_error", message: "Enter a reason for the correction." });
      }
      return err({ code: "correct_failed", message: "Couldn't apply the correction. Please try again." });
    }
  },
};

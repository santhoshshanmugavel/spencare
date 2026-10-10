"use server";

import { revalidatePath } from "next/cache";
import {
  archiveAccount,
  createAccount,
  listAccounts,
  updateAccount,
  setCardPaymentSource,
  removeCardPaymentSource,
  listCardPaymentSources,
  createEpfoAccount,
  addEpfoEmployment,
  endEpfoEmployment,
  upsertEpfoContributionProfile,
  recordEpfoContribution,
  correctEpfoBalance,
  importEpfoPassbook,
  confirmEpfoPassbookImport,
  getEpfoAccountOverview,
  type AuthContext,
} from "@spencare/domain-application";
import type {
  CreateAccountInput,
  UpdateAccountInput,
  CreateEpfoAccountInput,
  AddEpfoEmploymentInput,
  EndEpfoEmploymentInput,
  UpsertEpfoContributionProfileInput,
  RecordEpfoContributionInput,
  CorrectEpfoBalanceInput,
  ConfirmEpfoPassbookImportInput,
} from "@spencare/validation";
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

export async function listCardPaymentSourcesAction() {
  const ctx = await requireAuthContext();
  return listCardPaymentSources(ctx);
}

export async function setCardPaymentAccountAction(creditCardAccountId: string, paymentAccountId: string) {
  const ctx = await requireAuthContext();
  const result = await setCardPaymentSource.execute(ctx, { creditCardAccountId, paymentAccountId });
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function removeCardPaymentAccountAction(creditCardAccountId: string) {
  const ctx = await requireAuthContext();
  const result = await removeCardPaymentSource.execute(ctx, { creditCardAccountId });
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

// ============================================================
// EPFO
// ============================================================

export async function createEpfoAccountAction(input: CreateEpfoAccountInput) {
  const ctx = await requireAuthContext();
  const result = await createEpfoAccount.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function getEpfoOverviewAction(accountId: string) {
  const ctx = await requireAuthContext();
  const overview = await getEpfoAccountOverview(ctx, accountId);
  // Serialize bigint fields to strings so this server-action payload
  // remains JSON-safe for the client (bigints don't survive JSON).
  return {
    accountId: overview.accountId,
    lastVerifiedAt: overview.lastVerifiedAt,
    balance: {
      totalMinor: overview.balance.totalMinor.toString(),
      openingBalanceMinor: overview.balance.openingBalanceMinor.toString(),
      employeeEpfMinor: overview.balance.employeeEpfMinor.toString(),
      employerEpfMinor: overview.balance.employerEpfMinor.toString(),
      epsMinor: overview.balance.epsMinor.toString(),
      interestMinor: overview.balance.interestMinor.toString(),
      transferNetMinor: overview.balance.transferNetMinor.toString(),
      withdrawalNetMinor: overview.balance.withdrawalNetMinor.toString(),
      adjustmentsMinor: overview.balance.adjustmentsMinor.toString(),
      entryCount: overview.balance.entryCount,
    },
    entries: overview.entries,
    employments: overview.employments,
    contributionProfiles: overview.contributionProfiles,
    currentPeriod: {
      periodKey: overview.currentPeriod.periodKey,
      summary: {
        periodKey: overview.currentPeriod.summary.periodKey,
        expectedTotalMinor: overview.currentPeriod.summary.expectedTotalMinor.toString(),
        actualTotalMinor: overview.currentPeriod.summary.actualTotalMinor.toString(),
        hasAnyActual: overview.currentPeriod.summary.hasAnyActual,
        anyEvents: overview.currentPeriod.summary.anyEvents,
        byKind: Object.fromEntries(
          Object.entries(overview.currentPeriod.summary.byKind).map(([k, v]) => [k, v ? {
            expectedMinor: v.expectedMinor.toString(),
            actualMinor: v.actualMinor.toString(),
            hasActual: v.hasActual,
            status: v.status,
            differenceMinor: v.differenceMinor.toString(),
          } : v]),
        ) as Record<string, { expectedMinor: string; actualMinor: string; hasActual: boolean; status: string; differenceMinor: string }>,
      },
      events: overview.currentPeriod.events.map((e) => ({
        ...e,
        expectedAmountMinor: e.expectedAmountMinor.toString(),
        differenceMinor: e.differenceMinor.toString(),
        actualAmountMinor: e.actualAmountMinor.toString(),
      })),
    },
  };
}

export async function addEpfoEmploymentAction(input: AddEpfoEmploymentInput) {
  const ctx = await requireAuthContext();
  const result = await addEpfoEmployment.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function endEpfoEmploymentAction(input: EndEpfoEmploymentInput) {
  const ctx = await requireAuthContext();
  const result = await endEpfoEmployment.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function upsertEpfoContributionProfileAction(input: UpsertEpfoContributionProfileInput) {
  const ctx = await requireAuthContext();
  const result = await upsertEpfoContributionProfile.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function recordEpfoContributionAction(input: RecordEpfoContributionInput) {
  const ctx = await requireAuthContext();
  const result = await recordEpfoContribution.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function correctEpfoBalanceAction(input: CorrectEpfoBalanceInput) {
  const ctx = await requireAuthContext();
  const result = await correctEpfoBalance.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

export async function importEpfoPassbookAction(
  accountId: string,
  employmentId: string | null,
  formData: FormData,
) {
  const ctx = await requireAuthContext();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false as const, error: { code: "validation_error", message: "Select a passbook PDF file." } };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await importEpfoPassbook.execute(ctx, {
    accountId,
    employmentId: employmentId ?? undefined,
    fileName: file.name,
    fileSizeBytes: file.size,
    fileBytes: bytes,
  });
  return result;
}

export async function confirmEpfoPassbookImportAction(input: ConfirmEpfoPassbookImportInput) {
  const ctx = await requireAuthContext();
  const result = await confirmEpfoPassbookImport.execute(ctx, input);
  if (result.ok) revalidatePath("/settings/accounts");
  return result;
}

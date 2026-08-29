/**
 * Pure AI-context helpers (Phase 16). Zero I/O, zero Supabase, zero
 * provider SDK -- matches the domain-core purity rule enforced everywhere
 * else in this package.
 *
 * `redactFinancialSnapshot`/`redactAiContext` implement the LOCKED Phase 16
 * decision #1 (narrow Spensa-side Privacy Mode mitigation): when
 * `privacyModeEnabled` is true, every monetary figure is replaced with an
 * explicit `{ private: true }` marker *before* the context is ever handed
 * to a provider adapter -- this is a pure, synchronous transformation
 * applied to an already-assembled context object, not a UI concern and not
 * a fix to the broader Phase 14 server-side-masking-boundary gap (that
 * remains untouched, tracked separately). The provider never receives a
 * real number to redact after the fact; it never receives one at all.
 */

export interface PrivateAmount {
  private: true;
}

export type MaybePrivateAmount = { amountMinor: number; currency: string } | PrivateAmount;

function redactAmount(amount: { amountMinor: number; currency: string }, masked: boolean): MaybePrivateAmount {
  return masked ? { private: true } : amount;
}

export interface AiAccountSummaryInput {
  id: string;
  name: string;
  type: string;
  balanceMinor: number;
  currency: string;
}

export interface AiAccountSummaryRedacted {
  id: string;
  name: string;
  type: string;
  balance: MaybePrivateAmount;
  currency: string;
}

export interface AiFinancialSnapshotInput {
  safeToSpend: { state: string; amountMinor: number; currency: string };
  accounts: AiAccountSummaryInput[];
}

export interface AiFinancialSnapshotRedacted {
  safeToSpend: { state: string; amount: MaybePrivateAmount };
  accounts: AiAccountSummaryRedacted[];
}

export function redactFinancialSnapshot(
  input: AiFinancialSnapshotInput,
  privacyModeEnabled: boolean,
): AiFinancialSnapshotRedacted {
  return {
    safeToSpend: {
      state: input.safeToSpend.state,
      amount: redactAmount({ amountMinor: input.safeToSpend.amountMinor, currency: input.safeToSpend.currency }, privacyModeEnabled),
    },
    accounts: input.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: redactAmount({ amountMinor: a.balanceMinor, currency: a.currency }, privacyModeEnabled),
      currency: a.currency,
    })),
  };
}

export interface AiBudgetSummaryInput {
  id: string;
  categoryName: string;
  limitMinor: number;
  spentMinor: number;
  currency: string;
}

export interface AiBudgetSummaryRedacted {
  id: string;
  categoryName: string;
  limit: MaybePrivateAmount;
  spent: MaybePrivateAmount;
  currency: string;
}

export function redactBudgetSummaries(input: AiBudgetSummaryInput[], privacyModeEnabled: boolean): AiBudgetSummaryRedacted[] {
  return input.map((b) => ({
    id: b.id,
    categoryName: b.categoryName,
    limit: redactAmount({ amountMinor: b.limitMinor, currency: b.currency }, privacyModeEnabled),
    spent: redactAmount({ amountMinor: b.spentMinor, currency: b.currency }, privacyModeEnabled),
    currency: b.currency,
  }));
}

export interface AiGoalSummaryInput {
  id: string;
  name: string;
  targetAmountMinor: number;
  savedAmountMinor: number;
  currency: string;
}

export interface AiGoalSummaryRedacted {
  id: string;
  name: string;
  targetAmount: MaybePrivateAmount;
  savedAmount: MaybePrivateAmount;
  currency: string;
}

export function redactGoalSummaries(input: AiGoalSummaryInput[], privacyModeEnabled: boolean): AiGoalSummaryRedacted[] {
  return input.map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: redactAmount({ amountMinor: g.targetAmountMinor, currency: g.currency }, privacyModeEnabled),
    savedAmount: redactAmount({ amountMinor: g.savedAmountMinor, currency: g.currency }, privacyModeEnabled),
    currency: g.currency,
  }));
}

export interface AiBillSummaryInput {
  id: string;
  merchant: string;
  expectedAmountMinor: number | null;
  currency: string;
  expectedDate: string;
}

export interface AiBillSummaryRedacted {
  id: string;
  merchant: string;
  expectedAmount: MaybePrivateAmount | null;
  currency: string;
  expectedDate: string;
}

export function redactBillSummaries(input: AiBillSummaryInput[], privacyModeEnabled: boolean): AiBillSummaryRedacted[] {
  return input.map((b) => ({
    id: b.id,
    merchant: b.merchant,
    expectedAmount:
      b.expectedAmountMinor === null ? null : redactAmount({ amountMinor: b.expectedAmountMinor, currency: b.currency }, privacyModeEnabled),
    currency: b.currency,
    expectedDate: b.expectedDate,
  }));
}

export interface AiCashFlowSummaryInput {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  currency: string;
}

export interface AiCashFlowSummaryRedacted {
  income: MaybePrivateAmount;
  expense: MaybePrivateAmount;
  net: MaybePrivateAmount;
  currency: string;
}

export function redactCashFlowSummary(input: AiCashFlowSummaryInput, privacyModeEnabled: boolean): AiCashFlowSummaryRedacted {
  return {
    income: redactAmount({ amountMinor: input.incomeMinor, currency: input.currency }, privacyModeEnabled),
    expense: redactAmount({ amountMinor: input.expenseMinor, currency: input.currency }, privacyModeEnabled),
    net: redactAmount({ amountMinor: input.netMinor, currency: input.currency }, privacyModeEnabled),
    currency: input.currency,
  };
}

/**
 * Section 6a proposal previews are shown to the user in
 * ConsequentialActionPreview (real figures, since the user is the account
 * owner viewing their own screen) -- but if a preview's summary text is
 * ever echoed back into a provider-bound message (e.g. Spensa restating
 * "I've proposed a ₹500 expense"), that restatement must respect the same
 * redaction. This helper produces a redacted, provider-safe restatement of
 * an amount for exactly that purpose -- never used for the UI-facing
 * preview itself, only for what crosses into a provider message.
 */
export function describeAmountForProvider(amountMinor: number, currency: string, privacyModeEnabled: boolean): string {
  if (privacyModeEnabled) return "an amount the user has chosen to keep private";
  const major = (amountMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${currency} ${major}`;
}

/** Safety limits (Phase 16 §14 -- implementation-defined, not source-specified; kept isolated and named so they're easy to find/tune). */
export const MAX_TOOL_CALL_DEPTH = 6;
export const MAX_CONTEXT_MESSAGE_COUNT = 40;
export const MAX_MESSAGE_LENGTH_CHARS = 8000;

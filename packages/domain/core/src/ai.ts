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

/**
 * A ratio (e.g. credit utilization) is not itself a currency figure, but
 * it is DERIVED from two monetary ones -- redacted the same way under
 * Privacy Mode so a precise utilization percentage can never be used to
 * back-infer an approximate limit/used figure the user asked to keep
 * private (Spensa Spec v1.0 Correction Pass §1: "all credit monetary
 * values must pass through the same Spensa redaction boundary").
 */
export type MaybePrivateRatio = number | PrivateAmount;

function redactRatio(ratio: number | null, masked: boolean): MaybePrivateRatio | null {
  if (ratio === null) return null;
  return masked ? { private: true } : ratio;
}

/**
 * `used / limit`, safe against `limit === 0` (a $0-limit card, or a
 * not-yet-configured one) -- returns `null` rather than `Infinity`/`NaN`,
 * which the caller must treat as "utilization unknown," never as 0%.
 */
export function calculateCreditUtilization(usedMinor: number, limitMinor: number): number | null {
  if (limitMinor <= 0) return null;
  return usedMinor / limitMinor;
}

/**
 * Discriminated by `type` so each account variant only carries the fields
 * that are actually authoritative for it (database-architecture.md §3:
 * `balanceMinor` is authoritative for bank/cash ONLY; `credit_card` rows
 * use `creditLimitMinor`/`creditUsedMinor` instead -- never `balanceMinor`,
 * which Spensa's tool layer was incorrectly reading for credit cards
 * before this correction pass). `spendable` is a literal, structural flag
 * (not a comment) so nothing downstream can accidentally treat a credit or
 * investment figure as spendable cash by forgetting to check `type`.
 */
export type AiAccountSummaryInput =
  | { id: string; name: string; type: "bank" | "cash"; currency: string; spendable: true; balanceMinor: number }
  | { id: string; name: string; type: "credit_card"; currency: string; spendable: false; creditLimitMinor: number; creditUsedMinor: number }
  | { id: string; name: string; type: "investment"; currency: string; spendable: false; marketValueMinor: number };

export type AiAccountSummaryRedacted =
  | { id: string; name: string; type: "bank" | "cash"; currency: string; spendable: true; balance: MaybePrivateAmount }
  | {
      id: string;
      name: string;
      type: "credit_card";
      currency: string;
      spendable: false;
      creditLimit: MaybePrivateAmount;
      creditUsed: MaybePrivateAmount;
      availableCredit: MaybePrivateAmount;
      creditUtilization: MaybePrivateRatio | null;
    }
  | { id: string; name: string; type: "investment"; currency: string; spendable: false; marketValue: MaybePrivateAmount };

function redactAccountSummary(a: AiAccountSummaryInput, masked: boolean): AiAccountSummaryRedacted {
  if (a.type === "credit_card") {
    const availableMinor = a.creditLimitMinor - a.creditUsedMinor;
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      spendable: false,
      creditLimit: redactAmount({ amountMinor: a.creditLimitMinor, currency: a.currency }, masked),
      creditUsed: redactAmount({ amountMinor: a.creditUsedMinor, currency: a.currency }, masked),
      availableCredit: redactAmount({ amountMinor: availableMinor, currency: a.currency }, masked),
      creditUtilization: redactRatio(calculateCreditUtilization(a.creditUsedMinor, a.creditLimitMinor), masked),
    };
  }
  if (a.type === "investment") {
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      spendable: false,
      marketValue: redactAmount({ amountMinor: a.marketValueMinor, currency: a.currency }, masked),
    };
  }
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    spendable: true,
    balance: redactAmount({ amountMinor: a.balanceMinor, currency: a.currency }, masked),
  };
}

export interface AiFinancialSnapshotInput {
  safeToSpend: {
    state: string;
    amountMinor: number;
    currency: string;
    /**
     * Phase 28 PRODUCT DECISION OVERRIDE: the owned-money (Bank+Cash) vs.
     * borrowed-capacity (Credit Card available credit) composition of
     * `amountMinor`, both optional so a pre-Phase-28 caller (or a test)
     * omitting them still produces a valid snapshot. When present, Spensa
     * must use these to avoid describing the total as "cash in your
     * accounts" -- see context.ts's own instructions to the model.
     */
    ownedSpendableMinor?: number;
    creditAvailableMinor?: number;
    /** Reserved from bank/cash accounts for credit-card outstanding balances (card payment sources). Zero when none configured. */
    cardPaymentReservedMinor?: number;
    /** Sum of reserved_minor across upcoming planned_commitment_occurrences. Zero when no planned commitments exist. */
    commitmentReservedMinor?: number;
    /** Sum of installment_amount_minor for active loans with a reserve_account_id. Zero when no loans are reserved. */
    loanReservedMinor?: number;
  };
  accounts: AiAccountSummaryInput[];
}

export interface AiFinancialSnapshotRedacted {
  safeToSpend: { state: string; amount: MaybePrivateAmount; ownedSpendable?: MaybePrivateAmount; creditAvailable?: MaybePrivateAmount; cardPaymentReserved?: MaybePrivateAmount; commitmentReserved?: MaybePrivateAmount; loanReserved?: MaybePrivateAmount };
  accounts: AiAccountSummaryRedacted[];
}

export function redactFinancialSnapshot(
  input: AiFinancialSnapshotInput,
  privacyModeEnabled: boolean,
): AiFinancialSnapshotRedacted {
  const currency = input.safeToSpend.currency;
  return {
    safeToSpend: {
      state: input.safeToSpend.state,
      amount: redactAmount({ amountMinor: input.safeToSpend.amountMinor, currency }, privacyModeEnabled),
      ...(input.safeToSpend.ownedSpendableMinor !== undefined
        ? { ownedSpendable: redactAmount({ amountMinor: input.safeToSpend.ownedSpendableMinor, currency }, privacyModeEnabled) }
        : {}),
      ...(input.safeToSpend.creditAvailableMinor !== undefined
        ? { creditAvailable: redactAmount({ amountMinor: input.safeToSpend.creditAvailableMinor, currency }, privacyModeEnabled) }
        : {}),
      ...(input.safeToSpend.cardPaymentReservedMinor !== undefined
        ? { cardPaymentReserved: redactAmount({ amountMinor: input.safeToSpend.cardPaymentReservedMinor, currency }, privacyModeEnabled) }
        : {}),
      ...(input.safeToSpend.commitmentReservedMinor !== undefined
        ? { commitmentReserved: redactAmount({ amountMinor: input.safeToSpend.commitmentReservedMinor, currency }, privacyModeEnabled) }
        : {}),
      ...(input.safeToSpend.loanReservedMinor !== undefined
        ? { loanReserved: redactAmount({ amountMinor: input.safeToSpend.loanReservedMinor, currency }, privacyModeEnabled) }
        : {}),
    },
    accounts: input.accounts.map((a) => redactAccountSummary(a, privacyModeEnabled)),
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

/**
 * Phase 27 -- deterministic, defense-in-depth redaction for Spensa's OWN
 * free-form generated text, applied server-side right before that text is
 * streamed to the client or persisted to `ai_messages`.
 *
 * Every structured input the model receives (AiContext, every read tool's
 * result -- see `redactFinancialSnapshot`/`redactBudgetSummaries`/etc.
 * above) is already redacted before it ever reaches the model, so the
 * model has no REAL figure of the app's own data to leak in the first
 * place. But the model's generated prose is not itself a structured
 * field -- nothing upstream can guarantee it never contains a currency
 * figure (the model could echo/paraphrase a number the user themselves
 * typed, or otherwise synthesize one in free text) -- so relying on the
 * system prompt alone to ask it not to ("please don't reveal exact
 * amounts") is not a real guarantee. This is that guarantee: a plain
 * regex pass over the actual output text.
 *
 * Deliberately narrow in scope -- matches only a token immediately
 * preceded by a recognized currency marker (₹, "Rs"/"Rs.", or "INR",
 * case-insensitive), with its digits (any comma grouping) and optional
 * decimal portion, plus an optional leading minus sign either side of the
 * marker. It does NOT attempt to redact a bare number "in financial
 * context" with no currency marker at all -- reliably telling a financial
 * bare number apart from a year, an ID, a percentage, or a date is not
 * something a deterministic pass can do safely, and getting that wrong
 * would violate the very same requirement (never redact a year/ID/
 * percentage/date) this function exists to uphold. That is a deliberate,
 * disclosed scope boundary, not an oversight.
 */
export function redactFinancialText(text: string, privacyModeEnabled: boolean): string {
  if (!privacyModeEnabled) return text;
  const pattern = /-?(₹|Rs\.?|INR)\s?-?\d{1,3}(?:,\d{1,3})*(?:\.\d+)?/gi;
  return text.replace(pattern, (match) => {
    const marker = match.match(/₹|Rs\.?|INR/i)?.[0] ?? "₹";
    return `${marker}*`;
  });
}

/** Safety limits (Phase 16 §14 -- implementation-defined, not source-specified; kept isolated and named so they're easy to find/tune). */
export const MAX_TOOL_CALL_DEPTH = 6;
export const MAX_CONTEXT_MESSAGE_COUNT = 40;
export const MAX_MESSAGE_LENGTH_CHARS = 8000;

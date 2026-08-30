import {
  getSafeToSpend,
  getDashboardSummary,
  listAccounts,
  listTransactions,
  listBudgetsWithUsage,
  listCategories,
  listGoals,
  calculateProgress,
  getUpcomingBills,
  getCashFlowOverview,
  toAiAccountSummaryInput,
  type AuthContext,
} from "@spencare/domain-application";
import { lastDayOfMonth, redactFinancialSnapshot, redactBudgetSummaries, redactGoalSummaries, redactBillSummaries, redactCashFlowSummary } from "@spencare/domain-core";
import { searchTransactionsToolSchema, getUpcomingBillsToolSchema } from "@spencare/validation";
import type { ToolDefinition } from "../provider.js";

const CURRENCY = "INR";

function currentPeriodStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface ToolHandlerContext {
  ctx: AuthContext;
  privacyModeEnabled: boolean;
}

export interface ReadToolHandler {
  definition: ToolDefinition;
  execute: (ctx: ToolHandlerContext, input: unknown) => Promise<unknown>;
}

/**
 * Read tools (ai-architecture.md §4) -- no confirmation cascade, since
 * none of these mutate anything. Every handler wraps an already-existing,
 * unmodified query. Every monetary field in every result is redacted here
 * (same narrow Phase 16 mitigation as AiContext itself) before the tool
 * result is handed back to the provider -- a read tool's structured
 * output is exactly as provider-bound as the context is, so it gets the
 * same treatment.
 */

const getSafeToSpendTool: ReadToolHandler = {
  definition: {
    name: "getSafeToSpend",
    description:
      "Get the user's current Safe-to-Spend amount and which calculation state produced it. Phase 28: this figure now includes Credit Card AVAILABLE credit alongside Bank/Cash -- use ownedSpendable (owned money) vs creditAvailable (borrowed capacity) to describe the composition; never describe the total amount as 'cash in your accounts'.",
    inputSchema: { type: "object", properties: {} },
  },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const result = await getSafeToSpend(ctx);
    const redacted = redactFinancialSnapshot(
      {
        safeToSpend: {
          state: result.state,
          amountMinor: Number(result.amount.amountMinorUnits),
          currency: result.amount.currencyCode,
          ownedSpendableMinor: Number(result.ownedSpendableTotal.amountMinorUnits),
          creditAvailableMinor: Number(result.creditAvailableTotal.amountMinorUnits),
        },
        accounts: [],
      },
      privacyModeEnabled,
    );
    return redacted.safeToSpend;
  },
};

const getDashboardSummaryTool: ReadToolHandler = {
  definition: { name: "getDashboardSummary", description: "Get a holistic snapshot: Safe-to-Spend, Net Worth, accounts, goals, upcoming bills, and this month's cash flow.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const summary = await getDashboardSummary(ctx);
    return {
      safeToSpend: redactFinancialSnapshot(
        {
          safeToSpend: {
            state: summary.safeToSpend.state,
            amountMinor: Number(summary.safeToSpend.amount.amountMinorUnits),
            currency: summary.safeToSpend.amount.currencyCode,
            ownedSpendableMinor: Number(summary.safeToSpend.ownedSpendableTotal.amountMinorUnits),
            creditAvailableMinor: Number(summary.safeToSpend.creditAvailableTotal.amountMinorUnits),
          },
          accounts: [],
        },
        privacyModeEnabled,
      ).safeToSpend,
      // Phase 28: Net Worth is a SEPARATE concept from Safe-to-Spend (the
      // override's own explicit instruction) -- a credit card's available
      // credit must never be counted as a Net Worth asset here.
      netWorth: privacyModeEnabled
        ? { private: true }
        : {
            netWorthMinor: Number(summary.netWorth.netWorth.amountMinorUnits),
            totalAssetsMinor: Number(summary.netWorth.totalAssets.amountMinorUnits),
            totalLiabilitiesMinor: Number(summary.netWorth.totalLiabilities.amountMinorUnits),
            currency: summary.netWorth.netWorth.currencyCode,
          },
      accounts: redactFinancialSnapshot(
        { safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: summary.accounts.map(toAiAccountSummaryInput) },
        privacyModeEnabled,
      ).accounts,
      goals: redactGoalSummaries(summary.goals.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.target_amount_minor, savedAmountMinor: g.saved_amount_minor, currency: CURRENCY })), privacyModeEnabled),
      upcomingBills: redactBillSummaries(
        summary.upcomingBills.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
        privacyModeEnabled,
      ),
      cashFlow: redactCashFlowSummary({ incomeMinor: summary.cashFlow.incomeMinor, expenseMinor: summary.cashFlow.expenseMinor, netMinor: summary.cashFlow.netMinor, currency: CURRENCY }, privacyModeEnabled),
    };
  },
};

const getAccountsTool: ReadToolHandler = {
  definition: { name: "getAccounts", description: "List the user's bank, cash, credit, and investment accounts.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const accounts = await listAccounts(ctx);
    return redactFinancialSnapshot(
      { safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: accounts.map(toAiAccountSummaryInput) },
      privacyModeEnabled,
    ).accounts;
  },
};

const searchTransactionsTool: ReadToolHandler = {
  definition: {
    name: "searchTransactions",
    description: "Look up recent transactions, optionally filtered to one account. Only call this when the user's question needs actual transaction detail -- financial summaries are already available via other tools.",
    inputSchema: { type: "object", properties: { accountId: { type: "string" }, limit: { type: "number" } } },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = searchTransactionsToolSchema.parse(rawInput ?? {});
    const transactions = await listTransactions(ctx, { accountId: input.accountId, limit: input.limit });
    const [categories] = await Promise.all([listCategories(ctx)]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    return transactions.map((t) => ({
      id: t.id,
      type: t.type,
      merchant: t.merchant,
      category: t.category_id ? (categoryNameById.get(t.category_id) ?? null) : null,
      occurredAt: t.occurred_at,
      amount: privacyModeEnabled ? { private: true } : { amountMinor: t.amount_minor, currency: t.currency },
    }));
  },
};

const getBudgetStatusTool: ReadToolHandler = {
  definition: { name: "getBudgetStatus", description: "Get this month's budget usage by category.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const [usages, categories] = await Promise.all([listBudgetsWithUsage(ctx, currentPeriodStart()), listCategories(ctx)]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    return redactBudgetSummaries(
      usages.map((u) => ({ id: u.id, categoryName: categoryNameById.get(u.categoryId) ?? "Category", limitMinor: u.limitMinor, spentMinor: u.spentMinor, currency: CURRENCY })),
      privacyModeEnabled,
    );
  },
};

const getGoalProgressTool: ReadToolHandler = {
  definition: { name: "getGoalProgress", description: "Get progress toward each of the user's active savings goals.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const goals = await listGoals(ctx);
    const withProgress = await Promise.all(
      goals.map(async (g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        progress: await calculateProgress(ctx, g.id),
        targetAmountMinor: g.target_amount_minor,
        savedAmountMinor: g.saved_amount_minor,
      })),
    );
    return redactGoalSummaries(withProgress.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.targetAmountMinor, savedAmountMinor: g.savedAmountMinor, currency: CURRENCY })), privacyModeEnabled).map((redacted, i) => ({
      ...redacted,
      status: withProgress[i]!.status,
      percentSaved: withProgress[i]!.progress?.percentSaved ?? null,
    }));
  },
};

const getUpcomingBillsTool: ReadToolHandler = {
  definition: { name: "getUpcomingBills", description: "List upcoming/predicted bills.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = getUpcomingBillsToolSchema.parse(rawInput ?? {});
    const bills = await getUpcomingBills(ctx, input.limit);
    return redactBillSummaries(
      bills.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
      privacyModeEnabled,
    );
  },
};

const getCashFlowSummaryTool: ReadToolHandler = {
  definition: { name: "getCashFlowSummary", description: "Get this month's income, expense, and net cash flow totals.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const periodStart = currentPeriodStart();
    const periodEnd = lastDayOfMonth(periodStart);
    const totals = await getCashFlowOverview(ctx, { periodStart, periodEnd });
    return redactCashFlowSummary({ incomeMinor: totals.incomeMinor, expenseMinor: totals.expenseMinor, netMinor: totals.netMinor, currency: CURRENCY }, privacyModeEnabled);
  },
};

export const READ_TOOLS: ReadToolHandler[] = [
  getSafeToSpendTool,
  getDashboardSummaryTool,
  getAccountsTool,
  searchTransactionsTool,
  getBudgetStatusTool,
  getGoalProgressTool,
  getUpcomingBillsTool,
  getCashFlowSummaryTool,
];

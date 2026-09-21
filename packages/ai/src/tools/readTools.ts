import {
  getSafeToSpend,
  getDashboardSummary,
  listAccounts,
  listTransactions,
  listBudgetsWithUsage,
  listCategories,
  listGoals,
  getGoal,
  calculateProgress,
  listContributions,
  getUpcomingBills,
  getCashFlowOverview,
  toAiAccountSummaryInput,
  getGoalContributionPlan,
  getCreditCardStatementSummary,
  getActiveObligationForAccount,
  getAccount,
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
      "Get the user's current Safe-to-Spend amount and which calculation state produced it. This figure is Bank + Cash ONLY (owned money) -- it does NOT include Credit Card available credit or Investment value. creditAvailable is given separately (a credit card's limit minus used, borrowed capacity, never owned money) -- always describe it as a distinct figure, never add it to the Safe-to-Spend amount.",
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
  definition: { name: "getGoalProgress", description: "Get progress toward each of the user's active savings goals, including any contribution plan (reminder schedule) set up for each goal.", inputSchema: { type: "object", properties: {} } },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const goals = await listGoals(ctx);
    const withProgress = await Promise.all(
      goals.map(async (g) => {
        const [progress, plan] = await Promise.all([
          calculateProgress(ctx, g.id),
          getGoalContributionPlan(ctx, g.id),
        ]);
        return {
          id: g.id,
          name: g.name,
          status: g.status,
          progress,
          targetAmountMinor: g.target_amount_minor,
          savedAmountMinor: g.saved_amount_minor,
          contributionPlan: plan
            ? {
                frequency: plan.frequency,
                amountMinor: plan.amount_minor,
                planStatus: plan.status,
                nextDueAt: plan.next_due_at,
              }
            : null,
        };
      }),
    );
    return redactGoalSummaries(withProgress.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.targetAmountMinor, savedAmountMinor: g.savedAmountMinor, currency: CURRENCY })), privacyModeEnabled).map((redacted, i) => ({
      ...redacted,
      status: withProgress[i]!.status,
      percentSaved: withProgress[i]!.progress?.percentSaved ?? null,
      contributionPlan: withProgress[i]!.contributionPlan,
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

const getGoalDetailTool: ReadToolHandler = {
  definition: {
    name: "getGoalDetail",
    description: "Get full detail for a single savings goal: progress, pace, contribution history, and the active reminder plan. Use when the user asks about a specific goal by name or id.",
    inputSchema: { type: "object", properties: { goalId: { type: "string", description: "UUID of the goal" } }, required: ["goalId"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const { goalId } = rawInput as { goalId: string };
    const [goal, progress, contributions, plan] = await Promise.all([
      getGoal(ctx, goalId),
      calculateProgress(ctx, goalId),
      listContributions(ctx, goalId),
      getGoalContributionPlan(ctx, goalId),
    ]);
    if (!goal) return { error: "Goal not found" };
    const redacted = privacyModeEnabled;
    return {
      id: goal.id,
      name: goal.name,
      status: goal.status,
      targetAmount: redacted ? { private: true } : { amountMinor: goal.target_amount_minor, currency: "INR" },
      savedAmount: redacted ? { private: true } : { amountMinor: goal.saved_amount_minor, currency: "INR" },
      percentSaved: progress?.percentSaved ?? null,
      monthsLeft: progress?.monthsLeft ?? null,
      suggestedMonthlyMinor: redacted ? null : (progress?.suggestedMonthlyContributionMinor ?? null),
      isReached: progress?.isReached ?? false,
      targetDate: goal.target_date ?? null,
      recentContributions: contributions.slice(0, 5).map((c) => ({
        id: c.id,
        occurredAt: c.occurred_at,
        amount: redacted ? { private: true } : { amountMinor: c.amount_minor, currency: "INR" },
        description: c.description ?? null,
      })),
      contributionPlan: plan
        ? {
            id: plan.id,
            frequency: plan.frequency,
            amountMinor: redacted ? { private: true } : plan.amount_minor,
            planStatus: plan.status,
            nextDueAt: plan.next_due_at,
          }
        : null,
    };
  },
};

const getCreditCardBillingTool: ReadToolHandler = {
  definition: {
    name: "getCreditCardBillingSummary",
    description:
      "Get the current billing cycle for a credit card account: statement close date, payment due date, outstanding balance, and payment obligation status. " +
      "Use this to answer 'when is my credit card bill due?', 'when does my statement close?', or 'what is my credit card balance?'. " +
      "All dates come from the canonical credit-card billing domain service. Never calculate billing dates yourself.",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "string", description: "Credit card account UUID" } },
      required: ["accountId"],
    },
  },
  execute: async ({ ctx, privacyModeEnabled }, input) => {
    const { accountId } = input as { accountId: string };
    const [account, summary] = await Promise.all([
      getAccount(ctx, accountId),
      getCreditCardStatementSummary(ctx, accountId),
    ]);
    if (!account || account.type !== "credit_card") return null;
    if (!summary) return null;

    const acctRow = account as unknown as {
      statement_close_day?: number | null;
      payment_due_day?: number | null;
      credit_used_minor?: number | null;
    };

    const obligation = await getActiveObligationForAccount(ctx, accountId, summary.statementDate);
    const currentOutstandingMinor = acctRow.credit_used_minor ?? 0;
    const statementBalanceMinor = summary.statementBalanceMinor;

    return {
      accountId: summary.accountId,
      accountName: summary.accountName,
      currency: summary.currency,
      statementCloseDay: acctRow.statement_close_day ?? null,
      paymentDueDay: acctRow.payment_due_day ?? null,
      statementPeriodStart: summary.periodStart,
      statementPeriodEnd: summary.periodEnd,
      nextStatementDate: summary.statementDate,
      nextPaymentDueDate: summary.paymentDueDate,
      statementBalanceMinor: privacyModeEnabled ? null : statementBalanceMinor,
      statementBalanceNote:
        statementBalanceMinor === 0
          ? "Statement has not yet closed for this period. Balance shown is charges so far."
          : null,
      currentOutstandingMinor: privacyModeEnabled ? null : currentOutstandingMinor,
      obligation: obligation
        ? {
            status: obligation.status,
            remainingDueMinor: privacyModeEnabled ? null : obligation.remainingMinor,
            paidMinor: privacyModeEnabled ? null : obligation.paidMinor,
            dueDate: obligation.dueDate,
          }
        : null,
    };
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
  getGoalDetailTool,
  getCreditCardBillingTool,
];

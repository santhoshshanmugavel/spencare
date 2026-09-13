import { z } from "zod";
import {
  getSafeToSpend,
  getDashboardSummary,
  listAccounts,
  listTransactions,
  listCategories,
  listBudgetsWithUsage,
  listGoals,
  calculateProgress,
  getUpcomingBills,
  getCashFlowOverview,
  toAiAccountSummaryInput,
  redactFinancialSnapshot,
  redactBudgetSummaries,
  redactGoalSummaries,
  redactBillSummaries,
  redactCashFlowSummary,
  // Phase 6 additions
  getNetWorth,
  getProfileForDisplay,
  getTransaction,
  getAccount,
  getAccountBalance,
  getGoal,
  getCashFlowByCategory,
  compareCashFlowPeriods,
  getCashFlowTrend,
  listBillPredictions,
  listGmailCandidatesQuery,
  getGmailStatus,
  listMcpSessions,
  getSecurityStatus,
  getOnboardingStatusQuery,
  type McpAuthContext,
} from "@spencare/domain-application";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runScopedTool, isPrivacyModeEnabled } from "./helpers.js";

const CURRENCY = "INR";

/**
 * Read tools (Phase 18 §8 originals + Phase 6 additions). Every one wraps
 * an already-existing, unmodified `packages/domain/application` query --
 * no domain calculation is reimplemented here. Every monetary figure is
 * passed through the same narrow, Privacy-Mode-aware redaction Spensa's
 * tools use -- an external MCP client is exactly the kind of third-party
 * boundary that redaction was built for.
 */
export function registerReadTools(server: McpServer, ctx: McpAuthContext): void {
  // ── Existing 9 read tools (Phase 18, UNCHANGED) ───────────────────────

  server.registerTool(
    "getSafeToSpend",
    {
      description:
        "Get the user's current Safe-to-Spend amount and which calculation state produced it. This figure is Bank + Cash ONLY (owned money) -- it does NOT include Credit Card available credit or Investment value. creditAvailable is given separately (a credit card's limit minus used, borrowed capacity, never owned money) -- always describe it as a distinct figure, never add it to the Safe-to-Spend amount.",
      inputSchema: {},
    },
    async () =>
      runScopedTool(ctx, "getSafeToSpend", "read", async () => {
        const [result, privacyModeEnabled] = await Promise.all([getSafeToSpend(ctx), isPrivacyModeEnabled(ctx)]);
        return redactFinancialSnapshot(
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
        ).safeToSpend;
      }),
  );

  server.registerTool(
    "getAccounts",
    { description: "List the user's bank, cash, credit, and investment accounts. Credit-card accounts are never spendable cash -- see creditLimit/creditUsed/availableCredit/creditUtilization instead of a balance.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getAccounts", "read", async () => {
        const [accounts, privacyModeEnabled] = await Promise.all([listAccounts(ctx), isPrivacyModeEnabled(ctx)]);
        return redactFinancialSnapshot({ safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: accounts.map(toAiAccountSummaryInput) }, privacyModeEnabled).accounts;
      }),
  );

  server.registerTool(
    "getDashboardSummary",
    { description: "Get a holistic snapshot: Safe-to-Spend, accounts, net worth, goals, upcoming bills, and this month's cash flow.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getDashboardSummary", "read", async () => {
        const [summary, privacyModeEnabled] = await Promise.all([getDashboardSummary(ctx), isPrivacyModeEnabled(ctx)]);
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
          netWorth: privacyModeEnabled
            ? { private: true }
            : {
                netWorthMinor: Number(summary.netWorth.netWorth.amountMinorUnits),
                totalAssetsMinor: Number(summary.netWorth.totalAssets.amountMinorUnits),
                totalLiabilitiesMinor: Number(summary.netWorth.totalLiabilities.amountMinorUnits),
                currency: summary.netWorth.netWorth.currencyCode,
              },
          accounts: redactFinancialSnapshot({ safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: summary.accounts.map(toAiAccountSummaryInput) }, privacyModeEnabled).accounts,
          goals: redactGoalSummaries(summary.goals.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.target_amount_minor, savedAmountMinor: g.saved_amount_minor, currency: CURRENCY })), privacyModeEnabled),
          upcomingBills: redactBillSummaries(
            summary.upcomingBills.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
            privacyModeEnabled,
          ),
          cashFlow: redactCashFlowSummary({ incomeMinor: summary.cashFlow.incomeMinor, expenseMinor: summary.cashFlow.expenseMinor, netMinor: summary.cashFlow.netMinor, currency: CURRENCY }, privacyModeEnabled),
        };
      }),
  );

  server.registerTool(
    "searchTransactions",
    {
      description: "Look up recent transactions, optionally filtered to one account.",
      inputSchema: { accountId: z.string().optional(), limit: z.number().optional() },
    },
    async (rawInput: { accountId?: string; limit?: number }) =>
      runScopedTool(ctx, "searchTransactions", "read", async () => {
        const [transactions, categories, privacyModeEnabled] = await Promise.all([
          listTransactions(ctx, { accountId: rawInput.accountId, limit: rawInput.limit }),
          listCategories(ctx),
          isPrivacyModeEnabled(ctx),
        ]);
        const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
        return transactions.map((t) => ({
          id: t.id,
          type: t.type,
          itemName: t.item_name,
          merchant: t.merchant,
          category: t.category_id ? (categoryNameById.get(t.category_id) ?? null) : null,
          occurredAt: t.occurred_at,
          amount: privacyModeEnabled ? { private: true } : { amountMinor: t.amount_minor, currency: t.currency },
        }));
      }),
  );

  server.registerTool(
    "getBudgetStatus",
    { description: "Get the current month's budget status by category.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getBudgetStatus", "read", async () => {
        const now = new Date();
        const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const [usages, categories, privacyModeEnabled] = await Promise.all([listBudgetsWithUsage(ctx, periodStart), listCategories(ctx), isPrivacyModeEnabled(ctx)]);
        const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
        return redactBudgetSummaries(
          usages.map((u) => ({ id: u.id, categoryName: categoryNameById.get(u.categoryId) ?? "Category", limitMinor: u.limitMinor, spentMinor: u.spentMinor, currency: CURRENCY })),
          privacyModeEnabled,
        );
      }),
  );

  server.registerTool(
    "getGoalProgress",
    { description: "Get progress toward the user's savings goals.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getGoalProgress", "read", async () => {
        const [goals, privacyModeEnabled] = await Promise.all([listGoals(ctx), isPrivacyModeEnabled(ctx)]);
        const withProgress = await Promise.all(
          goals.map(async (g) => ({ id: g.id, name: g.name, status: g.status, progress: await calculateProgress(ctx, g.id), targetAmountMinor: g.target_amount_minor, savedAmountMinor: g.saved_amount_minor })),
        );
        return redactGoalSummaries(withProgress.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.targetAmountMinor, savedAmountMinor: g.savedAmountMinor, currency: CURRENCY })), privacyModeEnabled).map(
          (redacted, i) => ({ ...redacted, status: withProgress[i]!.status, percentSaved: withProgress[i]!.progress?.percentSaved ?? null }),
        );
      }),
  );

  server.registerTool(
    "getUpcomingBills",
    { description: "List upcoming predicted bills.", inputSchema: { limit: z.number().optional() } },
    async (rawInput: { limit?: number }) =>
      runScopedTool(ctx, "getUpcomingBills", "read", async () => {
        const [predictions, privacyModeEnabled] = await Promise.all([getUpcomingBills(ctx, rawInput.limit ?? 10), isPrivacyModeEnabled(ctx)]);
        return redactBillSummaries(
          predictions.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
          privacyModeEnabled,
        );
      }),
  );

  server.registerTool(
    "listCategories",
    {
      description:
        "List all the user's transaction categories (id + name). Call this first whenever you need to resolve a category name (e.g. 'Dining', 'Groceries') to a categoryId UUID before calling proposeAddExpense, proposeAddIncome, or proposeCreateBudget.",
      inputSchema: {},
    },
    async () =>
      runScopedTool(ctx, "listCategories", "read", async () => {
        const categories = await listCategories(ctx);
        return categories.map((c) => ({ id: c.id, name: c.name }));
      }),
  );

  server.registerTool(
    "getCashFlowSummary",
    { description: "Get this month's income/expense/net cash flow totals.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getCashFlowSummary", "read", async () => {
        const now = new Date();
        const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
        const [totals, privacyModeEnabled] = await Promise.all([getCashFlowOverview(ctx, { periodStart, periodEnd }), isPrivacyModeEnabled(ctx)]);
        return redactCashFlowSummary({ incomeMinor: totals.incomeMinor, expenseMinor: totals.expenseMinor, netMinor: totals.netMinor, currency: CURRENCY }, privacyModeEnabled);
      }),
  );

  // ── Phase 6: 14 new read tools ────────────────────────────────────────

  server.registerTool(
    "getNetWorth",
    { description: "Get the user's current net worth: total assets minus total liabilities across all accounts.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getNetWorth", "read", async () => {
        const [result, privacyModeEnabled] = await Promise.all([getNetWorth(ctx), isPrivacyModeEnabled(ctx)]);
        if (privacyModeEnabled) return { private: true };
        return {
          netWorthMinor: Number(result.netWorth.amountMinorUnits),
          totalAssetsMinor: Number(result.totalAssets.amountMinorUnits),
          totalLiabilitiesMinor: Number(result.totalLiabilities.amountMinorUnits),
          currency: result.netWorth.currencyCode,
        };
      }),
  );

  server.registerTool(
    "getProfile",
    { description: "Get the user's profile: display name, preferred currency, and timezone.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getProfile", "read", async () => {
        const profile = await getProfileForDisplay(ctx);
        if (!profile) return null;
        return {
          displayName: profile.displayName,
          preferredCurrency: profile.preferredCurrency,
          timezone: profile.timezone,
        };
      }),
  );

  server.registerTool(
    "getTransaction",
    { description: "Get a single transaction by ID.", inputSchema: { transactionId: z.string().uuid() } },
    async (rawInput: { transactionId: string }) =>
      runScopedTool(ctx, "getTransaction", "read", async () => {
        const [txn, categories, privacyModeEnabled] = await Promise.all([getTransaction(ctx, rawInput.transactionId), listCategories(ctx), isPrivacyModeEnabled(ctx)]);
        if (!txn) return null;
        const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
        return {
          id: txn.id,
          type: txn.type,
          itemName: txn.item_name,
          merchant: txn.merchant,
          description: txn.description,
          category: txn.category_id ? (categoryNameById.get(txn.category_id) ?? null) : null,
          categoryId: txn.category_id,
          accountId: txn.account_id,
          occurredAt: txn.occurred_at,
          amount: privacyModeEnabled ? { private: true } : { amountMinor: txn.amount_minor, currency: txn.currency },
        };
      }),
  );

  server.registerTool(
    "getAccount",
    { description: "Get a single account by ID, including its current balance details.", inputSchema: { accountId: z.string().uuid() } },
    async (rawInput: { accountId: string }) =>
      runScopedTool(ctx, "getAccount", "read", async () => {
        const [account, balance, privacyModeEnabled] = await Promise.all([getAccount(ctx, rawInput.accountId), getAccountBalance(ctx, rawInput.accountId), isPrivacyModeEnabled(ctx)]);
        if (!account) return null;
        const redacted = redactFinancialSnapshot({ safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: [toAiAccountSummaryInput(account)] }, privacyModeEnabled);
        return { ...redacted.accounts[0], balance: privacyModeEnabled ? { private: true } : balance };
      }),
  );

  server.registerTool(
    "getGoalDetail",
    { description: "Get full details and progress for a single savings goal.", inputSchema: { goalId: z.string().uuid() } },
    async (rawInput: { goalId: string }) =>
      runScopedTool(ctx, "getGoalDetail", "read", async () => {
        const [goal, progress, privacyModeEnabled] = await Promise.all([getGoal(ctx, rawInput.goalId), calculateProgress(ctx, rawInput.goalId), isPrivacyModeEnabled(ctx)]);
        if (!goal) return null;
        const redacted = redactGoalSummaries([{ id: goal.id, name: goal.name, targetAmountMinor: goal.target_amount_minor, savedAmountMinor: goal.saved_amount_minor, currency: CURRENCY }], privacyModeEnabled);
        return {
          ...redacted[0],
          status: goal.status,
          targetDate: goal.target_date,
          fundingAccountId: goal.funding_account_id,
          percentSaved: progress?.percentSaved ?? null,
          monthsLeft: progress?.monthsLeft ?? null,
        };
      }),
  );

  server.registerTool(
    "getCashFlowByCategory",
    {
      description: "Get income or expense broken down by category for a period.",
      inputSchema: {
        periodStart: z.string(),
        periodEnd: z.string(),
        mode: z.enum(["expense", "income"]),
      },
    },
    async (rawInput: { periodStart: string; periodEnd: string; mode: "expense" | "income" }) =>
      runScopedTool(ctx, "getCashFlowByCategory", "read", async () => {
        const [slices, categories, privacyModeEnabled] = await Promise.all([
          getCashFlowByCategory(ctx, { periodStart: rawInput.periodStart, periodEnd: rawInput.periodEnd }, rawInput.mode),
          listCategories(ctx),
          isPrivacyModeEnabled(ctx),
        ]);
        const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
        return slices.map((s) => ({
          categoryId: s.categoryId,
          categoryName: s.categoryId ? (categoryNameById.get(s.categoryId) ?? s.categoryId) : null,
          amountMinor: privacyModeEnabled ? null : s.amountMinor,
          percent: s.percent,
        }));
      }),
  );

  server.registerTool(
    "compareCashFlowPeriods",
    {
      description: "Compare income/expense/net between two periods (e.g. this month vs last month).",
      inputSchema: {
        currentPeriodStart: z.string(),
        currentPeriodEnd: z.string(),
        previousPeriodStart: z.string(),
        previousPeriodEnd: z.string(),
      },
    },
    async (rawInput: { currentPeriodStart: string; currentPeriodEnd: string; previousPeriodStart: string; previousPeriodEnd: string }) =>
      runScopedTool(ctx, "compareCashFlowPeriods", "read", async () => {
        const [comparison, privacyModeEnabled] = await Promise.all([
          compareCashFlowPeriods(ctx, { periodStart: rawInput.currentPeriodStart, periodEnd: rawInput.currentPeriodEnd }, { periodStart: rawInput.previousPeriodStart, periodEnd: rawInput.previousPeriodEnd }),
          isPrivacyModeEnabled(ctx),
        ]);
        const redactTotals = (t: { incomeMinor: number; expenseMinor: number; netMinor: number }) =>
          redactCashFlowSummary({ incomeMinor: t.incomeMinor, expenseMinor: t.expenseMinor, netMinor: t.netMinor, currency: CURRENCY }, privacyModeEnabled);
        return {
          current: redactTotals(comparison.current),
          previous: redactTotals(comparison.previous),
          income: comparison.income,
          expense: comparison.expense,
          net: comparison.net,
        };
      }),
  );

  server.registerTool(
    "getCashFlowTrend",
    {
      description: "Get month-by-month cash flow totals for the past N months (oldest first). Useful for trend charts.",
      inputSchema: {
        monthsBack: z.number().int().min(1).max(12).default(6),
        endingPeriodStart: z.string().optional(),
      },
    },
    async (rawInput: { monthsBack?: number; endingPeriodStart?: string }) =>
      runScopedTool(ctx, "getCashFlowTrend", "read", async () => {
        const monthsBack = rawInput.monthsBack ?? 6;
        const now = new Date();
        const endingPeriodStart = rawInput.endingPeriodStart ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        const [trend, privacyModeEnabled] = await Promise.all([getCashFlowTrend(ctx, monthsBack, endingPeriodStart), isPrivacyModeEnabled(ctx)]);
        return trend.map((point) => ({
          periodStart: point.periodStart,
          totals: redactCashFlowSummary({ incomeMinor: point.totals.incomeMinor, expenseMinor: point.totals.expenseMinor, netMinor: point.totals.netMinor, currency: CURRENCY }, privacyModeEnabled),
        }));
      }),
  );

  server.registerTool(
    "listBills",
    { description: "List all bill predictions, optionally filtered by status. Returns upcoming and overdue bills with their definitions.", inputSchema: { status: z.enum(["open", "overdue", "matched", "skipped"]).optional() } },
    async (rawInput: { status?: "open" | "overdue" | "matched" | "skipped" }) =>
      runScopedTool(ctx, "listBills", "read", async () => {
        const [predictions, privacyModeEnabled] = await Promise.all([
          listBillPredictions(ctx, rawInput.status ? { status: [rawInput.status] } : undefined),
          isPrivacyModeEnabled(ctx),
        ]);
        return redactBillSummaries(
          predictions.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
          privacyModeEnabled,
        ).map((redacted, i) => ({ ...redacted, billDefinitionId: predictions[i]!.bill_definition_id, status: predictions[i]!.status }));
      }),
  );

  server.registerTool(
    "listGmailCandidates",
    {
      description: "List Gmail-extracted financial candidates pending review.",
      inputSchema: { status: z.enum(["pending", "edited", "accepted", "rejected", "matched_existing"]).optional() },
    },
    async (rawInput: { status?: "pending" | "edited" | "accepted" | "rejected" | "matched_existing" }) =>
      runScopedTool(ctx, "listGmailCandidates", "read", async () => {
        const candidates = await listGmailCandidatesQuery(ctx, rawInput.status as Parameters<typeof listGmailCandidatesQuery>[1]);
        return candidates.map((c) => ({
          id: c.id,
          candidateType: c.candidateType,
          direction: c.direction,
          reviewStatus: c.reviewStatus,
          normalizedMerchant: c.normalizedMerchant,
          normalizedDate: c.normalizedDate,
          accountId: c.accountId,
          suggestedCategoryId: c.suggestedCategoryId,
          receivedAt: c.receivedAt,
        }));
      }),
  );

  server.registerTool(
    "getGmailStatus",
    { description: "Get the status of the user's Gmail connection.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getGmailStatus", "read", async () => {
        const status = await getGmailStatus(ctx);
        if (!status) return { connected: false };
        return { connected: true, googleEmail: status.googleEmail, syncStatus: status.syncStatus };
      }),
  );

  server.registerTool(
    "listMcpSessions",
    { description: "List all MCP sessions for this user, including the current one.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "listMcpSessions", "read", async () => {
        const sessions = await listMcpSessions(ctx);
        return sessions.map((s) => ({
          id: s.id,
          clientName: s.clientName,
          scopes: s.scopes,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          isRevoked: s.revokedAt !== null,
          isCurrent: s.id === ctx.mcpSessionId,
        }));
      }),
  );

  server.registerTool(
    "getSecurityStatus",
    { description: "Get the user's security settings: whether 2FA is enabled and backup codes remain.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getSecurityStatus", "read", async () => {
        const status = await getSecurityStatus(ctx);
        if (!status) return null;
        return status;
      }),
  );

  server.registerTool(
    "getOnboardingStatus",
    { description: "Get the user's onboarding completion status.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getOnboardingStatus", "read", async () => {
        const status = await getOnboardingStatusQuery(ctx);
        return status ?? { completed: false };
      }),
  );
}

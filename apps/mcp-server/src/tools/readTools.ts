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
  type McpAuthContext,
} from "@spencare/domain-application";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runScopedTool, isPrivacyModeEnabled } from "./helpers.js";

const CURRENCY = "INR";

/**
 * The 8 approved read tools (Phase 18 §8; identical set to Spensa's,
 * ai-architecture.md §4). Every one wraps an already-existing,
 * unmodified `packages/domain/application` query -- no domain
 * calculation is reimplemented here. Every monetary figure is passed
 * through the same narrow, Privacy-Mode-aware redaction Spensa's tools
 * use (Phase 18 §10) -- an external MCP client is exactly the kind of
 * third-party boundary that redaction was built for.
 */
export function registerReadTools(server: McpServer, ctx: McpAuthContext): void {
  server.registerTool(
    "getSafeToSpend",
    { description: "Get the user's current Safe-to-Spend amount and which calculation state produced it.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getSafeToSpend", "read", async () => {
        const [result, privacyModeEnabled] = await Promise.all([getSafeToSpend(ctx), isPrivacyModeEnabled(ctx)]);
        return redactFinancialSnapshot(
          { safeToSpend: { state: result.state, amountMinor: Number(result.amount.amountMinorUnits), currency: result.amount.currencyCode }, accounts: [] },
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
    { description: "Get a holistic snapshot: Safe-to-Spend, accounts, goals, upcoming bills, and this month's cash flow.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "getDashboardSummary", "read", async () => {
        const [summary, privacyModeEnabled] = await Promise.all([getDashboardSummary(ctx), isPrivacyModeEnabled(ctx)]);
        return {
          safeToSpend: redactFinancialSnapshot(
            { safeToSpend: { state: summary.safeToSpend.state, amountMinor: Number(summary.safeToSpend.amount.amountMinorUnits), currency: summary.safeToSpend.amount.currencyCode }, accounts: [] },
            privacyModeEnabled,
          ).safeToSpend,
          accounts: redactFinancialSnapshot({ safeToSpend: { state: "n/a", amountMinor: 0, currency: CURRENCY }, accounts: summary.accounts.map(toAiAccountSummaryInput) }, privacyModeEnabled).accounts,
          goals: redactGoalSummaries(summary.goals.map((g) => ({ id: g.id, name: g.name, targetAmountMinor: g.target_amount_minor, savedAmountMinor: g.saved_amount_minor, currency: CURRENCY })), privacyModeEnabled),
          upcomingBills: redactBillSummaries(
            summary.upcomingBills.map((p) => ({ id: p.id, merchant: p.bill_definitions.merchant_pattern, expectedAmountMinor: p.expected_amount_minor, currency: CURRENCY, expectedDate: p.expected_date })),
            privacyModeEnabled,
          ),
          cashFlow: redactCashFlowSummary({ incomeMinor: summary.cashFlow.incomeMinor, expenseMinor: summary.cashFlow.expenseMinor, netMinor: summary.cashFlow.netMinor, currency: CURRENCY }, privacyModeEnabled),
          note: "Net Worth is not yet available (its formula is an open product decision).",
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
}

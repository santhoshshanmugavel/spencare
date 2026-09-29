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
  getGoalContributionPlan,
  getCashFlowByCategory,
  compareCashFlowPeriods,
  getCashFlowTrend,
  listBillPredictions,
  listGmailCandidatesQuery,
  getGmailStatus,
  listMcpSessions,
  getSecurityStatus,
  getOnboardingStatusQuery,
  // Planned commitments and loans
  listCommitments,
  listUpcoming,
  listAllLoans,
  // Credit card billing
  getCreditCardBillingStatus,
  // Financial Plans (Gate 11)
  listPlansWithSummaries,
  getPlanDetail,
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
              cardPaymentReservedMinor: Number(result.cardPaymentReservedTotal.amountMinorUnits),
              commitmentReservedMinor: Number(result.commitmentReservedTotal.amountMinorUnits),
              loanReservedMinor: Number(result.loanReservedTotal.amountMinorUnits),
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
                cardPaymentReservedMinor: Number(summary.safeToSpend.cardPaymentReservedTotal.amountMinorUnits),
                commitmentReservedMinor: Number(summary.safeToSpend.commitmentReservedTotal.amountMinorUnits),
                loanReservedMinor: Number(summary.safeToSpend.loanReservedTotal.amountMinorUnits),
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
        const [goal, progress, plan, privacyModeEnabled] = await Promise.all([getGoal(ctx, rawInput.goalId), calculateProgress(ctx, rawInput.goalId), getGoalContributionPlan(ctx, rawInput.goalId), isPrivacyModeEnabled(ctx)]);
        if (!goal) return null;
        const redacted = redactGoalSummaries([{ id: goal.id, name: goal.name, targetAmountMinor: goal.target_amount_minor, savedAmountMinor: goal.saved_amount_minor, currency: CURRENCY }], privacyModeEnabled);
        return {
          ...redacted[0],
          status: goal.status,
          targetDate: goal.target_date,
          fundingAccountId: goal.funding_account_id,
          percentSaved: progress?.percentSaved ?? null,
          monthsLeft: progress?.monthsLeft ?? null,
          contributionPlan: plan
            ? {
                id: plan.id,
                frequency: plan.frequency,
                amountMinor: plan.amount_minor,
                planStatus: plan.status,
                nextDueAt: plan.next_due_at,
                anchorDay: plan.anchor_day,
              }
            : null,
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

  server.registerTool(
    "listCommitments",
    { description: "List the user's planned commitments: named recurring obligations with payment and saving schedules.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "listCommitments", "read", async () => {
        const [commitments, privacyModeEnabled] = await Promise.all([listCommitments(ctx), isPrivacyModeEnabled(ctx)]);
        return commitments.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          paymentFrequency: c.payment_frequency,
          nextPaymentDate: c.next_payment_date,
          amount: privacyModeEnabled ? { private: true } : { amountMinor: c.amount_minor, currency: c.currency },
          amountIsEstimate: c.amount_is_estimate,
          savingCadence: c.saving_cadence,
          savingAmount: c.saving_cadence && !privacyModeEnabled ? { amountMinor: c.saving_amount_minor, currency: c.currency } : null,
          firstSavingDate: c.first_saving_date,
          tenureType: c.tenure_type,
          tenurePayments: c.tenure_payments,
          tenureEndDate: c.tenure_end_date,
        }));
      }),
  );

  server.registerTool(
    "getUpcomingCommitments",
    { description: "List upcoming planned commitment occurrences, loans, and predictions. Use this to answer 'what's coming up?' or to understand the user's near-term financial obligations.", inputSchema: { limitDays: z.number().optional() } },
    async (rawInput: { limitDays?: number }) =>
      runScopedTool(ctx, "getUpcomingCommitments", "read", async () => {
        const limitDays = rawInput.limitDays ?? 90;
        const dueBefore = new Date(Date.now() + limitDays * 86400000).toISOString().slice(0, 10);
        const [occurrences, loans, privacyModeEnabled] = await Promise.all([
          listUpcoming(ctx, { limit: 50, dueBefore }),
          listAllLoans(ctx),
          isPrivacyModeEnabled(ctx),
        ]);
        const activeLoans = loans.filter((l) => l.status === "active" && l.next_payment_date != null);
        return {
          commitmentOccurrences: occurrences.map((occ) => ({
            id: occ.id,
            commitmentId: occ.commitment_id,
            commitmentName: occ.planned_commitments.name,
            dueDate: occ.due_date,
            amount: privacyModeEnabled ? { private: true } : { amountMinor: occ.amount_minor, currency: "INR" },
            reserved: privacyModeEnabled ? { private: true } : { amountMinor: occ.reserved_minor, currency: "INR" },
            shortfall: privacyModeEnabled ? { private: true } : { amountMinor: Math.max(0, occ.amount_minor - occ.reserved_minor), currency: "INR" },
            status: occ.status,
          })),
          loanInstallments: activeLoans.map((l) => ({
            loanId: l.id,
            name: l.name,
            lenderName: l.lender_name,
            nextPaymentDate: l.next_payment_date,
            installmentAmount: privacyModeEnabled ? { private: true } : { amountMinor: l.installment_amount_minor, currency: l.currency },
          })),
        };
      }),
  );

  server.registerTool(
    "listLoans",
    { description: "List the user's active loans: personal, home, car, education, business, or other.", inputSchema: {} },
    async () =>
      runScopedTool(ctx, "listLoans", "read", async () => {
        const [loans, privacyModeEnabled] = await Promise.all([listAllLoans(ctx), isPrivacyModeEnabled(ctx)]);
        return loans.map((l) => ({
          id: l.id,
          name: l.name,
          loanType: l.loan_type,
          lenderName: l.lender_name,
          status: l.status,
          nextPaymentDate: l.next_payment_date,
          installmentAmount: privacyModeEnabled ? { private: true } : { amountMinor: l.installment_amount_minor, currency: l.currency },
          outstandingAmount: l.outstanding_minor != null && !privacyModeEnabled ? { amountMinor: l.outstanding_minor, currency: l.currency } : null,
          interestRatePct: l.interest_rate_pct,
          repaymentFrequency: l.repayment_frequency,
          endDate: l.end_date,
        }));
      }),
  );

  server.registerTool(
    "getCreditCardBillingSummary",
    {
      description:
        "Get the billing status for a credit card account: the most recently closed statement's balance, its payment due date and status, current outstanding, available credit, and utilization. " +
        "Use this to answer 'when is my credit card bill due?', 'when does my statement close?', or 'how much do I owe?'. " +
        "Always distinguish statementBalanceMinor (the frozen amount owed for the most recently closed statement) from currentOutstandingMinor (the live running balance, which may already include newer, not-yet-billed spending) -- never conflate the two. " +
        "All dates and balances come from the canonical credit-card billing domain service -- never computed independently by this tool.",
      inputSchema: { accountId: z.string().uuid() },
    },
    async (rawInput: { accountId: string }) =>
      runScopedTool(ctx, "getCreditCardBillingSummary", "read", async () => {
        const [account, privacyModeEnabled] = await Promise.all([
          getAccount(ctx, rawInput.accountId),
          isPrivacyModeEnabled(ctx),
        ]);
        if (!account || account.type !== "credit_card") return null;

        const acctRow = account as unknown as {
          statement_close_day?: number | null;
          payment_due_day?: number | null;
          credit_limit_minor?: number | null;
          credit_used_minor?: number | null;
        };

        const currentOutstandingMinor = acctRow.credit_used_minor ?? 0;
        const creditLimitMinor = acctRow.credit_limit_minor ?? 0;
        const availableCreditMinor = creditLimitMinor - currentOutstandingMinor;
        const utilizationPercent =
          creditLimitMinor > 0 ? Math.round((currentOutstandingMinor / creditLimitMinor) * 100) : null;

        const todayIso = new Date().toISOString().slice(0, 10);
        const billing = await getCreditCardBillingStatus(
          ctx,
          {
            id: rawInput.accountId,
            statement_close_day: acctRow.statement_close_day ?? null,
            payment_due_day: acctRow.payment_due_day ?? null,
          },
          todayIso,
        );

        if (!billing) {
          return {
            accountId: rawInput.accountId,
            accountName: account.name,
            currency: account.currency,
            statementCloseDay: null,
            paymentDueDay: null,
            currentOutstandingMinor: privacyModeEnabled ? null : currentOutstandingMinor,
            availableCreditMinor: privacyModeEnabled ? null : availableCreditMinor,
            utilizationPercent,
            statementBalanceMinor: null,
            paymentStatus: "no_statement" as const,
            note: "Billing dates are not set for this card. No statement or due date can be calculated.",
          };
        }

        return {
          accountId: rawInput.accountId,
          accountName: account.name,
          currency: account.currency,
          statementCloseDay: acctRow.statement_close_day ?? null,
          paymentDueDay: acctRow.payment_due_day ?? null,
          statementPeriodStart: billing.snapshot.mostRecentClosedPeriodStart,
          statementPeriodEnd: billing.snapshot.mostRecentClosedStatementDate,
          nextStatementDate: billing.snapshot.nextCycleEnd,
          nextPaymentDueDate: billing.snapshot.nextCycleDueDate,
          currentStatementDueDate: billing.snapshot.mostRecentClosedDueDate,
          statementBalanceMinor: privacyModeEnabled ? null : billing.statementBalanceMinor,
          currentOutstandingMinor: privacyModeEnabled ? null : currentOutstandingMinor,
          availableCreditMinor: privacyModeEnabled ? null : availableCreditMinor,
          utilizationPercent,
          paymentStatus: billing.paymentStatus,
          obligation: {
            status: billing.obligation.status,
            remainingDueMinor: privacyModeEnabled ? null : billing.obligation.remainingMinor,
            paidMinor: privacyModeEnabled ? null : billing.obligation.paidMinor,
            dueDate: billing.obligation.dueDate,
          },
        };
      }),
  );

  // ── Financial Plan read tools (Gate 11) ───────────────────────────────
  // Mirrors Spensa's own Plan read tools (packages/ai/src/tools/planTools.ts,
  // Gate 10) so both surfaces converge on the exact same canonical queries
  // and the exact same provenance labeling -- never a second Plan
  // calculation. "Plan" means financial_plans (a real-life purpose
  // container), never goal_contribution_plans.

  server.registerTool(
    "getPlans",
    {
      description: "List the user's financial Plans (real-life purpose containers such as a trip, wedding, or renovation) with a lightweight actual-vs-budget summary for each. A Plan differs from a Budget (a spending limit), a Goal (a savings target), and a Commitment (an obligated future payment).",
      inputSchema: {},
    },
    async () =>
      runScopedTool(ctx, "getPlans", "read", async () => {
        const asOfIso = new Date().toISOString().slice(0, 10);
        const [summaries, privacyModeEnabled] = await Promise.all([listPlansWithSummaries(ctx, asOfIso), isPrivacyModeEnabled(ctx)]);
        return summaries.map(({ plan, calculations }) => ({
          id: plan.id,
          name: plan.name,
          status: plan.status,
          currency: plan.base_currency,
          currentBudget:
            plan.current_budget_minor == null
              ? null
              : privacyModeEnabled
                ? { private: true }
                : { amountMinor: plan.current_budget_minor, currency: plan.base_currency, source: "USER_DEFINED" },
          actualSpend: privacyModeEnabled
            ? { private: true }
            : { amountMinor: Number(calculations.actualSpend.amountMinorUnits), currency: plan.base_currency, source: "ACTUAL" },
          overBudget: calculations.budgetStatus.overBudget,
          percentOfBudgetUsed: calculations.progress.percentOfBudgetUsed,
        }));
      }),
  );

  server.registerTool(
    "getPlanDetail",
    {
      description:
        "Get full detail for a single financial Plan by id: budget, actual spend (from real transactions), planned/committed/upcoming amounts, remaining budget, variance, progress, over-budget state, every Plan Item with its own status and estimated amount, the Goals/Commitments/Accounts linked to this Plan, and every Plan-scoped transaction. Every monetary figure is labeled with its source: ACTUAL (from real transactions), USER_DEFINED (typed in by the user), or CALCULATED (a canonical aggregate) -- never present one as another. Use getPlans first if the Plan id is not already known.",
      inputSchema: { planId: z.string().uuid() },
    },
    async (rawInput: { planId: string }) =>
      runScopedTool(ctx, "getPlanDetail", "read", async () => {
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const asOfIso = new Date().toISOString().slice(0, 10);
        const detail = await getPlanDetail(ctx, rawInput.planId, asOfIso);
        if (!detail) return { error: "Plan not found." };

        const [goals, commitments, accounts] = await Promise.all([listGoals(ctx), listCommitments(ctx), listAccounts(ctx)]);
        const goalById = new Map(goals.map((g) => [g.id, g]));
        const commitmentById = new Map(commitments.map((c) => [c.id, c]));
        const accountById = new Map(accounts.map((a) => [a.id, a]));

        function amount(amountMinor: number, currency: string, source: "ACTUAL" | "USER_DEFINED" | "CALCULATED") {
          return privacyModeEnabled ? { private: true } : { amountMinor, currency, source };
        }

        const { plan, items, goalLinks, commitmentLinks, accountLinks, transactions, calculations } = detail;

        return {
          id: plan.id,
          name: plan.name,
          status: plan.status,
          startDate: plan.start_date,
          endDate: plan.end_date,
          currency: plan.base_currency,
          originalBudget: plan.original_budget_minor == null ? null : amount(plan.original_budget_minor, plan.base_currency, "USER_DEFINED"),
          currentBudget: plan.current_budget_minor == null ? null : amount(plan.current_budget_minor, plan.base_currency, "USER_DEFINED"),
          actualSpend: amount(Number(calculations.actualSpend.amountMinorUnits), plan.base_currency, "ACTUAL"),
          plannedSpend: amount(Number(calculations.plannedSpend.amountMinorUnits), plan.base_currency, "CALCULATED"),
          committedAmount: amount(Number(calculations.committedAmount.amountMinorUnits), plan.base_currency, "CALCULATED"),
          upcomingAmount: amount(Number(calculations.upcomingAmount.amountMinorUnits), plan.base_currency, "CALCULATED"),
          remaining: calculations.budgetStatus.remaining == null ? null : amount(Number(calculations.budgetStatus.remaining.amountMinorUnits), plan.base_currency, "CALCULATED"),
          overBudget: calculations.budgetStatus.overBudget,
          variance: amount(Number(calculations.variance.variance.amountMinorUnits), plan.base_currency, "CALCULATED"),
          percentOfBudgetUsed: calculations.progress.percentOfBudgetUsed,
          percentOfPlannedSpent: calculations.progress.percentOfPlannedSpent,
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            status: item.status,
            categoryId: item.category_id,
            expectedDate: item.expected_date,
            estimatedAmount: item.estimated_amount_minor == null ? null : amount(item.estimated_amount_minor, item.estimated_currency ?? plan.base_currency, "USER_DEFINED"),
            commitmentId: item.commitment_id,
          })),
          linkedGoals: goalLinks.map((l) => goalById.get(l.goal_id)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => ({ id: g.id, name: g.name })),
          linkedCommitments: commitmentLinks.map((l) => commitmentById.get(l.commitment_id)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ id: c.id, name: c.name })),
          linkedAccounts: accountLinks.map((l) => accountById.get(l.account_id)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => ({ id: a.id, name: a.name })),
          transactions: transactions.map((t) => ({
            id: t.id,
            type: t.type,
            amount: amount(t.amount_minor, t.currency, "ACTUAL"),
            occurredAt: t.occurred_at,
            merchant: t.merchant,
            planItemId: t.plan_item_id,
          })),
          excludedTransactionsCount: calculations.excludedTransactions.length,
          excludedItemsCount: calculations.excludedItems.length,
          lastUpdated: new Date().toISOString(),
          dataConfidence: "high",
        };
      }),
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  proposeAddExpenseSchema,
  proposeAddIncomeSchema,
  proposeGoalContributionSchema,
  proposeMarkBillPaidSchema,
  proposeCreateBudgetSchema,
  proposeCreateGoalSchema,
  proposeUpdateTransactionSchema,
  proposeDeleteTransactionSchema,
  proposeTransferSchema,
  proposeCreateAccountSchema,
  proposeUpdateAccountSchema,
  proposeArchiveAccountSchema,
  proposeCreateBillSchema,
  proposeUpdateBillSchema,
  proposeCreateCategorySchema,
  proposeUpdateCategorySchema,
  proposeDeleteCategorySchema,
  proposeUpdateGoalSchema,
  proposeArchiveGoalSchema,
  proposeWithdrawContributionSchema,
  proposeUpdateBudgetSchema,
  proposeDeleteBudgetSchema,
  proposeUpdateProfileSchema,
  proposeUpdatePrivacyModeSchema,
  proposeAcceptGmailCandidateSchema,
  proposeRejectGmailCandidateSchema,
  proposeRevokeMcpSessionSchema,
  confirmCommandSchema,
  cancelCommandSchema,
} from "@spencare/validation";
import {
  listAccounts,
  listCategories,
  listGoals,
  listBillPredictions,
  listMcpSessions,
  getTransaction,
  getAccount,
  getGoal,
  getBudget,
  getGmailCandidateQuery,
  proposeCommand,
  confirmCommand,
  cancelPendingCommand,
  describeAmountForProvider,
  type McpAuthContext,
  type ProposalPreviewField,
} from "@spencare/domain-application";
import { runScopedTool, isPrivacyModeEnabled } from "./helpers.js";
import { mcpErrorFromConfirmResult } from "../errors.js";

/**
 * Write tools (Phase 18 §12-13 originals + Phase 6 additions). LOCKED:
 * every one is `propose*`-only -- the actual mutation only happens via the
 * separate `confirmPendingAction` tool, which the MCP client is responsible
 * for calling only after surfacing the returned preview to a human.
 * Natural language in a tool argument ("yes", "confirmed", etc.) is never
 * interpreted as authorization.
 */

async function accountName(ctx: McpAuthContext, accountId: string): Promise<string> {
  const accounts = await listAccounts(ctx);
  return accounts.find((a) => a.id === accountId)?.name ?? "the selected account";
}

async function categoryName(ctx: McpAuthContext, categoryId: string): Promise<string> {
  const categories = await listCategories(ctx);
  return categories.find((c) => c.id === categoryId)?.name ?? "the selected category";
}

async function goalName(ctx: McpAuthContext, goalId: string): Promise<string> {
  const goals = await listGoals(ctx);
  return goals.find((g) => g.id === goalId)?.name ?? "the selected goal";
}

function buildExpenseIncomePreview(kind: "expense" | "income", accName: string, catName: string, amountMinor: number, privacyModeEnabled: boolean): { summary: string; fields: ProposalPreviewField[] } {
  const amountText = describeAmountForProvider(amountMinor, "INR", privacyModeEnabled);
  return {
    summary: `Record a ${amountText} ${kind} on ${accName}, category ${catName}.`,
    fields: [
      { label: "Type", value: kind === "expense" ? "Expense" : "Income" },
      { label: "Account", value: accName },
      { label: "Category", value: catName },
      { label: "Amount", value: amountText },
    ],
  };
}

export function registerWriteTools(server: McpServer, ctx: McpAuthContext): void {
  // ── Existing 6 propose tools + confirm + cancel (Phase 18, UNCHANGED) ─

  server.registerTool(
    "proposeAddExpense",
    { description: "Propose recording a new expense. This does NOT create the transaction -- it only creates a proposal; the user must confirm via confirmPendingAction before anything is recorded.", inputSchema: proposeAddExpenseSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeAddExpense", "write", async () => {
        const input = proposeAddExpenseSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
        const preview = buildExpenseIncomePreview("expense", accName, catName, input.amountMinor, privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "createTransaction", { ...input, type: "expense" }, preview);
      }),
  );

  server.registerTool(
    "proposeAddIncome",
    { description: "Propose recording new income. This does NOT create the transaction -- it only creates a proposal; the user must confirm via confirmPendingAction.", inputSchema: proposeAddIncomeSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeAddIncome", "write", async () => {
        const input = proposeAddIncomeSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
        const preview = buildExpenseIncomePreview("income", accName, catName, input.amountMinor, privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "createTransaction", { ...input, type: "income" }, preview);
      }),
  );

  server.registerTool(
    "proposeGoalContribution",
    { description: "Propose contributing money toward a savings goal. This does NOT move any money -- it only creates a proposal; the user must confirm via confirmPendingAction.", inputSchema: proposeGoalContributionSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeGoalContribution", "write", async () => {
        const input = proposeGoalContributionSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [gName, accName] = await Promise.all([goalName(ctx, input.goalId), accountName(ctx, input.accountId)]);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "addContribution", input, {
          summary: `Contribute ${amountText} from ${accName} toward "${gName}".`,
          fields: [
            { label: "Goal", value: gName },
            { label: "From account", value: accName },
            { label: "Amount", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeMarkBillPaid",
    { description: "Propose marking a predicted bill as paid, linking it to a real transaction. This does NOT create the transaction -- it only creates a proposal; the user must confirm via confirmPendingAction.", inputSchema: proposeMarkBillPaidSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeMarkBillPaid", "write", async () => {
        const input = proposeMarkBillPaidSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName, predictions] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId), listBillPredictions(ctx)]);
        const merchant = predictions.find((p) => p.id === input.predictionId)?.bill_definitions.merchant_pattern ?? "this bill";
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "markBillPaid", input, {
          summary: `Mark "${merchant}" as paid: ${amountText} from ${accName}, category ${catName}.`,
          fields: [
            { label: "Bill", value: merchant },
            { label: "Account", value: accName },
            { label: "Category", value: catName },
            { label: "Amount", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeCreateBudget",
    { description: "Propose creating a new monthly budget for a category. This does NOT create the budget -- it only creates a proposal; the user must confirm via confirmPendingAction.", inputSchema: proposeCreateBudgetSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateBudget", "write", async () => {
        const input = proposeCreateBudgetSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const catName = await categoryName(ctx, input.categoryId);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "createBudget", input, {
          summary: `Create a ${amountText} monthly budget for ${catName}.`,
          fields: [
            { label: "Category", value: catName },
            { label: "Monthly limit", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeCreateGoal",
    { description: "Propose creating a new savings goal. This does NOT create the goal -- it only creates a proposal; the user must confirm via confirmPendingAction.", inputSchema: proposeCreateGoalSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateGoal", "write", async () => {
        const input = proposeCreateGoalSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const accName = await accountName(ctx, input.fundingAccountId);
        const amountText = describeAmountForProvider(input.targetAmountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "createGoal", input, {
          summary: `Create a new goal "${input.name}" with a target of ${amountText}, funded from ${accName}.`,
          fields: [
            { label: "Goal", value: input.name },
            { label: "Target", value: amountText },
            { label: "Funding account", value: accName },
          ],
        });
      }),
  );

  // ── Phase 6: 21 new propose tools ─────────────────────────────────────

  server.registerTool(
    "proposeUpdateTransaction",
    {
      description:
        "Propose editing an existing income or expense transaction (full replace: account, category, amount, and date are all required). Does NOT edit the transaction -- creates a proposal; the user must confirm via confirmPendingAction. Transfers cannot be edited; delete and recreate them.",
      inputSchema: proposeUpdateTransactionSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateTransaction", "write", async () => {
        const input = proposeUpdateTransactionSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [txn, accName, catName] = await Promise.all([getTransaction(ctx, input.transactionId), accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "updateTransaction", input, {
          summary: `Update transaction ${txn ? `"${txn.merchant ?? txn.id}"` : input.transactionId}: ${amountText} on ${accName}, category ${catName}.`,
          fields: [
            { label: "Account", value: accName },
            { label: "Category", value: catName },
            { label: "Amount", value: amountText },
            { label: "Date", value: input.occurredAt },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteTransaction",
    {
      description: "Propose soft-deleting a transaction. Does NOT delete it -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeDeleteTransactionSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteTransaction", "write", async () => {
        const input = proposeDeleteTransactionSchema.parse(rawInput);
        const txn = await getTransaction(ctx, input.transactionId);
        return proposeCommand(ctx, "mcp", "deleteTransaction", input, {
          summary: `Delete transaction ${txn ? `"${txn.merchant ?? txn.id}"` : input.transactionId}.`,
          fields: [{ label: "Transaction", value: txn?.merchant ?? input.transactionId }],
        });
      }),
  );

  server.registerTool(
    "proposeTransfer",
    {
      description: "Propose transferring money between two accounts atomically. Does NOT move any money -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeTransferSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeTransfer", "write", async () => {
        const input = proposeTransferSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [fromName, toName] = await Promise.all([accountName(ctx, input.fromAccountId), accountName(ctx, input.toAccountId)]);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "transfer", input, {
          summary: `Transfer ${amountText} from ${fromName} to ${toName}.`,
          fields: [
            { label: "From", value: fromName },
            { label: "To", value: toName },
            { label: "Amount", value: amountText },
            { label: "Date", value: input.occurredAt },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeCreateAccount",
    {
      description: "Propose creating a new account (bank, cash, credit card, or investment). Does NOT create the account -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeCreateAccountSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateAccount", "write", async () => {
        const input = proposeCreateAccountSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "createAccount", input, {
          summary: `Create a new ${input.type.replace("_", " ")} account "${input.name}" in ${input.currency}.`,
          fields: [
            { label: "Name", value: input.name },
            { label: "Type", value: input.type },
            { label: "Currency", value: input.currency },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateAccount",
    {
      description:
        "Propose updating an account's name or balance fields. NOTE: balance fields (balanceMinor, creditLimitMinor, creditUsedMinor, marketValueMinor) represent manual corrections to the stored value only -- do NOT use this to record a transaction or contribution. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateAccountSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateAccount", "write", async () => {
        const input = proposeUpdateAccountSchema.parse(rawInput);
        const acc = await getAccount(ctx, input.accountId);
        const label = acc?.name ?? input.accountId;
        return proposeCommand(ctx, "mcp", "updateAccount", input, {
          summary: `Update account "${label}".`,
          fields: [
            { label: "Account", value: label },
            ...(input.name ? [{ label: "New name", value: input.name }] : []),
          ],
        });
      }),
  );

  server.registerTool(
    "proposeArchiveAccount",
    {
      description: "Propose archiving an account. The account must have no active savings goals referencing it. Does NOT archive -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeArchiveAccountSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeArchiveAccount", "write", async () => {
        const input = proposeArchiveAccountSchema.parse(rawInput);
        const acc = await getAccount(ctx, input.accountId);
        const label = acc?.name ?? input.accountId;
        return proposeCommand(ctx, "mcp", "archiveAccount", input, {
          summary: `Archive account "${label}". It will no longer appear in Safe-to-Spend or new transactions.`,
          fields: [{ label: "Account", value: label }],
        });
      }),
  );

  server.registerTool(
    "proposeCreateBill",
    {
      description: "Propose creating a new recurring bill definition. Does NOT create the bill -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeCreateBillSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateBill", "write", async () => {
        const input = proposeCreateBillSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const amountText = input.expectedAmountMinor ? describeAmountForProvider(input.expectedAmountMinor, "INR", privacyModeEnabled) : "variable amount";
        return proposeCommand(ctx, "mcp", "createBill", input, {
          summary: `Create a ${input.recurrenceInterval} bill for "${input.merchantPattern}" (${amountText}).`,
          fields: [
            { label: "Merchant", value: input.merchantPattern },
            { label: "Recurrence", value: input.recurrenceInterval },
            { label: "Expected amount", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateBill",
    {
      description: "Propose updating a recurring bill definition. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateBillSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateBill", "write", async () => {
        const input = proposeUpdateBillSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "updateBill", input, {
          summary: `Update bill ${input.billId}${input.merchantPattern ? ` ("${input.merchantPattern}")` : ""}.`,
          fields: [{ label: "Bill ID", value: input.billId }, ...(input.merchantPattern ? [{ label: "Merchant", value: input.merchantPattern }] : [])],
        });
      }),
  );

  server.registerTool(
    "proposeCreateCategory",
    {
      description: "Propose creating a new transaction category. Does NOT create the category -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeCreateCategorySchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateCategory", "write", async () => {
        const input = proposeCreateCategorySchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "createCategory", input, {
          summary: `Create a new category "${input.name}".`,
          fields: [{ label: "Name", value: input.name }],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateCategory",
    {
      description: "Propose renaming or changing the icon of a transaction category. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateCategorySchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateCategory", "write", async () => {
        const input = proposeUpdateCategorySchema.parse(rawInput);
        const catName = await categoryName(ctx, input.categoryId);
        return proposeCommand(ctx, "mcp", "updateCategory", input, {
          summary: `Update category "${catName}"${input.name ? ` → rename to "${input.name}"` : ""}.`,
          fields: [{ label: "Category", value: catName }, ...(input.name ? [{ label: "New name", value: input.name }] : [])],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteCategory",
    {
      description:
        "Propose deleting a category and reassigning its transactions to a replacement category. Both categoryId and reassignToCategoryId are required. Does NOT delete -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeDeleteCategorySchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteCategory", "write", async () => {
        const input = proposeDeleteCategorySchema.parse(rawInput);
        const [catName, replaceName] = await Promise.all([categoryName(ctx, input.categoryId), categoryName(ctx, input.reassignToCategoryId)]);
        return proposeCommand(ctx, "mcp", "deleteCategory", input, {
          summary: `Delete category "${catName}" and reassign its transactions to "${replaceName}".`,
          fields: [
            { label: "Delete", value: catName },
            { label: "Reassign to", value: replaceName },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateGoal",
    {
      description: "Propose updating a savings goal's name, target, target date, funding account, or term. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateGoalSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateGoal", "write", async () => {
        const input = proposeUpdateGoalSchema.parse(rawInput);
        const gName = await goalName(ctx, input.goalId);
        return proposeCommand(ctx, "mcp", "updateGoal", input, {
          summary: `Update goal "${gName}"${input.name ? ` → rename to "${input.name}"` : ""}.`,
          fields: [{ label: "Goal", value: gName }, ...(input.name ? [{ label: "New name", value: input.name }] : [])],
        });
      }),
  );

  server.registerTool(
    "proposeArchiveGoal",
    {
      description: "Propose archiving a savings goal. The goal is hidden but its history is retained. Does NOT archive -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeArchiveGoalSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeArchiveGoal", "write", async () => {
        const input = proposeArchiveGoalSchema.parse(rawInput);
        const gName = await goalName(ctx, input.goalId);
        return proposeCommand(ctx, "mcp", "archiveGoal", input, {
          summary: `Archive goal "${gName}".`,
          fields: [{ label: "Goal", value: gName }],
        });
      }),
  );

  server.registerTool(
    "proposeWithdrawContribution",
    {
      description: "Propose withdrawing money from a savings goal back into an account. Does NOT move any money -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeWithdrawContributionSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeWithdrawContribution", "write", async () => {
        const input = proposeWithdrawContributionSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [gName, accName] = await Promise.all([goalName(ctx, input.goalId), accountName(ctx, input.accountId)]);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "withdrawContribution", input, {
          summary: `Withdraw ${amountText} from goal "${gName}" back into ${accName}.`,
          fields: [
            { label: "Goal", value: gName },
            { label: "To account", value: accName },
            { label: "Amount", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateBudget",
    {
      description: "Propose updating a budget's monthly limit. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateBudgetSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateBudget", "write", async () => {
        const input = proposeUpdateBudgetSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const budget = await getBudget(ctx, input.budgetId);
        const catName = budget ? await categoryName(ctx, budget.category_id) : input.budgetId;
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "updateBudget", input, {
          summary: `Update budget for ${catName} to ${amountText}/month.`,
          fields: [
            { label: "Category", value: catName },
            { label: "New limit", value: amountText },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteBudget",
    {
      description: "Propose deleting a budget. Does NOT delete -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeDeleteBudgetSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteBudget", "write", async () => {
        const input = proposeDeleteBudgetSchema.parse(rawInput);
        const budget = await getBudget(ctx, input.budgetId);
        const catName = budget ? await categoryName(ctx, budget.category_id) : input.budgetId;
        return proposeCommand(ctx, "mcp", "deleteBudget", input, {
          summary: `Delete budget for ${catName}.`,
          fields: [{ label: "Category", value: catName }],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateProfile",
    {
      description: "Propose updating the user's display name, preferred currency, or timezone. Does NOT update -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdateProfileSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateProfile", "write", async () => {
        const input = proposeUpdateProfileSchema.parse(rawInput);
        const fields: ProposalPreviewField[] = [];
        if (input.displayName !== undefined) fields.push({ label: "Display name", value: input.displayName ?? "(clear)" });
        if (input.preferredCurrency !== undefined) fields.push({ label: "Currency", value: input.preferredCurrency });
        if (input.timezone !== undefined) fields.push({ label: "Timezone", value: input.timezone });
        return proposeCommand(ctx, "mcp", "updateProfile", input, {
          summary: `Update profile settings.`,
          fields,
        });
      }),
  );

  server.registerTool(
    "proposeUpdatePrivacyMode",
    {
      description: "Propose enabling or disabling Privacy Mode (hides monetary amounts from AI tools). Does NOT change the setting -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeUpdatePrivacyModeSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdatePrivacyMode", "write", async () => {
        const input = proposeUpdatePrivacyModeSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "updatePrivacyMode", input, {
          summary: `${input.enabled ? "Enable" : "Disable"} Privacy Mode.`,
          fields: [{ label: "Privacy Mode", value: input.enabled ? "ON" : "OFF" }],
        });
      }),
  );

  server.registerTool(
    "proposeAcceptGmailCandidate",
    {
      description:
        "Propose accepting a Gmail-extracted financial candidate as a real transaction. The candidate must already have an account, category, amount, date, and direction set (use listGmailCandidates to check). Does NOT create the transaction -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeAcceptGmailCandidateSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeAcceptGmailCandidate", "write", async () => {
        const input = proposeAcceptGmailCandidateSchema.parse(rawInput);
        const candidate = await getGmailCandidateQuery(ctx, input.candidateId);
        if (!candidate) throw new Error("Gmail candidate not found.");
        if (candidate.reviewStatus !== "pending" && candidate.reviewStatus !== "edited") throw new Error("This Gmail candidate has already been reviewed.");
        if (!candidate.direction || candidate.direction === "transfer") throw new Error("Set the direction (income or expense) before accepting.");
        if (!candidate.accountId) throw new Error("Set the account before accepting.");
        if (!candidate.suggestedCategoryId) throw new Error("Set the category before accepting.");
        if (!candidate.normalizedAmountMinor || !candidate.normalizedDate) throw new Error("The candidate is missing an amount or date.");
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName] = await Promise.all([accountName(ctx, candidate.accountId), categoryName(ctx, candidate.suggestedCategoryId)]);
        const amountText = describeAmountForProvider(candidate.normalizedAmountMinor, "INR", privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "acceptGmailCandidate", input, {
          summary: `Accept Gmail candidate as a ${candidate.direction}${candidate.normalizedMerchant ? ` at "${candidate.normalizedMerchant}"` : ""}: ${amountText} on ${accName}, category ${catName}.`,
          fields: [
            { label: "Type", value: candidate.direction },
            { label: "Account", value: accName },
            { label: "Category", value: catName },
            { label: "Amount", value: amountText },
            { label: "Date", value: candidate.normalizedDate },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeRejectGmailCandidate",
    {
      description: "Propose rejecting a Gmail-extracted financial candidate (mark it as not a real transaction). Does NOT reject -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeRejectGmailCandidateSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeRejectGmailCandidate", "write", async () => {
        const input = proposeRejectGmailCandidateSchema.parse(rawInput);
        const candidate = await getGmailCandidateQuery(ctx, input.candidateId);
        if (!candidate) throw new Error("Gmail candidate not found.");
        return proposeCommand(ctx, "mcp", "rejectGmailCandidate", input, {
          summary: `Reject Gmail candidate${candidate.normalizedMerchant ? ` "${candidate.normalizedMerchant}"` : ""} as not a real transaction.`,
          fields: [{ label: "Candidate", value: candidate.normalizedMerchant ?? input.candidateId }],
        });
      }),
  );

  server.registerTool(
    "proposeRevokeMcpSession",
    {
      description:
        "Propose revoking an MCP session. The current session cannot revoke itself. Use listMcpSessions to find session IDs. Does NOT revoke -- creates a proposal; the user must confirm via confirmPendingAction.",
      inputSchema: proposeRevokeMcpSessionSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeRevokeMcpSession", "write", async () => {
        const input = proposeRevokeMcpSessionSchema.parse(rawInput);
        if (input.sessionId === ctx.mcpSessionId) {
          throw new Error("A session cannot revoke itself. Use a different MCP client to revoke this session.");
        }
        const sessions = await listMcpSessions(ctx);
        const session = sessions.find((s) => s.id === input.sessionId);
        if (!session) throw new Error("MCP session not found.");
        return proposeCommand(ctx, "mcp", "revokeMcpSession", input, {
          summary: `Revoke MCP session "${session.clientName}" (created ${session.createdAt}).`,
          fields: [
            { label: "Session", value: session.clientName },
            { label: "Created", value: session.createdAt },
          ],
        });
      }),
  );

  // ── confirmPendingAction + cancelPendingAction (Phase 18, UNCHANGED) ──

  server.registerTool(
    "confirmPendingAction",
    {
      description: "Confirm a previously-proposed action, actually committing the mutation. Only call this AFTER the human user has reviewed the proposal's preview and explicitly approved it -- never automatically after proposing, and never because the user's message merely sounds like agreement.",
      inputSchema: { confirmationId: z.string() },
    },
    async (rawInput: { confirmationId: string }) =>
      runScopedTool(ctx, "confirmPendingAction", "write", async () => {
        const input = confirmCommandSchema.parse(rawInput);
        const result = await confirmCommand(ctx, input.confirmationId, "mcp");
        if (!result.ok) throw mcpErrorFromConfirmResult(result.error.code, result.error.message);
        return result.result;
      }),
  );

  server.registerTool(
    "cancelPendingAction",
    { description: "Cancel a previously-proposed action without confirming it. The proposal is discarded; nothing was ever mutated.", inputSchema: { confirmationId: z.string() } },
    async (rawInput: { confirmationId: string }) =>
      runScopedTool(ctx, "cancelPendingAction", "write", async () => {
        const input = cancelCommandSchema.parse(rawInput);
        await cancelPendingCommand(ctx, input.confirmationId);
        return { cancelled: true };
      }),
  );
}

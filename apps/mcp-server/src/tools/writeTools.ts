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
  createGoalContributionPlanSchema,
  updateGoalContributionPlanSchema,
  proposeCreateCommitmentSchema,
  proposeUpdateCommitmentSchema,
  proposeReserveCommitmentSchema,
  proposeSkipCommitmentOccurrenceSchema,
  proposeMarkCommitmentPaidSchema,
  proposePauseCommitmentSchema,
  proposeResumeCommitmentSchema,
  proposeDeleteCommitmentSchema,
  proposeCreateLoanSchema,
  proposeUpdateLoanSchema,
  proposeDeleteLoanSchema,
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
  getGoalContributionPlanById,
  calculateNextOccurrence,
  FREQUENCY_LABELS,
  listCommitments,
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

function buildExpenseIncomePreview(kind: "expense" | "income", accName: string, catName: string, amountMinor: number, occurredAt: string, privacyModeEnabled: boolean): { summary: string; fields: ProposalPreviewField[] } {
  const amountText = describeAmountForProvider(amountMinor, "INR", privacyModeEnabled);
  return {
    summary: `Record a ${amountText} ${kind} on ${accName}, category ${catName}.`,
    fields: [
      { label: "Type", value: kind === "expense" ? "Expense" : "Income" },
      { label: "Account", value: accName },
      { label: "Category", value: catName },
      { label: "Amount", value: amountText },
      { label: "Date & time", value: occurredAt },
    ],
  };
}

export function registerWriteTools(server: McpServer, ctx: McpAuthContext): void {
  // ── Existing 6 propose tools + confirm + cancel (Phase 18, UNCHANGED) ─

  server.registerTool(
    "proposeAddExpense",
    { description: "Propose recording a new expense. This does NOT create the transaction -- it only creates a proposal; the user must confirm via confirmPendingAction before anything is recorded. occurredAt: use a full ISO 8601 timestamp with timezone offset when the user gives a specific time, e.g. '2026-09-12T20:20:00+05:30' for 8:20 PM IST. Use YYYY-MM-DD date-only when no time was mentioned.", inputSchema: proposeAddExpenseSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeAddExpense", "write", async () => {
        const input = proposeAddExpenseSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
        const preview = buildExpenseIncomePreview("expense", accName, catName, input.amountMinor, input.occurredAt, privacyModeEnabled);
        return proposeCommand(ctx, "mcp", "createTransaction", { ...input, type: "expense" }, preview);
      }),
  );

  server.registerTool(
    "proposeAddIncome",
    { description: "Propose recording new income. This does NOT create the transaction -- it only creates a proposal; the user must confirm via confirmPendingAction. occurredAt: use a full ISO 8601 timestamp with timezone offset when the user gives a specific time, e.g. '2026-09-12T20:20:00+05:30' for 8:20 PM IST. Use YYYY-MM-DD date-only when no time was mentioned.", inputSchema: proposeAddIncomeSchema.shape },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeAddIncome", "write", async () => {
        const input = proposeAddIncomeSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);
        const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
        const preview = buildExpenseIncomePreview("income", accName, catName, input.amountMinor, input.occurredAt, privacyModeEnabled);
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
        "Propose editing an existing income or expense transaction. PATCH semantics: only supply the fields you want to change — everything else is preserved from the existing transaction. Only transactionId is required. Transfers cannot be edited; delete and recreate them. occurredAt: use a full ISO 8601 timestamp with timezone offset to preserve time-of-day, e.g. '2026-09-12T20:20:00+05:30'. Never default to the current time; omit occurredAt entirely if the user did not mention a new time.",
      inputSchema: proposeUpdateTransactionSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateTransaction", "write", async () => {
        const input = proposeUpdateTransactionSchema.parse(rawInput);
        const privacyModeEnabled = await isPrivacyModeEnabled(ctx);

        // Load existing transaction to fill in fields the AI did not provide.
        const txn = await getTransaction(ctx, input.transactionId);
        if (!txn) throw new Error(`Transaction ${input.transactionId} not found.`);

        // Merge: AI-supplied fields win; existing transaction fields are the fallback.
        // account_id / category_id / amount_minor / occurred_at are never null on a
        // valid transaction row, so the non-null cast is safe.
        const mergedAccountId = (input.accountId ?? txn.account_id) as string;
        const mergedCategoryId = (input.categoryId ?? txn.category_id) as string;
        const mergedAmountMinor = (input.amountMinor ?? txn.amount_minor) as number;
        const mergedOccurredAt = (input.occurredAt ?? txn.occurred_at) as string;
        const mergedItemName = input.itemName !== undefined ? input.itemName : (txn.item_name ?? undefined);
        const mergedMerchant = input.merchant !== undefined ? input.merchant : (txn.merchant ?? undefined);
        const mergedDescription = input.description !== undefined ? input.description : (txn.description ?? undefined);

        const merged = {
          transactionId: input.transactionId,
          accountId: mergedAccountId,
          categoryId: mergedCategoryId,
          amountMinor: mergedAmountMinor,
          occurredAt: mergedOccurredAt,
          itemName: mergedItemName,
          merchant: mergedMerchant,
          description: mergedDescription,
        };

        const [accName, catName] = await Promise.all([accountName(ctx, mergedAccountId), categoryName(ctx, mergedCategoryId)]);
        const amountText = describeAmountForProvider(mergedAmountMinor, "INR", privacyModeEnabled);
        const label = txn.item_name ?? txn.merchant ?? txn.id;
        return proposeCommand(ctx, "mcp", "updateTransaction", merged, {
          summary: `Update transaction "${label}": ${amountText} on ${accName}, category ${catName}.`,
          fields: [
            { label: "Transaction", value: label },
            { label: "Account", value: accName },
            { label: "Category", value: catName },
            { label: "Amount", value: amountText },
            { label: "Date & time", value: mergedOccurredAt },
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
          summary: `Delete transaction ${txn ? `"${txn.item_name ?? txn.merchant ?? txn.id}"` : input.transactionId}.`,
          fields: [{ label: "Transaction", value: txn?.item_name ?? txn?.merchant ?? input.transactionId }],
        });
      }),
  );

  server.registerTool(
    "proposeTransfer",
    {
      description: "Propose transferring money between two accounts atomically. Does NOT move any money -- creates a proposal; the user must confirm via confirmPendingAction. occurredAt: use a full ISO 8601 timestamp with timezone offset when the user gives a specific time, e.g. '2026-09-12T20:20:00+05:30' for 8:20 PM IST. Use YYYY-MM-DD date-only when no time was mentioned.",
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

  // ── Goal Contribution Plan tools (planning only, no money movement) ──
  // These use the same propose → confirm architecture as all other write
  // tools. Plans are not financial operations but still impact the user's
  // planning state, so user approval is required before execution.

  server.registerTool(
    "proposeCreateGoalContributionPlan",
    {
      description:
        "Create a contribution plan (reminder schedule) for a savings goal. PLANNING ONLY — does NOT move money or make automatic transfers. Sets up a reminder schedule so the user is notified when it is time to make a contribution. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: {
        goalId: z.string().uuid(),
        frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"]),
        amountMinor: z.number().int().positive(),
        anchorDay: z.number().int().min(1).max(31).optional(),
        timezone: z.string().optional(),
        startDate: z.string().optional(),
      },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateGoalContributionPlan", "write", async () => {
        const input = createGoalContributionPlanSchema.parse(rawInput);
        const privacyMode = await isPrivacyModeEnabled(ctx);
        const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyMode);
        const gName = await goalName(ctx, input.goalId);
        const nextDueAt = calculateNextOccurrence(input.frequency, input.anchorDay ?? null, null);
        const freqLabel = FREQUENCY_LABELS[input.frequency];
        return proposeCommand(ctx, "mcp", "createGoalContributionPlan", {
          goalId: input.goalId,
          frequency: input.frequency,
          amountMinor: input.amountMinor,
          anchorDay: input.anchorDay ?? null,
          timezone: input.timezone ?? "Asia/Kolkata",
          startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
          nextDueAt: nextDueAt.toISOString(),
        }, {
          summary: `Set up a ${freqLabel} contribution plan of ${amountText} for goal "${gName}". Reminder only — no automatic transfers.`,
          fields: [
            { label: "Goal", value: gName },
            { label: "Frequency", value: freqLabel },
            { label: "Amount per period", value: amountText },
            { label: "First reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateGoalContributionPlan",
    {
      description: "Update an existing contribution plan (reminder schedule). Only changes the reminder schedule — no money moves. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: {
        planId: z.string().uuid(),
        frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"]).optional(),
        amountMinor: z.number().int().positive().optional(),
        anchorDay: z.number().int().min(1).max(31).optional(),
        timezone: z.string().optional(),
      },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateGoalContributionPlan", "write", async () => {
        const { planId, frequency, amountMinor, anchorDay, timezone } = rawInput as { planId: string; frequency?: string; amountMinor?: number; anchorDay?: number; timezone?: string };
        const privacyMode = await isPrivacyModeEnabled(ctx);
        const existingPlan = await getGoalContributionPlanById(ctx, planId);
        const effectiveFrequency = (frequency ?? existingPlan?.frequency ?? "monthly") as Parameters<typeof calculateNextOccurrence>[0];
        const effectiveAnchorDay = anchorDay ?? existingPlan?.anchor_day ?? null;
        const nextDueAt = calculateNextOccurrence(effectiveFrequency, effectiveAnchorDay, null);
        const effectiveAmount = amountMinor ?? existingPlan?.amount_minor;
        const amountText = effectiveAmount ? describeAmountForProvider(effectiveAmount, "INR", privacyMode) : "unchanged";
        const freqLabel = FREQUENCY_LABELS[effectiveFrequency];
        const payload: Record<string, unknown> = { planId, nextDueAt: nextDueAt.toISOString() };
        if (frequency) payload.frequency = frequency;
        if (amountMinor) payload.amountMinor = amountMinor;
        if (anchorDay !== undefined) payload.anchorDay = anchorDay;
        if (timezone) payload.timezone = timezone;
        return proposeCommand(ctx, "mcp", "updateGoalContributionPlan", payload, {
          summary: `Update contribution plan to ${freqLabel} ${amountText}. Reminder only — no automatic transfers.`,
          fields: [
            { label: "Frequency", value: freqLabel },
            { label: "Amount per period", value: amountText },
            { label: "Next reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
          ],
        });
      }),
  );

  server.registerTool(
    "proposePauseGoalContributionPlan",
    {
      description: "Pause a contribution plan so reminders stop temporarily. The plan can be resumed later. No money is affected. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: { planId: z.string().uuid() },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposePauseGoalContributionPlan", "write", async () => {
        const { planId } = rawInput as { planId: string };
        return proposeCommand(ctx, "mcp", "pauseGoalContributionPlan", { planId }, {
          summary: "Pause the contribution plan. Reminders will stop until you resume.",
          fields: [{ label: "Action", value: "Pause plan (reminders off)" }],
        });
      }),
  );

  server.registerTool(
    "proposeResumeGoalContributionPlan",
    {
      description: "Resume a paused contribution plan so reminders start again. No money is affected. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: { planId: z.string().uuid() },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeResumeGoalContributionPlan", "write", async () => {
        const { planId } = rawInput as { planId: string };
        const existingPlan = await getGoalContributionPlanById(ctx, planId);
        const frequency = (existingPlan?.frequency ?? "monthly") as Parameters<typeof calculateNextOccurrence>[0];
        const anchorDay = existingPlan?.anchor_day ?? null;
        const nextDueAt = calculateNextOccurrence(frequency, anchorDay, null);
        return proposeCommand(ctx, "mcp", "resumeGoalContributionPlan", { planId, nextDueAt: nextDueAt.toISOString() }, {
          summary: "Resume the contribution plan. Reminders will start again.",
          fields: [
            { label: "Action", value: "Resume plan (reminders on)" },
            { label: "Next reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteGoalContributionPlan",
    {
      description: "Delete a contribution plan entirely. Removes the reminder schedule but does NOT affect the goal's saved balance or past contributions. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: { planId: z.string().uuid() },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteGoalContributionPlan", "write", async () => {
        const { planId } = rawInput as { planId: string };
        return proposeCommand(ctx, "mcp", "deleteGoalContributionPlan", { planId }, {
          summary: "Delete the contribution plan. The goal's saved balance is unchanged.",
          fields: [{ label: "Action", value: "Remove reminder schedule (no money affected)" }],
        });
      }),
  );

  // ── Commitment write tools ───────────────────────────────────────────────

  server.registerTool(
    "proposeCreateCommitment",
    {
      description: "Propose adding a new planned commitment (insurance, rent, subscription, etc.) with an optional saving schedule. This is a PLANNING + REMINDER system only. No money is moved automatically. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeCreateCommitmentSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateCommitment", "write", async () => {
        const input = proposeCreateCommitmentSchema.parse(rawInput);
        const privacyMode = await isPrivacyModeEnabled(ctx);
        const amountText = describeAmountForProvider(input.amountMinor, input.currency ?? "INR", privacyMode);
        const accounts = await listAccounts(ctx);
        const fundingAccName = input.fundingAccountId
          ? (accounts.find((a) => a.id === input.fundingAccountId)?.name ?? "the selected account")
          : null;
        const fields: ProposalPreviewField[] = [
          { label: "Name", value: input.name },
          { label: "Amount", value: amountText + (input.amountIsEstimate ? " (estimate)" : "") },
          { label: "Payment frequency", value: input.paymentFrequency },
          { label: "Next payment", value: input.nextPaymentDate },
        ];
        if (fundingAccName) fields.push({ label: "Funding account", value: fundingAccName });
        if (input.savingCadence) {
          const saveText = input.savingAmountMinor ? describeAmountForProvider(input.savingAmountMinor, input.currency ?? "INR", privacyMode) : "?";
          fields.push({ label: "Saving schedule", value: `${saveText} ${input.savingCadence} from ${input.firstSavingDate ?? "?"}` });
        }
        return proposeCommand(ctx, "mcp", "createCommitment", input as unknown as Record<string, unknown>, {
          summary: `Create commitment "${input.name}" for ${amountText} ${input.paymentFrequency}. Planning only — no automatic transfers.`,
          fields,
        });
      }),
  );

  server.registerTool(
    "proposeUpdateCommitment",
    {
      description: "Propose updating a planned commitment. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: { commitmentId: z.string().uuid(), ...proposeUpdateCommitmentSchema.shape },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateCommitment", "write", async () => {
        const { commitmentId, ...rest } = rawInput as { commitmentId: string; [k: string]: unknown };
        const input = proposeUpdateCommitmentSchema.parse(rest);
        const commitments = await listCommitments(ctx);
        const name = commitments.find((c) => c.id === commitmentId)?.name ?? "this commitment";
        return proposeCommand(ctx, "mcp", "updateCommitment", { commitmentId, ...input } as Record<string, unknown>, {
          summary: `Update commitment "${name}".`,
          fields: [{ label: "Commitment", value: name }],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteCommitment",
    {
      description: "Propose deleting a planned commitment and all its future occurrences. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeDeleteCommitmentSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteCommitment", "write", async () => {
        const { commitmentId } = proposeDeleteCommitmentSchema.parse(rawInput);
        const commitments = await listCommitments(ctx);
        const name = commitments.find((c) => c.id === commitmentId)?.name ?? "this commitment";
        return proposeCommand(ctx, "mcp", "deleteCommitment", { commitmentId }, {
          summary: `Delete commitment "${name}". This cannot be undone.`,
          fields: [{ label: "Commitment", value: name }, { label: "Warning", value: "All future occurrences will be removed." }],
        });
      }),
  );

  server.registerTool(
    "proposePauseCommitment",
    {
      description: "Propose pausing a planned commitment so future occurrences stop generating. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposePauseCommitmentSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposePauseCommitment", "write", async () => {
        const { commitmentId } = proposePauseCommitmentSchema.parse(rawInput);
        const commitments = await listCommitments(ctx);
        const name = commitments.find((c) => c.id === commitmentId)?.name ?? "this commitment";
        return proposeCommand(ctx, "mcp", "pauseCommitment", { commitmentId }, {
          summary: `Pause commitment "${name}".`,
          fields: [{ label: "Commitment", value: name }, { label: "Action", value: "Pause (future occurrences stop)" }],
        });
      }),
  );

  server.registerTool(
    "proposeResumeCommitment",
    {
      description: "Propose resuming a paused planned commitment. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeResumeCommitmentSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeResumeCommitment", "write", async () => {
        const { commitmentId } = proposeResumeCommitmentSchema.parse(rawInput);
        const commitments = await listCommitments(ctx);
        const name = commitments.find((c) => c.id === commitmentId)?.name ?? "this commitment";
        return proposeCommand(ctx, "mcp", "resumeCommitment", { commitmentId }, {
          summary: `Resume commitment "${name}".`,
          fields: [{ label: "Commitment", value: name }, { label: "Action", value: "Resume" }],
        });
      }),
  );

  server.registerTool(
    "proposeReserveCommitment",
    {
      description: "Propose marking a portion of an account's balance as logically reserved for an upcoming commitment occurrence. This is a LOGICAL protection only. No money moves. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeReserveCommitmentSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeReserveCommitment", "write", async () => {
        const input = proposeReserveCommitmentSchema.parse(rawInput);
        const privacyMode = await isPrivacyModeEnabled(ctx);
        const amountText = describeAmountForProvider(input.reserveAmountMinor, "INR", privacyMode);
        return proposeCommand(ctx, "mcp", "reserveOccurrence", input as unknown as Record<string, unknown>, {
          summary: `Reserve ${amountText} for this commitment occurrence. Logical protection only — no actual transfer.`,
          fields: [
            { label: "Reserve amount", value: amountText },
            { label: "Note", value: "Safe to Spend will reflect this reservation." },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeSkipCommitmentOccurrence",
    {
      description: "Propose skipping one upcoming occurrence of a planned commitment. The occurrence will be marked as skipped. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeSkipCommitmentOccurrenceSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeSkipCommitmentOccurrence", "write", async () => {
        const input = proposeSkipCommitmentOccurrenceSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "skipOccurrence", input as unknown as Record<string, unknown>, {
          summary: "Skip this commitment occurrence.",
          fields: [{ label: "Action", value: "Skip (mark as skipped)" }],
        });
      }),
  );

  server.registerTool(
    "proposeMarkCommitmentPaid",
    {
      description: "Propose marking a commitment occurrence as paid (without linking a transaction). Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeMarkCommitmentPaidSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeMarkCommitmentPaid", "write", async () => {
        const input = proposeMarkCommitmentPaidSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "markOccurrencePaid", input as unknown as Record<string, unknown>, {
          summary: "Mark this commitment occurrence as paid.",
          fields: [{ label: "Action", value: "Mark as paid" }],
        });
      }),
  );

  // ── Loan write tools ─────────────────────────────────────────────────────

  server.registerTool(
    "proposeCreateLoan",
    {
      description: "Propose adding a new loan so Spencare can track installment payments. This is tracking only — no money is moved. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeCreateLoanSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeCreateLoan", "write", async () => {
        const input = proposeCreateLoanSchema.parse(rawInput);
        const privacyMode = await isPrivacyModeEnabled(ctx);
        const principalText = describeAmountForProvider(input.principalMinor, input.currency ?? "INR", privacyMode);
        const installText = describeAmountForProvider(input.installmentAmountMinor, input.currency ?? "INR", privacyMode);
        return proposeCommand(ctx, "mcp", "createLoan", input as unknown as Record<string, unknown>, {
          summary: `Add loan "${input.name}" — principal ${principalText}, installment ${installText} ${input.repaymentFrequency}.`,
          fields: [
            { label: "Name", value: input.name },
            { label: "Type", value: input.loanType ?? "personal" },
            { label: "Principal", value: principalText },
            { label: "Installment", value: installText },
            { label: "Frequency", value: input.repaymentFrequency },
          ],
        });
      }),
  );

  server.registerTool(
    "proposeUpdateLoan",
    {
      description: "Propose updating a loan's details. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: { loanId: z.string().uuid(), ...proposeUpdateLoanSchema.shape },
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeUpdateLoan", "write", async () => {
        const { loanId, ...rest } = rawInput as { loanId: string; [k: string]: unknown };
        const input = proposeUpdateLoanSchema.parse(rest);
        return proposeCommand(ctx, "mcp", "updateLoan", { loanId, ...input } as Record<string, unknown>, {
          summary: "Update loan details.",
          fields: [{ label: "Loan ID", value: loanId }],
        });
      }),
  );

  server.registerTool(
    "proposeDeleteLoan",
    {
      description: "Propose deleting a loan record. Returns a proposal the user must confirm via confirmPendingAction.",
      inputSchema: proposeDeleteLoanSchema.shape,
    },
    async (rawInput: unknown) =>
      runScopedTool(ctx, "proposeDeleteLoan", "write", async () => {
        const { loanId } = proposeDeleteLoanSchema.parse(rawInput);
        return proposeCommand(ctx, "mcp", "deleteLoan", { loanId }, {
          summary: "Delete this loan record. This cannot be undone.",
          fields: [{ label: "Action", value: "Delete loan" }],
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

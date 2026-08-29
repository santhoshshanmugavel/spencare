import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  proposeAddExpenseSchema,
  proposeAddIncomeSchema,
  proposeGoalContributionSchema,
  proposeMarkBillPaidSchema,
  proposeCreateBudgetSchema,
  proposeCreateGoalSchema,
  confirmCommandSchema,
  cancelCommandSchema,
} from "@spencare/validation";
import {
  listAccounts,
  listCategories,
  listGoals,
  listBillPredictions,
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
 * Write tools (Phase 18 §12-13). LOCKED: every one is `propose*`-only --
 * there is no tool here that commits a mutation. The actual mutation only
 * happens via the separate `confirmPendingAction` tool, which the MCP
 * client is responsible for calling only after surfacing the returned
 * preview to a human (mcp-architecture.md §4/§5 -- Spencare's server
 * cannot verify that happened, the same limit Spensa has). Natural
 * language in a tool argument ("yes", "confirmed", etc.) is never
 * interpreted as authorization -- only an explicit `confirmPendingAction`
 * tool CALL, naming a real `confirmationId`, can ever commit anything.
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

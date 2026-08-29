import type { AuthContext } from "@spencare/domain-application";
import {
  proposeAddExpenseSchema,
  proposeAddIncomeSchema,
  proposeGoalContributionSchema,
  proposeMarkBillPaidSchema,
  proposeCreateBudgetSchema,
  proposeCreateGoalSchema,
} from "@spencare/validation";
import { listAccounts, listCategories, listGoals, listBillPredictions } from "@spencare/domain-application";
import type { ToolDefinition } from "../provider.js";
import { proposeCommand, describeAmountForProvider, type ProposalResult, type ProposalPreviewField } from "../confirmation.js";
import type { ToolHandlerContext } from "./readTools.js";

export interface WriteToolHandler {
  definition: ToolDefinition;
  execute: (ctx: ToolHandlerContext, input: unknown) => Promise<ProposalResult>;
}

/**
 * Write tools (ai-architecture.md §4). LOCKED: every one of these is
 * `propose*`-only -- there is no tool signature in this file that commits
 * a mutation. Each handler validates with the SAME shared Zod schema its
 * Web-UI command already uses, resolves the human-readable entity names
 * needed for an honest preview (never a second financial calculation --
 * just names, for "which account/category/goal" clarity), and calls
 * `proposeCommand`, which only ever inserts a `pending_confirmations` row.
 * The actual mutation happens exclusively in `confirmCommand`, after an
 * explicit user confirmation in the chat UI's `ConsequentialActionPreview`
 * -- never here, and never implicitly from any text the model generates.
 */

async function accountName(ctx: AuthContext, accountId: string): Promise<string> {
  const accounts = await listAccounts(ctx);
  return accounts.find((a) => a.id === accountId)?.name ?? "the selected account";
}

async function categoryName(ctx: AuthContext, categoryId: string): Promise<string> {
  const categories = await listCategories(ctx);
  return categories.find((c) => c.id === categoryId)?.name ?? "the selected category";
}

async function goalName(ctx: AuthContext, goalId: string): Promise<string> {
  const goals = await listGoals(ctx);
  return goals.find((g) => g.id === goalId)?.name ?? "the selected goal";
}

function buildExpenseIncomePreview(kind: "expense" | "income", accName: string, catName: string, amountMinor: number, privacyModeEnabled: boolean): { summary: string; fields: ProposalPreviewField[] } {
  const amountText = describeAmountForProvider(amountMinor, "INR", privacyModeEnabled);
  const verb = kind === "expense" ? "expense" : "income";
  return {
    summary: `Record a ${amountText} ${verb} on ${accName}, category ${catName}.`,
    fields: [
      { label: "Type", value: kind === "expense" ? "Expense" : "Income" },
      { label: "Account", value: accName },
      { label: "Category", value: catName },
      { label: "Amount", value: amountText },
    ],
  };
}

const proposeAddExpenseTool: WriteToolHandler = {
  definition: {
    name: "proposeAddExpense",
    description: "Propose recording a new expense. This does NOT create the transaction -- it only creates a proposal the user must explicitly confirm in the app before anything is recorded.",
    inputSchema: { type: "object", properties: { accountId: { type: "string" }, categoryId: { type: "string" }, amountMinor: { type: "number" }, merchant: { type: "string" }, description: { type: "string" }, occurredAt: { type: "string" } }, required: ["accountId", "categoryId", "amountMinor", "occurredAt"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeAddExpenseSchema.parse(rawInput);
    const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
    const preview = buildExpenseIncomePreview("expense", accName, catName, input.amountMinor, privacyModeEnabled);
    return proposeCommand(ctx, "createTransaction", { ...input, type: "expense" }, preview);
  },
};

const proposeAddIncomeTool: WriteToolHandler = {
  definition: {
    name: "proposeAddIncome",
    description: "Propose recording new income. This does NOT create the transaction -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { accountId: { type: "string" }, categoryId: { type: "string" }, amountMinor: { type: "number" }, merchant: { type: "string" }, description: { type: "string" }, occurredAt: { type: "string" } }, required: ["accountId", "categoryId", "amountMinor", "occurredAt"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeAddIncomeSchema.parse(rawInput);
    const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
    const preview = buildExpenseIncomePreview("income", accName, catName, input.amountMinor, privacyModeEnabled);
    return proposeCommand(ctx, "createTransaction", { ...input, type: "income" }, preview);
  },
};

const proposeGoalContributionTool: WriteToolHandler = {
  definition: {
    name: "proposeGoalContribution",
    description: "Propose contributing money toward a savings goal. This does NOT move any money -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { goalId: { type: "string" }, accountId: { type: "string" }, amountMinor: { type: "number" } }, required: ["goalId", "accountId", "amountMinor"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeGoalContributionSchema.parse(rawInput);
    const [gName, accName] = await Promise.all([goalName(ctx, input.goalId), accountName(ctx, input.accountId)]);
    const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
    return proposeCommand(ctx, "addContribution", input, {
      summary: `Contribute ${amountText} from ${accName} toward "${gName}".`,
      fields: [
        { label: "Goal", value: gName },
        { label: "From account", value: accName },
        { label: "Amount", value: amountText },
      ],
    });
  },
};

const proposeMarkBillPaidTool: WriteToolHandler = {
  definition: {
    name: "proposeMarkBillPaid",
    description: "Propose marking a predicted bill as paid, linking it to a real transaction. This does NOT create the transaction -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { predictionId: { type: "string" }, accountId: { type: "string" }, categoryId: { type: "string" }, amountMinor: { type: "number" }, occurredAt: { type: "string" }, merchant: { type: "string" }, description: { type: "string" } }, required: ["predictionId", "accountId", "categoryId", "amountMinor", "occurredAt"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeMarkBillPaidSchema.parse(rawInput);
    const [accName, catName, predictions] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId), listBillPredictions(ctx)]);
    const merchant = predictions.find((p) => p.id === input.predictionId)?.bill_definitions.merchant_pattern ?? "this bill";
    const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
    return proposeCommand(ctx, "markBillPaid", input, {
      summary: `Mark "${merchant}" as paid: ${amountText} from ${accName}, category ${catName}.`,
      fields: [
        { label: "Bill", value: merchant },
        { label: "Account", value: accName },
        { label: "Category", value: catName },
        { label: "Amount", value: amountText },
      ],
    });
  },
};

const proposeCreateBudgetTool: WriteToolHandler = {
  definition: {
    name: "proposeCreateBudget",
    description: "Propose creating a new monthly budget for a category. This does NOT create the budget -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { categoryId: { type: "string" }, amountMinor: { type: "number" }, periodStart: { type: "string" } }, required: ["categoryId", "amountMinor", "periodStart"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeCreateBudgetSchema.parse(rawInput);
    const catName = await categoryName(ctx, input.categoryId);
    const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
    return proposeCommand(ctx, "createBudget", input, {
      summary: `Create a ${amountText} monthly budget for ${catName}.`,
      fields: [
        { label: "Category", value: catName },
        { label: "Monthly limit", value: amountText },
      ],
    });
  },
};

const proposeCreateGoalTool: WriteToolHandler = {
  definition: {
    name: "proposeCreateGoal",
    description: "Propose creating a new savings goal. This does NOT create the goal -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, targetAmountMinor: { type: "number" }, targetDate: { type: "string" }, fundingAccountId: { type: "string" } }, required: ["name", "targetAmountMinor", "fundingAccountId"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeCreateGoalSchema.parse(rawInput);
    const accName = await accountName(ctx, input.fundingAccountId);
    const amountText = describeAmountForProvider(input.targetAmountMinor, "INR", privacyModeEnabled);
    return proposeCommand(ctx, "createGoal", input, {
      summary: `Create a new goal "${input.name}" with a target of ${amountText}, funded from ${accName}.`,
      fields: [
        { label: "Goal", value: input.name },
        { label: "Target", value: amountText },
        { label: "Funding account", value: accName },
      ],
    });
  },
};

export const WRITE_TOOLS: WriteToolHandler[] = [
  proposeAddExpenseTool,
  proposeAddIncomeTool,
  proposeGoalContributionTool,
  proposeMarkBillPaidTool,
  proposeCreateBudgetTool,
  proposeCreateGoalTool,
];

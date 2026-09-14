import type { AuthContext } from "@spencare/domain-application";
import {
  proposeAddExpenseSchema,
  proposeAddIncomeSchema,
  proposeGoalContributionSchema,
  proposeMarkBillPaidSchema,
  proposeCreateBudgetSchema,
  proposeCreateGoalSchema,
  proposeUpdateGoalSchema,
  createGoalContributionPlanSchema,
} from "@spencare/validation";
import { listAccounts, listCategories, listGoals, listBillPredictions, getGoalContributionPlanById, calculateNextOccurrence, FREQUENCY_LABELS } from "@spencare/domain-application";
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
    inputSchema: { type: "object", properties: { accountId: { type: "string" }, categoryId: { type: "string" }, amountMinor: { type: "number" }, itemName: { type: "string", description: "What was purchased (e.g. 'MacBook Pro', 'Netflix subscription')" }, merchant: { type: "string", description: "Store or merchant name (e.g. 'Swiggy', 'Amazon')" }, description: { type: "string", description: "Free-form note or additional context about the transaction" }, occurredAt: { type: "string" } }, required: ["accountId", "categoryId", "amountMinor", "occurredAt"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeAddExpenseSchema.parse(rawInput);
    const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
    const preview = buildExpenseIncomePreview("expense", accName, catName, input.amountMinor, privacyModeEnabled);
    return proposeCommand(ctx, "spensa", "createTransaction", { ...input, type: "expense" }, preview);
  },
};

const proposeAddIncomeTool: WriteToolHandler = {
  definition: {
    name: "proposeAddIncome",
    description: "Propose recording new income. This does NOT create the transaction -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { accountId: { type: "string" }, categoryId: { type: "string" }, amountMinor: { type: "number" }, itemName: { type: "string", description: "What the income is for (e.g. 'Salary', 'Freelance project')" }, merchant: { type: "string", description: "Source or payer name (e.g. 'Acme Corp', 'Client XYZ')" }, description: { type: "string", description: "Free-form note or additional context about the income" }, occurredAt: { type: "string" } }, required: ["accountId", "categoryId", "amountMinor", "occurredAt"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeAddIncomeSchema.parse(rawInput);
    const [accName, catName] = await Promise.all([accountName(ctx, input.accountId), categoryName(ctx, input.categoryId)]);
    const preview = buildExpenseIncomePreview("income", accName, catName, input.amountMinor, privacyModeEnabled);
    return proposeCommand(ctx, "spensa", "createTransaction", { ...input, type: "income" }, preview);
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
    return proposeCommand(ctx, "spensa", "addContribution", input, {
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
    return proposeCommand(ctx, "spensa", "markBillPaid", input, {
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
    return proposeCommand(ctx, "spensa", "createBudget", input, {
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
    return proposeCommand(ctx, "spensa", "createGoal", input, {
      summary: `Create a new goal "${input.name}" with a target of ${amountText}, funded from ${accName}.`,
      fields: [
        { label: "Goal", value: input.name },
        { label: "Target", value: amountText },
        { label: "Funding account", value: accName },
      ],
    });
  },
};

const proposeUpdateGoalTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdateGoal",
    description: "Propose updating an existing savings goal's name, target amount, target date, or funding account. Does NOT create the update -- only creates a proposal the user must confirm.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        name: { type: "string" },
        targetAmountMinor: { type: "number" },
        targetDate: { type: "string" },
        fundingAccountId: { type: "string" },
      },
      required: ["goalId"],
    },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = proposeUpdateGoalSchema.parse(rawInput);
    const gName = await goalName(ctx, input.goalId);
    const amountText = input.targetAmountMinor ? describeAmountForProvider(input.targetAmountMinor, "INR", privacyModeEnabled) : null;
    const fields: ProposalPreviewField[] = [{ label: "Goal", value: gName }];
    if (input.name) fields.push({ label: "New name", value: input.name });
    if (amountText) fields.push({ label: "New target", value: amountText });
    if (input.targetDate) fields.push({ label: "Target date", value: input.targetDate });
    return proposeCommand(ctx, "spensa", "updateGoal", input, {
      summary: `Update "${gName}"${amountText ? ` — new target: ${amountText}` : ""}.`,
      fields,
    });
  },
};

const proposeCreateGoalContributionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposeCreateGoalContributionPlan",
    description: "Propose setting up a contribution reminder plan for a savings goal. This is a PLANNING + REMINDER system only — no money moves automatically. The user must manually record each contribution. Only creates a proposal the user must confirm.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        frequency: { type: "string", enum: ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"] },
        amountMinor: { type: "number" },
        anchorDay: { type: "number" },
        timezone: { type: "string" },
        startDate: { type: "string" },
      },
      required: ["goalId", "frequency", "amountMinor"],
    },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const input = createGoalContributionPlanSchema.parse(rawInput);
    const gName = await goalName(ctx, input.goalId);
    const amountText = describeAmountForProvider(input.amountMinor, "INR", privacyModeEnabled);
    const nextDueAt = calculateNextOccurrence(input.frequency, input.anchorDay ?? null, null);
    const freqLabel = FREQUENCY_LABELS[input.frequency];
    return proposeCommand(ctx, "spensa", "createGoalContributionPlan", {
      goalId: input.goalId,
      frequency: input.frequency,
      amountMinor: input.amountMinor,
      anchorDay: input.anchorDay ?? null,
      timezone: input.timezone ?? "Asia/Kolkata",
      startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
      nextDueAt: nextDueAt.toISOString(),
    }, {
      summary: `Set up a ${freqLabel} reminder of ${amountText} for "${gName}". Reminder only — no automatic transfers.`,
      fields: [
        { label: "Goal", value: gName },
        { label: "Frequency", value: freqLabel },
        { label: "Amount per period", value: amountText },
        { label: "First reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
      ],
    });
  },
};

const proposeUpdateGoalContributionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdateGoalContributionPlan",
    description: "Propose updating a contribution reminder plan. Only changes the reminder schedule — no money moves. Only creates a proposal the user must confirm.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string" },
        frequency: { type: "string", enum: ["daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly"] },
        amountMinor: { type: "number" },
        anchorDay: { type: "number" },
        timezone: { type: "string" },
      },
      required: ["planId"],
    },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const { planId, frequency, amountMinor, anchorDay, timezone } = rawInput as { planId: string; frequency?: string; amountMinor?: number; anchorDay?: number; timezone?: string };
    const existingPlan = await getGoalContributionPlanById(ctx, planId);
    const effectiveFrequency = (frequency ?? existingPlan?.frequency ?? "monthly") as Parameters<typeof calculateNextOccurrence>[0];
    const effectiveAnchorDay = anchorDay ?? existingPlan?.anchor_day ?? null;
    const nextDueAt = calculateNextOccurrence(effectiveFrequency, effectiveAnchorDay, null);
    const effectiveAmount = amountMinor ?? existingPlan?.amount_minor;
    const amountText = effectiveAmount ? describeAmountForProvider(effectiveAmount, "INR", privacyModeEnabled) : "unchanged";
    const freqLabel = FREQUENCY_LABELS[effectiveFrequency];
    const payload: Record<string, unknown> = { planId, nextDueAt: nextDueAt.toISOString() };
    if (frequency) payload.frequency = frequency;
    if (amountMinor) payload.amountMinor = amountMinor;
    if (anchorDay !== undefined) payload.anchorDay = anchorDay;
    if (timezone) payload.timezone = timezone;
    return proposeCommand(ctx, "spensa", "updateGoalContributionPlan", payload, {
      summary: `Update contribution plan to ${freqLabel} ${amountText}. Reminder only — no automatic transfers.`,
      fields: [
        { label: "Frequency", value: freqLabel },
        { label: "Amount per period", value: amountText },
        { label: "Next reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
      ],
    });
  },
};

const proposePauseGoalContributionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposePauseGoalContributionPlan",
    description: "Propose pausing a contribution reminder plan so reminders stop temporarily. No money is affected. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
  },
  execute: async ({ ctx }, rawInput) => {
    const { planId } = rawInput as { planId: string };
    return proposeCommand(ctx, "spensa", "pauseGoalContributionPlan", { planId }, {
      summary: "Pause the contribution plan. Reminders will stop until you resume.",
      fields: [{ label: "Action", value: "Pause plan (reminders off)" }],
    });
  },
};

const proposeResumeGoalContributionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposeResumeGoalContributionPlan",
    description: "Propose resuming a paused contribution reminder plan. No money is affected. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
  },
  execute: async ({ ctx }, rawInput) => {
    const { planId } = rawInput as { planId: string };
    const existingPlan = await getGoalContributionPlanById(ctx, planId);
    const frequency = (existingPlan?.frequency ?? "monthly") as Parameters<typeof calculateNextOccurrence>[0];
    const anchorDay = existingPlan?.anchor_day ?? null;
    const nextDueAt = calculateNextOccurrence(frequency, anchorDay, null);
    return proposeCommand(ctx, "spensa", "resumeGoalContributionPlan", { planId, nextDueAt: nextDueAt.toISOString() }, {
      summary: "Resume the contribution plan. Reminders will start again.",
      fields: [
        { label: "Action", value: "Resume plan (reminders on)" },
        { label: "Next reminder", value: nextDueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
      ],
    });
  },
};

const proposeDeleteGoalContributionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposeDeleteGoalContributionPlan",
    description: "Propose deleting a contribution reminder plan entirely. Removes the reminder schedule but does NOT affect the goal's saved balance or past contributions. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
  },
  execute: async ({ ctx }, rawInput) => {
    const { planId } = rawInput as { planId: string };
    return proposeCommand(ctx, "spensa", "deleteGoalContributionPlan", { planId }, {
      summary: "Delete the contribution plan. The goal's saved balance is unchanged.",
      fields: [{ label: "Action", value: "Remove reminder schedule (no money affected)" }],
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
  proposeUpdateGoalTool,
  proposeCreateGoalContributionPlanTool,
  proposeUpdateGoalContributionPlanTool,
  proposePauseGoalContributionPlanTool,
  proposeResumeGoalContributionPlanTool,
  proposeDeleteGoalContributionPlanTool,
];

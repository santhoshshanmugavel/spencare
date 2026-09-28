import {
  listPlansWithSummaries,
  listGoals,
  listCommitments,
  listAccounts,
  getPlan,
  type AuthContext,
} from "@spencare/domain-application";
import {
  createFinancialPlanSchema,
  updateFinancialPlanSchema,
  setPlanBudgetSchema,
  transitionPlanStatusSchema,
  createPlanItemSchema,
  updatePlanItemSchema,
  transitionPlanItemStatusSchema,
  planGoalLinkSchema,
  planCommitmentLinkSchema,
  planAccountLinkSchema,
  setTransactionPlanSchema,
} from "@spencare/validation";
import { buildPlanContext } from "../planContext.js";
import { proposeCommand, describeAmountForProvider, type ProposalResult, type ProposalPreviewField } from "../confirmation.js";
import type { ReadToolHandler } from "./readTools.js";
import type { WriteToolHandler } from "./writeTools.js";

/**
 * Plan read tools (Gate 10). Read-only, deterministic, exactly like every
 * other tool in readTools.ts -- no confirmation cascade, since nothing
 * here mutates anything. Two tools, not one-per-facet, mirroring the
 * existing getGoalProgress (lightweight, all goals) / getGoalDetail
 * (comprehensive, one goal) pairing rather than inventing eight separate
 * granular tools that would each re-fetch overlapping Plan data -- that
 * would be more queries per Plan question, not fewer, and Gate 10's own
 * "avoid N+1, batch independent reads" instruction argues directly against
 * it. `getPlanDetail` (below) already returns every facet Gate 10 asks
 * for in one call: items, linked Goals/Commitments/Accounts, and
 * Plan-scoped transactions (via the canonical `listTransactionsForPlan`,
 * filtered by `plan_id` -- never inferred from a merchant name).
 *
 * Plan write tools (Gate 11). Gate 10 left these unregistered because the
 * confirmation cascade's execution step (`confirm_command`, a SECURITY
 * DEFINER SQL function) had no dispatch branch for any Plan command type.
 * Gate 11's migration added those branches, mirroring
 * packages/domain/application/src/commands/plans.ts (Gate 3) exactly --
 * so these tools now exist, following the identical propose-only pattern
 * every other write tool in this package already uses: validate with the
 * same Zod schema the web UI's own command uses, build an honest preview,
 * call `proposeCommand`, and stop. The actual mutation happens exclusively
 * in `confirmCommand`, after an explicit user confirmation -- never here.
 */

async function planName(ctx: AuthContext, planId: string): Promise<string> {
  const plan = await getPlan(ctx, planId);
  return plan?.name ?? "the selected Plan";
}

async function goalNameFor(ctx: AuthContext, goalId: string): Promise<string> {
  const goals = await listGoals(ctx);
  return goals.find((g) => g.id === goalId)?.name ?? "the selected goal";
}

async function commitmentNameFor(ctx: AuthContext, commitmentId: string): Promise<string> {
  const commitments = await listCommitments(ctx);
  return commitments.find((c) => c.id === commitmentId)?.name ?? "the selected commitment";
}

async function accountNameFor(ctx: AuthContext, accountId: string): Promise<string> {
  const accounts = await listAccounts(ctx);
  return accounts.find((a) => a.id === accountId)?.name ?? "the selected account";
}

const getPlansTool: ReadToolHandler = {
  definition: {
    name: "getPlans",
    description:
      "List the user's financial Plans (real-life purpose containers such as a trip, wedding, or renovation) with a lightweight actual-vs-budget summary for each. A Plan is different from a Budget (a spending limit), a Goal (a savings target), and a Commitment (an obligated future payment) -- use this only when the user asks about a Plan by name or asks what Plans exist.",
    inputSchema: { type: "object", properties: {} },
  },
  execute: async ({ ctx, privacyModeEnabled }) => {
    const asOfIso = new Date().toISOString().slice(0, 10);
    const summaries = await listPlansWithSummaries(ctx, asOfIso);
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
  },
};

const getPlanDetailTool: ReadToolHandler = {
  definition: {
    name: "getPlanDetail",
    description:
      "Get full detail for a single financial Plan by id: budget, actual spend (from real transactions), planned/committed/upcoming amounts, remaining budget, variance, progress, over-budget state, every Plan Item with its own status and estimated amount, and the Goals/Commitments/Accounts linked to this Plan. Every figure is labeled with its source (ACTUAL, USER_DEFINED, or CALCULATED) -- never present one as another. Use getPlans first if you do not already have the Plan's id.",
    inputSchema: { type: "object", properties: { planId: { type: "string", description: "UUID of the Plan" } }, required: ["planId"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput) => {
    const { planId } = rawInput as { planId?: string };
    if (!planId || typeof planId !== "string") {
      return { error: "A planId is required." };
    }
    const context = await buildPlanContext(ctx, planId, privacyModeEnabled);
    if (!context) {
      // Structurally identical whether the Plan does not exist or belongs
      // to a different user -- getPlanDetail (the canonical query) already
      // scopes by user_id before returning, so a cross-user id can never
      // reach this far with real data attached. Never a different error
      // message for "not yours" vs "doesn't exist" -- that itself would
      // leak existence.
      return { error: "Plan not found." };
    }
    return context;
  },
};

export const PLAN_TOOLS: ReadToolHandler[] = [getPlansTool, getPlanDetailTool];

const proposeCreatePlanTool: WriteToolHandler = {
  definition: {
    name: "proposeCreatePlan",
    description: "Propose creating a new financial Plan -- a real-life purpose container such as a trip, wedding, or renovation. This does NOT create the Plan -- it only creates a proposal the user must explicitly confirm.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, baseCurrency: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["name", "baseCurrency"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const input = createFinancialPlanSchema.parse(rawInput);
    return proposeCommand(ctx, "spensa", "createPlan", input as unknown as Record<string, unknown>, {
      summary: `Create a new Plan "${input.name}" in ${input.baseCurrency}.`,
      fields: [
        { label: "Name", value: input.name },
        { label: "Currency", value: input.baseCurrency },
      ],
    });
  },
};

const proposeUpdatePlanTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdatePlan",
    description: "Propose updating a Plan's name, description, or dates. Does not create the update -- only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, name: { type: "string" }, description: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["planId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, ...rest } = rawInput as { planId: string; [k: string]: unknown };
    const input = updateFinancialPlanSchema.parse(rest);
    const pName = await planName(ctx, planId);
    return proposeCommand(ctx, "spensa", "updatePlan", { planId, ...input } as Record<string, unknown>, {
      summary: `Update "${pName}".`,
      fields: [{ label: "Plan", value: pName }],
    });
  },
};

const proposeUpdatePlanBudgetTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdatePlanBudget",
    description: "Propose setting or clearing a Plan's budget (pass null to remove it). This never touches actual spend, account balances, or transactions. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, budgetMinor: { type: "number" } }, required: ["planId"] },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput): Promise<ProposalResult> => {
    const { planId, budgetMinor } = rawInput as { planId: string; budgetMinor: number | null };
    const parsed = setPlanBudgetSchema.parse({ budgetMinor });
    const pName = await planName(ctx, planId);
    const amountText = parsed.budgetMinor == null ? "no budget" : describeAmountForProvider(parsed.budgetMinor, "INR", privacyModeEnabled);
    return proposeCommand(ctx, "spensa", "updatePlanBudget", { planId, budgetMinor: parsed.budgetMinor }, {
      summary: `Set "${pName}"'s budget to ${amountText}.`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Budget", value: amountText },
      ],
    });
  },
};

const proposeUpdatePlanStatusTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdatePlanStatus",
    description: "Propose moving a Plan to a new lifecycle status (active, paused, postponed, completed, archived). A completed or archived Plan can be reopened back to active. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, targetStatus: { type: "string" } }, required: ["planId", "targetStatus"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, targetStatus } = rawInput as { planId: string; targetStatus: string };
    const parsed = transitionPlanStatusSchema.parse({ targetStatus });
    const pName = await planName(ctx, planId);
    return proposeCommand(ctx, "spensa", "updatePlanStatus", { planId, targetStatus: parsed.targetStatus }, {
      summary: `Move "${pName}" to ${parsed.targetStatus}.`,
      fields: [
        { label: "Plan", value: pName },
        { label: "New status", value: parsed.targetStatus },
      ],
    });
  },
};

const proposeDeletePlanTool: WriteToolHandler = {
  definition: {
    name: "proposeDeletePlan",
    description: "Propose permanently deleting a Plan. Only an empty draft Plan (no items, no linked Goal/Commitment/Account, no transactions) can be deleted -- archive a Plan with content instead using proposeUpdatePlanStatus. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" } }, required: ["planId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId } = rawInput as { planId: string };
    const pName = await planName(ctx, planId);
    return proposeCommand(ctx, "spensa", "deletePlan", { planId }, {
      summary: `Delete the empty Plan "${pName}". This cannot be undone.`,
      fields: [{ label: "Plan", value: pName }],
    });
  },
};

const proposeCreatePlanItemTool: WriteToolHandler = {
  definition: {
    name: "proposeCreatePlanItem",
    description: "Propose adding a Plan Item (a line in a Plan such as a flight, hotel, or activity) with an optional estimated amount. This does NOT create a transaction and does NOT change any account balance. An item with no price is a valid, uncategorized state. Only creates a proposal the user must confirm.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        categoryId: { type: "string" },
        estimatedAmountMinor: { type: "number" },
        estimatedCurrency: { type: "string" },
        expectedDate: { type: "string" },
        commitmentId: { type: "string" },
      },
      required: ["planId", "name"],
    },
  },
  execute: async ({ ctx, privacyModeEnabled }, rawInput): Promise<ProposalResult> => {
    const { planId, ...rest } = rawInput as { planId: string; [k: string]: unknown };
    const input = createPlanItemSchema.parse(rest);
    const pName = await planName(ctx, planId);
    const amountText = input.estimatedAmountMinor != null ? describeAmountForProvider(input.estimatedAmountMinor, input.estimatedCurrency ?? "INR", privacyModeEnabled) : "no amount yet";
    return proposeCommand(ctx, "spensa", "addPlanItem", { planId, ...input } as Record<string, unknown>, {
      summary: `Add "${input.name}" (${amountText}) to "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Item", value: input.name },
        { label: "Estimated amount", value: amountText },
      ],
    });
  },
};

const proposeUpdatePlanItemTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdatePlanItem",
    description: "Propose updating a Plan Item's name, amount, category, date, or notes. Does not create a transaction and never touches an existing transaction's own amount. Only creates a proposal the user must confirm.",
    inputSchema: {
      type: "object",
      properties: {
        planItemId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        categoryId: { type: "string" },
        estimatedAmountMinor: { type: "number" },
        estimatedCurrency: { type: "string" },
        expectedDate: { type: "string" },
        commitmentId: { type: "string" },
      },
      required: ["planItemId"],
    },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planItemId, ...rest } = rawInput as { planItemId: string; [k: string]: unknown };
    const input = updatePlanItemSchema.parse(rest);
    return proposeCommand(ctx, "spensa", "updatePlanItem", { planItemId, ...input } as Record<string, unknown>, {
      summary: "Update this Plan Item.",
      fields: [{ label: "Plan Item ID", value: planItemId }],
    });
  },
};

const proposeUpdatePlanItemStatusTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdatePlanItemStatus",
    description: "Propose moving a Plan Item to a new status (planned, booked, committed, partially_paid, paid, cancelled, skipped). This only changes the item's own status label -- it never creates, verifies, or implies a transaction. A status of 'paid' here is the user's own planning label, not evidence that a transaction exists. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planItemId: { type: "string" }, targetStatus: { type: "string" } }, required: ["planItemId", "targetStatus"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planItemId, targetStatus } = rawInput as { planItemId: string; targetStatus: string };
    const parsed = transitionPlanItemStatusSchema.parse({ targetStatus });
    return proposeCommand(ctx, "spensa", "updatePlanItemStatus", { planItemId, targetStatus: parsed.targetStatus }, {
      summary: `Move this Plan Item to ${parsed.targetStatus}.`,
      fields: [
        { label: "Plan Item ID", value: planItemId },
        { label: "New status", value: parsed.targetStatus },
      ],
    });
  },
};

const proposeAssociatePlanGoalTool: WriteToolHandler = {
  definition: {
    name: "proposeAssociatePlanGoal",
    description: "Propose linking a savings Goal to a Plan for context. This never moves money, changes the Goal's saved amount, or makes a Goal contribution count as Plan spending. Re-linking an already-linked Goal is a harmless no-op. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, goalId: { type: "string" } }, required: ["planId", "goalId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, goalId } = rawInput as { planId: string; goalId: string };
    planGoalLinkSchema.parse({ goalId });
    const [pName, gName] = await Promise.all([planName(ctx, planId), goalNameFor(ctx, goalId)]);
    return proposeCommand(ctx, "spensa", "associatePlanGoal", { planId, goalId }, {
      summary: `Link Goal "${gName}" to Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Goal", value: gName },
      ],
    });
  },
};

const proposeDissociatePlanGoalTool: WriteToolHandler = {
  definition: {
    name: "proposeDissociatePlanGoal",
    description: "Propose removing the link between a Goal and a Plan. Never affects the Goal's saved amount or contribution history. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, goalId: { type: "string" } }, required: ["planId", "goalId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, goalId } = rawInput as { planId: string; goalId: string };
    const [pName, gName] = await Promise.all([planName(ctx, planId), goalNameFor(ctx, goalId)]);
    return proposeCommand(ctx, "spensa", "dissociatePlanGoal", { planId, goalId }, {
      summary: `Unlink Goal "${gName}" from Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Goal", value: gName },
      ],
    });
  },
};

const proposeAssociatePlanCommitmentTool: WriteToolHandler = {
  definition: {
    name: "proposeAssociatePlanCommitment",
    description: "Propose linking a planned commitment to a Plan for context. This never changes the commitment's own amount, schedule, or reserve, and never marks it paid. Re-linking an already-linked commitment is a harmless no-op. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, commitmentId: { type: "string" } }, required: ["planId", "commitmentId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, commitmentId } = rawInput as { planId: string; commitmentId: string };
    planCommitmentLinkSchema.parse({ commitmentId });
    const [pName, cName] = await Promise.all([planName(ctx, planId), commitmentNameFor(ctx, commitmentId)]);
    return proposeCommand(ctx, "spensa", "associatePlanCommitment", { planId, commitmentId }, {
      summary: `Link commitment "${cName}" to Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Commitment", value: cName },
      ],
    });
  },
};

const proposeDissociatePlanCommitmentTool: WriteToolHandler = {
  definition: {
    name: "proposeDissociatePlanCommitment",
    description: "Propose removing the link between a planned commitment and a Plan. Never affects the commitment itself. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, commitmentId: { type: "string" } }, required: ["planId", "commitmentId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, commitmentId } = rawInput as { planId: string; commitmentId: string };
    const [pName, cName] = await Promise.all([planName(ctx, planId), commitmentNameFor(ctx, commitmentId)]);
    return proposeCommand(ctx, "spensa", "dissociatePlanCommitment", { planId, commitmentId }, {
      summary: `Unlink commitment "${cName}" from Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Commitment", value: cName },
      ],
    });
  },
};

const proposeAssociatePlanAccountTool: WriteToolHandler = {
  definition: {
    name: "proposeAssociatePlanAccount",
    description: "Propose linking an account to a Plan for context (for example, 'paid using this card'). This never changes the account's balance and is never treated as a reserve against Safe-to-Spend. Re-linking an already-linked account is a harmless no-op. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, accountId: { type: "string" } }, required: ["planId", "accountId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, accountId } = rawInput as { planId: string; accountId: string };
    planAccountLinkSchema.parse({ accountId });
    const [pName, aName] = await Promise.all([planName(ctx, planId), accountNameFor(ctx, accountId)]);
    return proposeCommand(ctx, "spensa", "associatePlanAccount", { planId, accountId }, {
      summary: `Link account "${aName}" to Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Account", value: aName },
      ],
    });
  },
};

const proposeDissociatePlanAccountTool: WriteToolHandler = {
  definition: {
    name: "proposeDissociatePlanAccount",
    description: "Propose removing the link between an account and a Plan. Never affects the account's balance. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { planId: { type: "string" }, accountId: { type: "string" } }, required: ["planId", "accountId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { planId, accountId } = rawInput as { planId: string; accountId: string };
    const [pName, aName] = await Promise.all([planName(ctx, planId), accountNameFor(ctx, accountId)]);
    return proposeCommand(ctx, "spensa", "dissociatePlanAccount", { planId, accountId }, {
      summary: `Unlink account "${aName}" from Plan "${pName}".`,
      fields: [
        { label: "Plan", value: pName },
        { label: "Account", value: aName },
      ],
    });
  },
};

const proposeUpdateTransactionPlanTool: WriteToolHandler = {
  definition: {
    name: "proposeUpdateTransactionPlan",
    description: "Propose attaching a transaction to a Plan (and optionally to one specific Plan Item), moving it to a different Plan, or detaching it entirely (pass planId null). This is the ONLY way a transaction ever counts as Plan actual spend -- it never creates a transaction, and never changes the transaction's own amount, currency, type, account, category, or date. Only creates a proposal the user must confirm.",
    inputSchema: { type: "object", properties: { transactionId: { type: "string" }, planId: { type: "string", nullable: true }, planItemId: { type: "string", nullable: true } }, required: ["transactionId", "planId"] },
  },
  execute: async ({ ctx }, rawInput): Promise<ProposalResult> => {
    const { transactionId, planId, planItemId } = rawInput as { transactionId: string; planId: string | null; planItemId?: string | null };
    const parsed = setTransactionPlanSchema.parse({ planId, planItemId: planItemId ?? null });
    const pName = parsed.planId ? await planName(ctx, parsed.planId) : null;
    return proposeCommand(ctx, "spensa", "setTransactionPlan", { transactionId, planId: parsed.planId, planItemId: parsed.planItemId ?? null }, {
      summary: pName ? `Attach this transaction to Plan "${pName}".` : "Detach this transaction from its Plan.",
      fields: [
        { label: "Transaction ID", value: transactionId },
        { label: "Plan", value: pName ?? "None (detach)" },
      ],
    });
  },
};

export const PLAN_WRITE_TOOLS: WriteToolHandler[] = [
  proposeCreatePlanTool,
  proposeUpdatePlanTool,
  proposeUpdatePlanBudgetTool,
  proposeUpdatePlanStatusTool,
  proposeDeletePlanTool,
  proposeCreatePlanItemTool,
  proposeUpdatePlanItemTool,
  proposeUpdatePlanItemStatusTool,
  proposeAssociatePlanGoalTool,
  proposeDissociatePlanGoalTool,
  proposeAssociatePlanCommitmentTool,
  proposeDissociatePlanCommitmentTool,
  proposeAssociatePlanAccountTool,
  proposeDissociatePlanAccountTool,
  proposeUpdateTransactionPlanTool,
];

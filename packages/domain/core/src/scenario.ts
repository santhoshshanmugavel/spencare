/**
 * Scenario isolation — types and a pure evaluation function for
 * what-if financial analysis. The key invariant: evaluateScenario
 * MUST NEVER import from or call into @spencare/domain-infra, Supabase,
 * or any I/O layer. It reads only from the ScenarioBaseline struct and
 * produces only a ScenarioResult.
 *
 * ScenarioResult must never be passed to any command that mutates
 * financial tables — it represents a hypothetical, not a committed plan.
 */

export interface ScenarioBaseline {
  /** ISO timestamp when this snapshot was captured */
  capturedAt: string;
  safeToSpendMinor: number;
  netWorthMinor: number;
  accountBalances: Array<{
    accountId: string;
    balanceMinor: number;
    type: string;
  }>;
  goalBalances: Array<{
    goalId: string;
    savedMinor: number;
    targetMinor: number;
  }>;
  upcomingCommitmentsMinor: number;
  currency: string;
}

export interface ScenarioInput {
  id: string;
  type:
    | "additional_expense"
    | "additional_income"
    | "balance_change"
    | "goal_change"
    | "commitment_change";
  amountMinor: number;
  /** YYYY-MM-DD when this hypothetical event occurs */
  date: string;
  description: string;
}

export interface ScenarioResult {
  baseline: ScenarioBaseline;
  inputs: ScenarioInput[];
  projectedSafeToSpendMinor: number;
  projectedNetWorthMinor: number;
  projectedAccountBalances: Array<{
    accountId: string;
    projectedBalanceMinor: number;
  }>;
  impactSummary: string[];
  calculatedAt: string;
  limitations: string[];
}

/**
 * Evaluates a hypothetical scenario against a captured baseline.
 * Pure function: no I/O, no side effects. Identical inputs always
 * produce identical projected figures (calculatedAt will differ).
 *
 * Projection rules (simplified deterministic model):
 * - additional_expense: reduces safeToSpend and netWorth
 * - additional_income:  increases safeToSpend and netWorth
 * - balance_change:     applies directly to safeToSpend/netWorth
 * - goal_change:        affects only goalBalances (no sts/nw impact for Phase 1)
 * - commitment_change:  adjusts upcomingCommitments, then sts
 */
export function evaluateScenario(
  baseline: ScenarioBaseline,
  inputs: ScenarioInput[],
): ScenarioResult {
  let safeToSpend = baseline.safeToSpendMinor;
  let netWorth = baseline.netWorthMinor;
  const accountBalances = baseline.accountBalances.map((a) => ({
    accountId: a.accountId,
    projectedBalanceMinor: a.balanceMinor,
  }));
  const goalBalances = baseline.goalBalances.map((g) => ({ ...g }));
  const impactSummary: string[] = [];
  const limitations: string[] = [
    "Projection assumes all inputs apply to the first available cash account.",
    "Goal changes do not currently flow through to Safe-to-Spend in Phase 1.",
  ];

  for (const input of inputs) {
    switch (input.type) {
      case "additional_expense": {
        safeToSpend -= input.amountMinor;
        netWorth -= input.amountMinor;
        impactSummary.push(
          `${input.description}: reduces Safe-to-Spend by ${input.amountMinor} minor units`,
        );
        break;
      }
      case "additional_income": {
        safeToSpend += input.amountMinor;
        netWorth += input.amountMinor;
        impactSummary.push(
          `${input.description}: increases Safe-to-Spend by ${input.amountMinor} minor units`,
        );
        break;
      }
      case "balance_change": {
        safeToSpend += input.amountMinor;
        netWorth += input.amountMinor;
        impactSummary.push(
          `${input.description}: adjusts balance by ${input.amountMinor} minor units`,
        );
        break;
      }
      case "goal_change": {
        // Phase 1: goal changes are tracked but do not flow through to sts/nw.
        impactSummary.push(
          `${input.description}: goal change recorded (not reflected in Safe-to-Spend in Phase 1)`,
        );
        break;
      }
      case "commitment_change": {
        // A commitment change shifts upcoming obligations and therefore sts.
        // Positive amountMinor = new/increased obligation (reduces sts).
        safeToSpend -= input.amountMinor;
        impactSummary.push(
          `${input.description}: commitment change of ${input.amountMinor} minor units affects Safe-to-Spend`,
        );
        break;
      }
    }
  }

  return {
    baseline,
    inputs,
    projectedSafeToSpendMinor: safeToSpend,
    projectedNetWorthMinor: netWorth,
    projectedAccountBalances: accountBalances,
    impactSummary,
    calculatedAt: new Date().toISOString(),
    limitations,
  };
}

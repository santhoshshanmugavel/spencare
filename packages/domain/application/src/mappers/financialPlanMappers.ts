/**
 * Row -> domain-type mappers for the Plans domain (Gate 3). Exists so
 * Gate 1's pure calculation/validation functions (which operate on the
 * `FinancialPlan`/`PlanItem`/`PlanTransactionInput` domain shapes, with
 * `Money` fields) can be reused unchanged by the repo-backed commands and
 * queries in this package, instead of duplicating their logic against raw
 * database rows — the same "one canonical mapping, reused everywhere"
 * rationale as `aiAccountSummary.ts`'s `toAiAccountSummaryInput`.
 */

import { Money, type CurrencyCode, type FinancialPlan, type PlanItem, type PlanTransactionInput } from "@spencare/domain-core";
import type { FinancialPlanRow, PlanItemRow } from "@spencare/domain-infra";
import type { TransactionRow } from "@spencare/domain-infra";

export function toFinancialPlan(row: FinancialPlanRow): FinancialPlan {
  const currency = row.base_currency as CurrencyCode;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    baseCurrency: currency,
    originalBudget: row.original_budget_minor != null ? Money.fromNumber(row.original_budget_minor, currency) : null,
    currentBudget: row.current_budget_minor != null ? Money.fromNumber(row.current_budget_minor, currency) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
  };
}

export function toPlanItem(row: PlanItemRow): PlanItem {
  return {
    id: row.id,
    planId: row.plan_id,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    estimatedAmount:
      row.estimated_amount_minor != null && row.estimated_currency != null
        ? Money.fromNumber(row.estimated_amount_minor, row.estimated_currency as CurrencyCode)
        : null,
    status: row.status,
    expectedDate: row.expected_date,
    commitmentId: row.commitment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Only the fields Gate 1's calculatePlanActualSpend needs — deliberately narrow, same minimalism as CashFlowTransactionInput. */
export function toPlanTransactionInput(row: TransactionRow): PlanTransactionInput {
  return {
    id: row.id,
    type: row.type,
    amount: Money.fromNumber(row.amount_minor, row.currency as CurrencyCode),
    occurredAt: row.occurred_at,
    deletedAt: null, // already filtered out by every repo query's .is("deleted_at", null)
    transferPairId: row.transfer_pair_id,
  };
}

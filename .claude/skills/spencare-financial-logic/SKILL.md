---
description: Apply before implementing or changing any financial calculation,
  dashboard metric, transaction query, budget, bill, goal, safe-to-spend,
  net-worth, or cash-flow logic. Ensures domain invariants, correct
  aggregation, and financial correctness throughout the Spencare codebase.
name: spencare-financial-logic
---

# Spencare Financial Logic Skill

## When to invoke

Activate this skill whenever you:
- Implement or modify a financial calculation (safe-to-spend, net worth,
  cash flow, budget progress, goal progress, bill status)
- Write or change a transaction query or aggregation
- Add or change a dashboard metric or summary value
- Touch `packages/domain/core/` or `packages/domain/application/`
- Add AI tool responses that include financial figures
- Build any screen that displays monetary amounts, periods, or statuses

## Authoritative sources

| Concept | Authoritative source |
|---------|---------------------|
| Money arithmetic | `packages/domain/core/src/Money.ts` (`Money` class) |
| Transaction model | `packages/domain/core/src/cashFlow.ts` |
| Cash-flow aggregation | `packages/domain/core/src/transactionAggregation.ts` |
| Safe-to-Spend | `packages/domain/core/src/safeToSpend.ts` |
| Net Worth | `packages/domain/core/src/netWorth.ts` |
| Bills | `packages/domain/core/src/bills.ts` |
| Budgets | `packages/domain/core/src/budgets.ts` |
| Goals | `packages/domain/core/src/goals.ts` |
| Transfers | `packages/domain/core/src/transferMatching.ts` |
| Credit-card billing | `packages/domain/core/src/creditCardBilling.ts` |

Read the relevant source file before implementing changes. Never invent
a financial formula — derive it from the existing domain layer.

## Non-negotiable invariants

These rules come from CLAUDE.md §9 and are enforced in every code path.

### Transaction model
```
amount_minor  — integer minor units (e.g. ₹500.00 = 50000)
occurred_at   — user-supplied financial event date (not created_at)
type          — 'income' | 'expense' | 'transfer' | 'goal_contribution' | 'goal_withdrawal'
deleted_at    — soft delete; ALWAYS filter .is("deleted_at", null)
transfer_pair_id — links the two legs of a transfer
```

### Income and expense definitions
```sql
income:  type = 'income'  AND deleted_at IS NULL AND transfer_pair_id IS NULL
expense: type = 'expense' AND deleted_at IS NULL AND transfer_pair_id IS NULL
```
Goal contributions, goal withdrawals, and transfer legs are **never** income
or expense. Exclude them from all income/expense totals.

### Transfers
- A transfer creates **two** rows linked by `transfer_pair_id` (debit + credit).
- Transfer legs are **excluded** from all income and expense calculations.
- Credit-card repayments are transfers — not spending.
- Filter: `transfer_pair_id IS NULL` whenever computing income or expenses.

### Credit cards
- A credit-card purchase = expense (real spending that creates a liability).
- Credit **available** is not owned money — never include in Safe-to-Spend or
  Net Worth assets.
- `account.type = 'credit'` balance represents outstanding liability, not available credit.

### Safe-to-Spend
```
= sum of bank + cash account balances ONLY
```
Exclude: credit, investment accounts, upcoming-bill deductions are a
**prediction layer** on top of the base figure — not part of the stored balance.

### Net Worth
```
= total_assets − total_liabilities
assets:      bank + cash + investment account balances
liabilities: outstanding credit card balances (amount owed)
```
Never include credit limit as an asset.

### Goal contributions
- "Already saved" at goal creation is metadata only — it does NOT debit any account.
- Actual `goal_contribution` transactions DO debit the funding account.
- Never double-count by summing both.

## Money arithmetic rules

1. Use `Money` from `@spencare/domain-core` for every monetary operation.
2. Never use JavaScript `number` or `float` for financial sums.
3. Store as integer minor units; display as major units (divide by 100 at presentation layer only).
4. For display: use `packages/web/lib/currency-format.ts` utilities, not ad-hoc formatting.

## Pre-implementation checklist

Before writing any financial code, confirm:
- [ ] What is the authoritative source file for this calculation?
- [ ] Which transaction types are included? Which are excluded?
- [ ] Is `deleted_at IS NULL` filtered on every transaction query?
- [ ] Are transfer legs excluded (filter `transfer_pair_id IS NULL`) where required?
- [ ] What is the exact time range and date boundary for this period?
- [ ] Are timezone considerations handled? (use `occurred_at` with user's IANA timezone)
- [ ] Does the calculation use `Money` — not raw numbers?
- [ ] Are missing/null values handled explicitly (never silently treated as zero)?
- [ ] Does the UI distinguish estimated values from confirmed values?

## Dashboard metrics: define before display

For any new metric:
1. Write its formula in a comment or doc before touching any component.
2. Identify its source fields, aggregation, and time period.
3. Identify what happens when source data is missing or incomplete.
4. Test the formula independently in a unit test before wiring it to UI.

## AI tool responses and financial data

Spensa AI tools read financial data; they do not calculate financial truth.
- AI tool results must come from domain-layer queries, not AI-generated estimates.
- Never return an AI-generated number as a definitive balance or total.
- Mark AI-suggested amounts as estimates; confirm via domain layer before display.
- When displaying AI-proposed transactions, show them as pending until user confirms.

## MCP PATCH semantics

When Spensa proposes an update via MCP tools:
- Only explicitly supplied fields change.
- Unset fields must NOT erase existing data.
- Always read the current row, merge changes, then write.

## Testing requirements

Every financial calculation in `packages/domain/core/` and
`packages/domain/application/` needs:
- Unit tests covering the normal case
- Unit tests for missing/zero/null input data
- Tests for period boundaries (start of month, end of month, leap years)
- Tests for transfers (ensure they are excluded from income/expense sums)
- Tests for soft-deleted transactions (ensure they are excluded)
- Tests using `Money` arithmetic (not raw numbers)

See `spencare-testing` skill for the testing conventions.

## Reporting

When implementing a financial calculation, briefly document:
1. The formula and its source reference.
2. Which transaction types are included/excluded.
3. How missing data is handled.
4. Tests written and their coverage of edge cases.

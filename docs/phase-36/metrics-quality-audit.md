<title>Phase 36 — Metrics Quality Audit</title>

# Phase 36 — Metrics Quality Audit

No new metric was built or changed this phase. This audits the metrics
already specified in `docs/phase-34/metric-framework.md` and
`docs/phase-35/metrics-product-spec.md` against this phase's requested
format (METRIC / PURPOSE / FORMULA / DATA SOURCE / USER VALUE /
BUSINESS VALUE / PRIVACY / EMPTY STATE / STATUS), for the dashboard
metrics actually live in the product today.

| METRIC | PURPOSE | FORMULA | DATA SOURCE | USER VALUE | BUSINESS VALUE | PRIVACY | EMPTY STATE | STATUS |
|---|---|---|---|---|---|---|---|---|
| Safe-to-Spend | "How much can I spend right now?" | `Bank+Cash − reserved goals − upcoming bills`, state-machine-driven (`balance_only`/`budget_and_goals`/etc.) | `getSafeToSpend` (domain-application, tested) | Direct spending decision | Core differentiator vs. a plain balance app | Masked (`<Money masked>`) on Home/Cash Flow's per-account card | Shows "Available Balance" when nothing to net against, never a fabricated "Safe to Spend" with nothing behind it | LIVE |
| Owned Money | "How much do I actually have, ignoring credit/investments?" | Bank + Cash account balances, summed | `getSafeToSpend`'s own composition | Distinguishes owned cash from credit or invested wealth | Reinforces the product's core financial-model education | Masked | Shown as a supporting line under the hero, never standalone with nothing to support | LIVE |
| Available Credit | "How much credit capacity do I have left?" | `credit_limit − credit_used`, summed across credit cards | Plain arithmetic over `accounts` | Prevents confusing credit capacity with owned money | Same as above | Masked, shown only when the user has a credit card | Card omitted entirely when the user has no credit card (not shown as ₹0) | LIVE |
| Net Worth | "What is my overall financial position?" | Total assets − total liabilities | `getNetWorth` (domain-application, tested) | High-level financial-health signal | Retention driver (a number that changes meaningfully over time gives a reason to return) | Masked | Card omitted for a user with no investments and no liabilities (not shown as ₹0) | LIVE |
| Spending-change / top-category insight | "What changed, and where did it go?" | `getCashFlowTrend`'s month-over-month delta; `computeSpendingInsight`'s top-category slice | Both domain-application/pure-function, tested | Answers "why does this month feel different" without manual comparison | Encourages return visits after a spending change | Whole chart/insight skipped under Privacy Mode, not partially redacted | Returns `null` with no prior-month data or no transactions — rendered as an honest absence, never a fabricated "0%" | LIVE |
| Cash-flow trend chart (Income vs Expense, 6mo) | "Is my financial trajectory improving?" | Existing monthly aggregates, charted via ECharts | `getCashFlowTrend` | Trend awareness beyond one month | Same as above | Chart entirely un-rendered (text notice instead) under Privacy Mode | Shows real ₹0 bars for months with no activity — this IS the honest empty state, not a placeholder | LIVE |
| Goal pace (`calculateGoalPaceStatus`) | "Am I on track for a specific goal?" | Elapsed-time-vs-elapsed-savings comparison against target | Pure domain-core function, tested | Direct answer inside the Goal Detail insight sentence | Could aggregate into a product-health signal (see below) | Whole insight card skipped under Privacy Mode | Falls back to a neutral "saved so far" sentence with no target date, never a fabricated pace claim | LIVE |
| WAU/MAU, Cash Flow/Goals/Budgets/Spensa usage, retention | Engagement/retention measurement | Would need a page-view event | No event pipeline exists | N/A yet | N/A yet | N/A yet | N/A yet | BLOCKED — no event emission exists in this codebase |
| Goal-pace distribution across all users' goals | "Are the Goal Wizard's cost estimates realistic on average?" | Batch-apply `calculateGoalPaceStatus` across active goals with a target date | Existing `goals` table, no new instrumentation | N/A (internal product metric, not user-facing) | Real, actionable signal for revisiting `apps/web/lib/goal-wizard.ts`'s tiered estimates if "behind" trends high | Aggregate-only, never per-user | "No goals with a target date yet" | PARTIAL — computable today from existing data, but no dashboard/job currently runs this aggregation |

## Metrics NOT built, and why (anti-vanity-metric discipline)

- **Raw Spensa message count** — rejected in Phase 34/35 as a vanity
  metric; not revisited this phase.
- **"Accounts connected" as a headline success metric** — same
  rejection, not revisited.
- **A composite "financial health score"** — would require a formula
  with no domain grounding; not built, not specified.

<title>Phase 37 — Metrics Prioritization Matrix</title>

# Phase 37 — Metrics Prioritization Matrix

Consolidates and re-prioritizes `docs/phase-34/metric-framework.md` and
`docs/phase-35/metrics-product-spec.md` (both still the fuller
reference) into this phase's requested matrix shape. No new analytics
data exists in this codebase as of this phase.

| METRIC | USER QUESTION | ACTION | FREQUENCY | IMPORTANCE | DATA AVAILABILITY | PRIVACY | UI LOCATION | STATUS |
|---|---|---|---|---|---|---|---|---|
| Safe-to-Spend | "How much can I spend?" | Spend confidently / hold back | Every visit | Highest | Live, computed on read | Masked under Privacy Mode | Home hero | LIVE |
| Income vs Expense | "Did my income or spending change?" | Investigate a spike | Monthly | High | Live (`getCashFlowTrend`) | Skip-rendered under Privacy Mode | Home trend chart | LIVE |
| Spending change % | "Is this month different?" | Same as above | Monthly | High | Live (`comparison.expense.deltaPercent`) | Skip-rendered | Home insight sentence | LIVE |
| Top category | "Where did my money go?" | Consider a budget for that category | Monthly | High | Live (`computeSpendingInsight`) | Category name shown, amount masked | Home + Cash Flow | LIVE |
| Upcoming bills | "What's due soon?" | Plan cash flow | Ongoing | High | Live | Masked | Cash Flow tab | LIVE |
| Budget utilization / over-budget | "Am I over a limit?" | Cut back or adjust the budget | Ongoing | High | Live (`calculateBudgetUsage`) | Masked | Cash Flow budget panel | LIVE |
| Goal progress | "How close am I?" | Contribute or adjust the goal | Ongoing | High | Live (`calculateGoalProgress`) | Masked | Goals grid + detail | LIVE |
| Goal pace | "Am I on track?" | Contribute more or extend the date | Ongoing | High | Live (`calculateGoalPaceStatus`) | Masked | Goal detail insight | LIVE |
| Investments | "What are my investments worth?" | Informational (no in-product action yet) | Occasional | Medium | Live | Masked | Home | LIVE |
| Net Worth | "What's my overall position?" | Informational / long-term tracking | Occasional | Medium | Live | Masked | Home | LIVE |
| Net Worth trend (over time) | "Is my net worth growing?" | Same as above, with a trend line | Monthly | Medium | **Not computed today** — would need historical snapshots, not just a point-in-time figure | N/A | None yet | NOT SPECIFIED — would require a new, real, scoped design (periodic snapshot storage), not built this phase |
| Recurring-expense detection | "What subscriptions am I paying for?" | Cancel or keep | Occasional | Medium | Not built | N/A | None | BLOCKED — no recurring-detection logic exists; would need real pattern-matching over transaction history, not a guess |
| Unusual spending detection | "Is this normal for me?" | Investigate | Ongoing | Medium | Partially — the "+X% vs last month" delta already exists; a true per-transaction anomaly flag does not | N/A | Home insight sentence covers the aggregate case | PARTIAL |
| Goal-pace distribution (aggregate, product-facing) | (Internal) "Are the Goal Wizard's estimates realistic?" | Revisit `goal-wizard.ts`'s cost tiers if skewed | Periodic | Medium (product, not user-facing) | Computable today from existing data, no new instrumentation | Aggregate only | Internal dashboard (not built) | LIVE (computable, not surfaced) |
| WAU / MAU, retention, funnel metrics | (Business) "Is the product sticky?" | Prioritize onboarding/engagement work | Weekly/Monthly | High (business) | **No page-view/event pipeline exists** | N/A | None | BLOCKED — ANALYTICS DATA NOT AVAILABLE |

## What was NOT added

No new metric was added to any UI surface this phase. This matrix is a
prioritization/status document, not a build list — per Section 38's own
"do not make Spencare more complex" rule, a metric only gets built once
it clears the "what decision does this enable" bar AND has a real,
non-fabricated data source.

<title>Phase 31 — Financial Dashboard Metric Framework</title>

# Phase 31 — Financial Dashboard Metric Framework

Ranked by user importance, per the mandate's own rule: *"Do NOT display
all of these simultaneously... minimalism wins."* Nine of the nineteen
candidate metrics are implemented; the rest are explicitly rejected with
a reason, not silently dropped.

## Implemented metrics

### 1. Safe to Spend
- **User question:** "What can I safely spend right now?"
- **Calculation:** `calculateSafeToSpend` (domain-core, unchanged this phase) — Bank + Cash, minus active goal reservations and upcoming bills, capped by budget remaining where a budget exists.
- **Data source:** `getSafeToSpend` (domain-application).
- **Frequency:** Real-time (every page load).
- **Comparison period:** None — this is a point-in-time availability figure, not a trend.
- **Visualization:** Hero number (`SafeToSpendHeroCard`), no chart — a single trustworthy number needs no visualization.
- **Why it matters:** The one figure a user needs before spending money today.
- **Empty state:** "Add a bank or cash account to see how much you can safely spend."
- **Privacy behavior:** Fully masked to `₹***`, including its breakdown rows.
- **Potential misunderstanding:** Could be confused with total balance or available credit — the caption under the hero ("...after goals, budget, and upcoming bills") and the separate `FinancialLayersCard` for Credit/Investments/Net Worth exist specifically to prevent this.
- **Accessibility:** Real text, not a chart — no alternative representation needed.

### 2. Owned Money / Reserved for Goals / Upcoming Bills (Safe-to-Spend breakdown)
- **User question:** "Why is my Safe-to-Spend number what it is?"
- **Calculation:** Sub-fields of the same `calculateSafeToSpend` result — no second computation.
- **Data source:** `getSafeToSpend`.
- **Frequency / comparison:** Same as Safe to Spend.
- **Visualization:** Inline text rows under the hero.
- **Why it matters:** NN/g #1 (visibility of system status) — a number with no visible reasoning invites distrust.
- **Empty state:** Rows for goal-reserved/upcoming-bills are omitted entirely when zero (never "₹0 reserved" noise).
- **Privacy behavior:** Masked identically to the hero.
- **Misunderstanding risk:** Low — each row is labeled with its own name, not a coded abbreviation.

### 3. Available Credit
- **User question:** "How much can I still borrow?"
- **Calculation:** `getSpendableMinor` per credit-card account (limit − used, clamped ≥ 0) — pure domain-core function, unchanged.
- **Data source:** `getSafeToSpend`'s own `creditAvailableTotal` (computed alongside, never summed into the hero).
- **Frequency:** Real-time.
- **Comparison:** None in the hero card; the trend chart (below) implicitly shows the spending side of this over time.
- **Visualization:** A labeled figure in `FinancialLayersCard`, captioned "Not included in Safe to Spend."
- **Why it matters:** Borrowing capacity is real information, but conflating it with owned money is the single most common consumer-finance-app mistake this product explicitly refuses to make.
- **Empty state:** Card renders nothing for this row when the user has no credit card.
- **Privacy behavior:** Masked.
- **Misunderstanding risk:** Explicitly labeled to prevent the "is this my money?" confusion.

### 4. Investments
- **User question:** "How much have I invested?"
- **Calculation:** Sum of `market_value_minor` across investment accounts (a plain aggregation already used by both Home and Cash Flow before this phase).
- **Visualization:** A labeled figure in `FinancialLayersCard`, captioned "In Net Worth, not Safe to Spend."
- **Why it matters:** Wealth, not spending money — showing it beside Safe-to-Spend without merging the two teaches the distinction by layout, not just by caption.
- **Empty state:** Omitted when zero.
- **Privacy:** Masked.

### 5. Net Worth
- **User question:** "What is my overall financial position?"
- **Calculation:** `getNetWorth` (domain-application, unchanged) — total assets minus credit liabilities.
- **Visualization:** A labeled figure in `FinancialLayersCard` — deliberately the LAST item, both in that card and in the page's overall vertical order, per the mandate's own instruction not to rank it above Safe-to-Spend merely for being numerically larger.
- **Why it matters:** Long-run financial health, distinct from "can I spend right now."
- **Privacy:** Masked.

### 6. Cash Flow Trend (Income vs. Expense, 6 months)
- **User question:** "Am I improving or getting worse?"
- **Calculation:** `getCashFlowTrend` (new, Phase 31) — six calls to the *already-existing* `getCashFlowOverview`, one per month; zero new aggregation math.
- **Data source:** `packages/domain/application/src/queries/cashFlow.ts`.
- **Frequency:** Computed on every Home load (six lightweight queries, same query the Cash Flow page already runs once).
- **Comparison period:** Month-over-month, six-month window.
- **Visualization:** **Line chart** (Apache ECharts) — the one new chart this phase adds, because a trend is the one question nothing else on the product answers. Two series (Income, Expense), never a 3rd axis or decorative fill.
- **Why it matters:** The mandate's own "am I improving?" question has no honest one-number answer — it requires a trend.
- **Empty state:** "Add transactions to understand your spending" when fewer than two months have any real transaction; never a flat zero-value chart implying data that doesn't exist.
- **Privacy behavior:** The chart does not render at all when masked (a plain text notice replaces it) — chosen deliberately over trying to redact every ECharts-internal label (axis ticks, tooltip, legend), which is exactly the fragile surface the mandate warns "no exact financial amount may leak" about.
- **Misunderstanding risk:** Labeled "Income"/"Expense" with a real legend and a real tooltip on hover — never color-only (a screen-reader-visible text summary states the same six months' figures in prose).
- **Accessibility representation:** The chart `<div>` is `aria-hidden`; a `sr-only` paragraph states every month's income/expense in words, the same convention `DonutChart`'s own text legend already established.

### 7. Spending Change (this month vs. last)
- **User question:** "Did I spend more or less than usual?"
- **Calculation:** `comparePeriods` (domain-core, unchanged) applied to the trend's own last two months — no new percent-delta logic.
- **Visualization:** A small colored delta line (↑/↓ + %) beside the trend chart's heading.
- **Why it matters:** A single number a user can act on in one glance, without reading the whole chart.
- **Privacy:** Shows "Spending changed" (no number) when masked.

### 8. Top Spending Category
- **User question:** "Where did my money go?"
- **Calculation:** `getCashFlowByCategory` (unchanged, already computed for Cash Flow's own donut) — this phase reads only its first (largest) slice.
- **Visualization:** One line of text with a link to Cash Flow's full donut breakdown — **deliberately not a second donut chart on Home**. The mandate's own rule ("do not make every metric a chart... every visualization must answer a real user question that nothing else already answers") argues against duplicating a chart Cash Flow already owns.
- **Why it matters:** Directional awareness without requiring a second full chart.
- **Empty state:** Line omitted entirely when there is no expense category data.
- **Privacy:** "Category breakdown hidden while Privacy Mode is on."

### 9. Budget Utilization / Budgets Needing Attention
- **User question:** "Are my budgets healthy?"
- **Calculation:** `listBudgetsWithUsage` (unchanged) — this phase filters to `near_limit`/`exceeded` only.
- **Visualization:** Text lines inside "Needs your attention," each linking to Budgets.
- **Why it matters:** Actionable — a healthy budget needs no attention and is deliberately not shown (silence, not a green checkmark for every category, per "minimalism wins").
- **Empty state:** The whole "Needs your attention" card is omitted when nothing needs it.
- **Privacy:** Shows "You've gone over your Dining budget" (no ₹ amount) / "You've used most of your Dining budget" (no %) when masked.

### 10. Goals At Risk
- **User question:** "Are my goals on track?"
- **Calculation:** **New**, `calculateGoalPaceStatus` (domain-core, Phase 31, 8 unit tests) — compares actual saved-percent against the linear pace a goal's own `created_at`→`target_date` window implies, with a 15-percentage-point cushion against ordinary timing noise. A goal with no target date is `no_schedule`, never fabricated as "at risk."
- **Data source:** `listGoals`, already fetched by Home; the pace check is pure and runs in the Server Component, not duplicated in the browser.
- **Visualization:** Text lines inside "Needs your attention," linking to Goals.
- **Why it matters:** The mandate's own worked concern — "Your Bali goal is ₹8,000 behind its planned pace" — needed a real, defensible computation, not a guess; this is that computation.
- **Empty state:** Omitted (goal doesn't appear) when on track, reached, or has no schedule.
- **Privacy:** "Bali Trip 2027 is behind pace to reach by the goal date." (no ₹ amount) when masked.

---

## Metrics intentionally rejected for this dashboard

| Metric | Why rejected |
|---|---|
| Income (standalone) | Already visible inside the trend chart and its tooltip; a separate hero number would repeat the same figure a second time for no new question answered. |
| Net Cash Flow (income − expense, standalone number) | Implicit in the trend chart (the gap between the two lines); a redundant third number competing with the trend for attention. |
| Recurring Expenses | No domain concept currently distinguishes "recurring" transactions from one-off ones (bill *predictions* are a different, already-modeled concept) — would require new domain logic and a UI to configure it; out of proportion for this pass. Flagged as a real future candidate, not silently dismissed. |
| Subscription Spending | Same reason as Recurring Expenses — no reliable domain signal exists yet to distinguish a subscription from any other recurring expense category. |
| Credit Utilization (% of limit used) | Real and computable today (`creditUsedMinor / creditLimitMinor`), but Accounts' own Credit Card cards already show this ("₹X used / ₹Y total limit" + a progress bar) — repeating it on Home would be the same "why does this exist twice" problem `topExpenseCategory` avoids by linking out instead of duplicating. |
| Goal Progress (per-goal % complete, on the dashboard) | Already the Goals page's own primary view (a full card grid); Home only needs the *exception* case (goals falling behind), not a second copy of every goal's own progress bar. |
| A standalone "Net Worth line chart" | The mandate's own example ("is my overall financial position improving?") is the same question the Cash Flow Trend line already answers with data the product actually has. A true Net Worth *history* would need periodic snapshots this product doesn't store (net worth is computed live from current balances, not persisted over time) — building that storage is a real, separate feature, not a chart-only decision, and is called out honestly as a gap rather than faked with interpolated data. |

---

## Chart-usage rationale (Apache ECharts)

Only **one** chart was added this phase (the Cash Flow Trend line). Every
other visualization on the dashboard — `SafeToSpendHeroCard`'s figures,
`FinancialLayersCard`'s labeled numbers, the "Needs your attention" text
lines — is deliberately plain text, because none of them answer a
question that benefits from a chart over a well-labeled number. The
existing hand-rolled `DonutChart` (Cash Flow's category breakdown) was
**not** ported to ECharts or duplicated on Home — it already exists, already
matches the product's visual system, and duplicating it here would be
"a chart because charts look impressive," which the mandate explicitly
forbids.

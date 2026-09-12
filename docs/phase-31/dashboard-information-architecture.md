<title>Phase 31 — Dashboard Information Architecture</title>

# Phase 31 — Dashboard Information Architecture

## Product development loop applied

**Problem** — a user opening Spencare had to visit three separate pages
(Cash Flow, Budgets, Goals) to answer "am I financially OK right now,"
and Home itself answered none of the mandate's ten dashboard questions
beyond Safe-to-Spend and Net Worth.

**User need** — a single screen that says, in order of urgency: what can
I spend, what changed, where did it go, and what needs my attention —
without requiring the user to already know where to look.

**Information architecture** — five levels (below), never reordered by
raw number size.

**User flow** — land on Home → read the hero (5 seconds) → glance at
"Needs your attention" if present → optionally read the trend/top
category → optionally act (tap into Budgets/Goals/Cash Flow via the
in-context links already inside each section, never a second navigation
step to "find" the relevant page).

**Interaction** — every new section is read-only text/chart with inline
links to the page that owns the underlying feature; no new mutation
surface was added to Home (Home has never owned account/budget/goal
mutations, and this phase does not change that).

**UI hierarchy** — see the five levels below; implemented as plain
vertical stacking (`space-y-6`), no tabs or accordions — the whole
dashboard is short enough that hiding any of it behind a click would cost
more than it saves.

**Accessibility** — every new text is real DOM text (not chart-only);
the one chart has a full `sr-only` prose equivalent; axe passes on every
new component and on `HomeContent` in both its empty and populated
states.

**Error prevention** — no metric is ever shown from partial/zero data
disguised as real ("Not enough data yet" / omission, never a fabricated
zero-value chart).

**Feedback** — visibility of system status: budgets/goals needing
attention are surfaced the moment their underlying data crosses a
threshold (`near_limit`/`exceeded`/`behind`), with no separate refresh
step.

**Measurement** — not build-time instrumented this phase (no analytics
work was requested or performed); the metric framework itself is the
measurement contract for what a future analytics pass would track.

**Improvement** — the two rejected-for-now candidates (Recurring
Expenses, Subscription Spending) and the Net-Worth-history gap are named
explicitly in `metric-framework.md` as the next real improvements, not
left implicit.

---

## The five levels

```
LEVEL 1 — Safe to Spend / immediate availability
    SafeToSpendHeroCard + FinancialLayersCard
    (unchanged this phase — already correct per Phase 28/29)
         │
LEVEL 2 — What changed this month
    "Needs your attention" (surfaced ABOVE the trend chart —
    see "why attention sits above the chart" below)
    Cash Flow Trend chart + Spending Change delta
         │
LEVEL 3 — Where money went
    Top Spending Category (one line, links to Cash Flow's own donut)
         │
LEVEL 4 — Budgets / goals requiring attention
    (folded into the Level-2 "Needs your attention" card — see below)
         │
LEVEL 5 — Wealth / net worth
    FinancialLayersCard's Net Worth row (last item, smallest visual
    weight, per the mandate's explicit "never rank Net Worth above
    Safe-to-Spend for being numerically larger")
```

### Why "Needs your attention" sits above the trend chart, not below it

The mandate's own ordering lists "what changed" (Level 2) above "budgets/
goals requiring attention" (Level 4). This implementation deliberately
renders the attention banner **first**, immediately after the Safe-to-
Spend hero, ahead of the trend chart — a conscious deviation, not an
oversight, for one reason: NN/g heuristic #6 (recognition rather than
recall) and #1 (visibility of system status) both argue that a user with
something actionable to see should not have to scroll past a chart to
find it. The chart is diagnostic ("why did this happen"); the attention
banner is prescriptive ("what do I do"). When both exist, the
prescriptive one wins the top slot. When nothing needs attention, the
banner doesn't render at all, so this ordering costs nothing on a
healthy day — the trend chart and Level-1 hero are the first thing seen.

This is documented here explicitly so a future reviewer comparing this
page against the mandate's literal level numbers understands it as a
reasoned heuristic trade-off, not a mis-implementation.

---

## Data flow (traceability)

| UI value | Application query | Domain function | Database data |
|---|---|---|---|
| Safe to Spend hero | `getSafeToSpend` | `calculateSafeToSpend` | `accounts`, `goals`, `bill_predictions`, `budgets` |
| Owned Money / Reserved / Upcoming Bills rows | `getSafeToSpend` | `calculateSafeToSpend` (sub-fields) | same as above |
| Available Credit | `getSafeToSpend` | `getSpendableMinor` per credit account | `accounts` (credit_card rows) |
| Investments | Home's own aggregation over `listAccounts` (plain sum, no domain-core function needed — a single filter+reduce, matches the identical code already in `cash-flow/page.tsx`) | — | `accounts` (investment rows) |
| Net Worth | `getNetWorth` | `calculateNetWorth` (domain-core) | `accounts` |
| Cash Flow Trend | `getCashFlowTrend` (new) | `calculateCashFlowTotals` × 6 months | `transactions` |
| Spending Change | Home page's own call to `comparePeriods` on the trend's last two months | `comparePeriods` (domain-core) | (derived from the trend data above) |
| Top Spending Category | `getCashFlowByCategory` | `calculateCategoryBreakdown` | `transactions`, `categories` |
| Budgets Needing Attention | `listBudgetsWithUsage` | `calculateBudgetUsage` | `budgets`, `transactions` |
| Goals At Risk | `listGoals` + Home page's own filter | `calculateGoalPaceStatus` (new) | `goals` |

**No page in this dashboard performs financial arithmetic of its own** —
every cell in the "Domain function" column above already existed before
this phase except `calculateGoalPaceStatus` (new, pure, unit-tested) and
`getCashFlowTrend` (new, a thin composition of the pre-existing
`getCashFlowOverview` run six times — not a new aggregation algorithm).

---

## Responsive behavior

Verified live at 375px (mobile) and the pane's desktop width; the five
levels stack in a single column at every width (no grid reflow needed —
Home has always been a single-column page). The trend chart resizes via
a real `window.resize` listener wired to `echarts.resize()`; at 375px
ECharts' own label-thinning reduces the x-axis to every other month
label to avoid overlap — a standard, expected charting behavior, not a
clipping defect (the full six-month data and the `sr-only` text summary
are unaffected).

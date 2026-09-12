<title>Phase 34 — Home Dashboard Information Architecture</title>

# Phase 34 — Home Dashboard IA

## Current structure (verified live this phase, unchanged from Phase 31)

1. **Safe-to-Spend** — hero card, top of page, always in the initial viewport.
2. **Owned Money** — shown as a supporting line inside the same card ("Owned money ₹X"), not a separate competing hero.
3. **Needs your attention** — only rendered when there's something real to say (verified: a fresh account with no budget/goal/bill data shows nothing here, not an empty section header).
4. **Cash flow trend chart** (ECharts, Phase 31) — income vs. expense, last 6 months.
5. **Spending-change / top-category insight** — one sentence, computed, not decorative.
6. **Ask Spensa** entry point.
7. **Complete your setup** checklist — state-driven (confirmed this phase: disappears item-by-item as the user actually creates a budget/goal, not a static onboarding list).

## Does this match the mandate's recommended hierarchy?

The mandate (Phase 34 §7, and Phase 33's own restatement) suggests: Safe-
to-Spend → Owned Money → Upcoming Commitments → Financial Attention →
Spending Change → Income vs Expense Trend → Goals/Goal Pace →
Investments → Net Worth.

**Current implementation covers 6 of 9 directly** (Safe-to-Spend, Owned
Money, Financial Attention, Spending Change, Income vs Expense Trend,
and implicitly Goals via the setup checklist). It does **not** have a
dedicated "Upcoming Commitments" card, a "Goal Pace" summary strip, or
Investments/Net Worth cards on Home specifically (Net Worth has its own
dedicated concept in the account model but is not currently surfaced as
a Home dashboard tile).

**Decision this phase: do not blindly add the missing three.** Per
Section 31 ("DO NOT OVER-DASHBOARD" — cap at 1–3 primary metrics, 2–4
supporting insights, 1 trend, 1 attention section) and Section 7's own
"what decision does this metric enable?" test:

- **Upcoming Commitments**: Cash Flow already has a dedicated "Upcoming
  Bills" surface with date grouping and a "Yet to spend" subtotal
  (Phase 30B). Duplicating it as a third Home card risks exactly the
  "wall of charts" Section 6 warns against, for a decision (when is my
  next bill due) the user can already make one click away. Deferred, not
  fixed, with this reasoning recorded rather than silently dropped.
- **Goal Pace strip**: `calculateGoalPaceStatus` already exists and could
  feed a Home summary ("2 goals on track, 1 behind"). Not added this
  phase — the "Needs your attention" section is the more honest home for
  a "behind pace" goal specifically (it already can surface an
  over-budget category the same way; extending it to goals is a small,
  well-scoped future addition, not built this phase since it wasn't the
  highest-value P0/P1 found).
- **Investments / Net Worth tiles**: no reference PDF among the ones
  re-read this phase or in prior phases' catalogs shows a Home-page
  Investments/Net Worth tile specifically (Net Worth's own dedicated
  page/query exists in the domain layer, per `getNetWorth`, but Home
  itself was never evidenced to need its own duplicate tile). Adding one
  without a reference basis would be exactly the "invent functionality"
  Section 0 forbids. Not added.

## Verdict

Home's current hierarchy is **consistent with the mandate's own
anti-over-dashboarding principle** even though it doesn't implement
every line of the suggested list verbatim — the suggested list itself
says "do not blindly implement this list; use actual user value and
reference evidence," which is exactly the standard applied here. The
three gaps above are recorded as disclosed, reasoned deferrals, not
oversights.

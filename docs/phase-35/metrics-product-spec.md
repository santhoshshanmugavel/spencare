<title>Phase 35 — Metrics Product Spec</title>

# Phase 35 — Metrics Product Spec

This refines `docs/phase-34/metric-framework.md` (still the fuller
reference for every metric's full formula/source detail) into this
phase's requested format, adding the BUSINESS QUESTION and DECISION
ENABLED framing on top of the USER QUESTION framing already established.
**No new analytics data exists in this codebase as of this phase** — every
metric below that depends on event data not currently emitted is marked
`BLOCKED — ANALYTICS DATA NOT AVAILABLE`, exactly as instructed, not
approximated or estimated.

## Activation

### Account created / First account
- **User question**: "Did I actually set up my finances?"
- **Business question**: "Is onboarding converting signups into real usage?"
- **Formula**: `count(users with >=1 accounts row) / count(signed-up users)`.
- **Source**: `accounts.created_at`, `profiles.created_at` — both exist today.
- **Time period**: cohort by signup week.
- **Interpretation**: low completion → friction before the first account, not a marketing problem.
- **Decision enabled**: prioritize onboarding-flow fixes over acquisition spend.
- **Empty state**: "Not enough signups yet" below n=20.
- **Privacy behavior**: counts only, no account name/balance.

### First transaction / First budget / First goal
- Same shape as above, keyed to `transactions.created_at` /
  `budgets.created_at` / `goals.created_at` — all exist today, no new
  instrumentation needed for the counting itself (a page-view event
  would still be needed to measure the FUNNEL to that point, which is
  BLOCKED — see Engagement).

## Engagement

### Weekly / Monthly Active Users
- **Status**: `BLOCKED — ANALYTICS DATA NOT AVAILABLE`. No page-view or
  session event is emitted anywhere in this codebase today. Do not
  estimate this from login timestamps alone — a login without any
  subsequent action is not "active use," and this codebase currently has
  no data to distinguish the two.

### Cash Flow / Goals / Budgets / Spensa usage
- **Status**: `BLOCKED — ANALYTICS DATA NOT AVAILABLE`, same dependency
  as above (route-level page-view events).

## Financial Awareness

### Safe-to-Spend usage
- **Status**: `BLOCKED — ANALYTICS DATA NOT AVAILABLE` for the
  "did they look at it" question specifically (would need a viewport-
  visibility event). The FIGURE itself is real, tested, and live-
  verified this engagement — only the "did a person actually look at
  it" telemetry is missing.

### Spending change / Income vs Expense
- **User question**: "Did my spending or income actually change?"
- **Business question**: "Is the delta insight actually informative, or
  ignored?"
- **Formula**: already computed and shown, not a new metric to build —
  `getCashFlowTrend`'s `comparison.expense.deltaPercent`
  (`packages/domain/application/src/queries/cashFlow.ts`, tested).
- **Decision enabled**: this is a DISPLAY metric already live; the open,
  BLOCKED question is whether people who see a large delta take any
  follow-up action — that requires a click-through event, not built yet.
- **Empty state**: `null` with no prior-month data, rendered honestly,
  never a fabricated "0%."
- **Privacy behavior**: skipped entirely under Privacy Mode (the whole
  trend chart is skip-rendered, not partially redacted).

### Category spending awareness
- Already computed and shown (`computeSpendingInsight`); same "display
  metric exists, click-through telemetry does not" split as above.

### Upcoming bill awareness
- **Status**: `BLOCKED — ANALYTICS DATA NOT AVAILABLE` for "did the user
  see/act on it" specifically; the Upcoming Bills feature itself is real
  and live (Phase 30B).

## Planning

### Budget creation / adjustment, Goal creation / contribution, Goal pace
- Creation/contribution counts are computable TODAY from existing tables
  (`budgets`, `goals`, `transactions` where `type='goal_contribution'`) —
  no new instrumentation needed for the counting itself.
- **Goal pace distribution** is fully computable today from
  `calculateGoalPaceStatus` (pure, already-tested domain-core function)
  applied to every active goal with a target date — a batch read, not an
  event pipeline. **Decision enabled**: if "behind" pace exceeds ~40%
  of goals sustained over time, that's real evidence the Goal Wizard's
  tiered cost estimates (`apps/web/lib/goal-wizard.ts`) are too
  aggressive on average, worth revisiting with real numbers instead of a
  guess.
- **Budget-adjustment funnel** (did someone open Edit Budget, and did
  they actually save a change) is `BLOCKED — ANALYTICS DATA NOT
  AVAILABLE`.

## Retention

### Activation / weekly / monthly retention
- **Status**: `BLOCKED — ANALYTICS DATA NOT AVAILABLE` for all three —
  every retention metric is, by definition, downstream of the same
  missing WAU/MAU event pipeline described above.

## What this phase did NOT do

Build or wire any analytics event pipeline. That remains a real,
scoped, but unbuilt piece of infrastructure — see
`docs/phase-34/metric-framework.md`'s "Dependency summary" for exactly
what event shape would unblock the rows above. Building it was not the
highest-value action available this phase (the Cash Flow reference-
fidelity fix was), and building it without being asked risks exactly
the "add analytics that collect unnecessary sensitive financial data"
mistake Section 26 of the prior phase's own mandate warned against —
it deserves its own deliberate design pass, not a rushed addition here.

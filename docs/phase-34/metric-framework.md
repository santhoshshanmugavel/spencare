<title>Phase 34 — Customer-Alpha Metric Framework</title>

# Phase 34 — Metric Framework

This is a **specification**, not a report of live numbers — no analytics
pipeline is deployed yet (see `docs/phase-34/customer-readiness.md`'s
Analytics row). Every metric below is defined precisely enough to
implement against the existing domain/application layer without
inventing new data, and every one is checked against the "does this
create decision value?" test (Section 26's "do not add analytics that
collect unnecessary sensitive financial data" and the mandate's own "no
vanity metrics" rule). Metrics that failed that test were left out
rather than padded in.

## Format

Each metric: NAME · USER QUESTION · DEFINITION · FORMULA · SOURCE ·
PERIOD · COMPARISON · INTERPRETATION · ACTION · PRIVACY BEHAVIOR ·
EMPTY STATE.

---

## Activation

### Account setup completion
- **User question:** "Has this person actually set up their finances?"
- **Definition:** first `accounts` row created for a user.
- **Formula:** `count(distinct users with >=1 account) / count(distinct signed-up users)`.
- **Source:** `accounts.created_at`, `profiles.created_at`.
- **Period:** cohort, by signup week.
- **Comparison:** week-over-week cohort trend.
- **Interpretation:** low completion → onboarding friction before the first account.
- **Action:** review the onboarding flow's account-adding step, not the marketing funnel.
- **Privacy behavior:** counts only; never logs account name/balance.
- **Empty state:** "Not enough signups yet to report" below n=20 in a cohort.

### First transaction
- **User question:** "Did this person actually start tracking real activity?"
- **Definition:** first `transactions` row (any type) after account creation.
- **Formula:** median days from first account to first transaction.
- **Source:** `transactions.created_at`.
- **Period:** rolling 30-day cohort.
- **Comparison:** vs. prior cohort.
- **Interpretation:** a long gap suggests the value of tracking isn't clear yet.
- **Action:** review the Cash Flow empty-state CTA copy/placement.
- **Privacy behavior:** counts/timestamps only.
- **Empty state:** n/a until >=1 account exists.

### First budget / First goal
- **User question:** "Did this person move from tracking to planning?"
- **Definition:** first `budgets` row / first `goals` row.
- **Formula:** `% of active users with >=1 budget` and `>=1 goal`, by week since signup.
- **Source:** `budgets.created_at`, `goals.created_at`.
- **Period:** rolling 30/60/90-day.
- **Comparison:** budget-adoption vs. goal-adoption rate (do users plan spending, saving, or both?).
- **Interpretation:** low goal adoption after Phase 33's wizard would specifically flag the wizard, not "goals" generically.
- **Action:** if low, check wizard drop-off step (see "Goal Wizard funnel" below) before assuming the feature itself is the problem.
- **Privacy behavior:** counts only.
- **Empty state:** "No budgets/goals created yet" in an internal dashboard, never shown to the end user as a "you're behind" nudge.

---

## Engagement

### Weekly / Monthly Active Users (WAU / MAU)
- **User question:** "Is this product part of someone's routine?"
- **Definition:** distinct users with >=1 authenticated page view in the trailing 7 / 30 days.
- **Formula:** `WAU = distinct(user_id) where last_seen_at >= now() - 7d`.
- **Source:** would require a session/page-view event, not currently emitted (see Analytics section below — this metric is BLOCKED until that instrumentation exists).
- **Period:** rolling 7d / 30d.
- **Comparison:** WAU/MAU ratio (stickiness).
- **Interpretation:** a low ratio means people set up once and don't return.
- **Action:** investigate which surface (Home? Spensa?) correlates with return visits once instrumented.
- **Privacy behavior:** a page-view event carries route name only, never a financial value.
- **Empty state:** n/a — this metric literally cannot be computed pre-instrumentation; reported as BLOCKED, not zero.

### Cash Flow engagement
- **User question:** "Are people actually reviewing where their money went?"
- **Definition:** distinct users who opened `/cash-flow` (any tab) in the period.
- **Formula:** `distinct(user_id) / WAU`.
- **Source:** page-view event (same BLOCKED dependency as WAU).
- **Period:** weekly.
- **Comparison:** vs. Home-only usage.
- **Interpretation:** if WAU is high but Cash Flow engagement is low, Home isn't successfully directing people deeper.
- **Action:** review Home's Cash Flow entry points/CTAs.
- **Privacy behavior:** route name only.
- **Empty state:** BLOCKED pending instrumentation.

### Goal usage / Budget usage / Spensa usage
Same shape as Cash Flow engagement above, scoped to `/goals`,
`/cash-flow/budgets`, `/spensa/*`. All BLOCKED pending the same
page-view instrumentation.

---

## Financial Awareness

### Safe-to-Spend view rate
- **User question:** "Do people actually look at the number the whole product is built around?"
- **Definition:** a Home or Cash Flow page render where the Safe-to-Spend card was in the initial viewport (not scrolled-to).
- **Formula:** `renders with Safe-to-Spend visible / total Home+Cash Flow renders`.
- **Source:** would need a client-side visibility event; not currently emitted. BLOCKED.
- **Period:** weekly.
- **Comparison:** n/a (baseline metric).
- **Interpretation:** near-100% is expected by construction (it's above the fold on both pages today) — a real drop would mean a layout regression, not a user-behavior problem.
- **Action:** if this ever drops, check for a layout regression first, not a "users don't care" conclusion.
- **Privacy behavior:** boolean visibility flag only, never the amount itself.
- **Empty state:** BLOCKED pending instrumentation.

### Spending-change awareness
- **User question:** "Do people notice when their spending shifts?"
- **Definition:** already computed, not tracked as an event — `getCashFlowTrend`'s month-over-month delta, shown on Home.
- **Formula:** existing `comparison.expense.deltaPercent` (domain-application, already tested).
- **Source:** `packages/domain/application/src/queries/cashFlow.ts`.
- **Period:** current vs. prior calendar month.
- **Comparison:** built into the metric itself (this month vs. last).
- **Interpretation:** already surfaced in-product; the OPEN metrics question is whether people who SEE a large delta take any follow-up action (click into Cash Flow) — that's the BLOCKED "insight interaction" metric below, not this one.
- **Action:** n/a — this is a display metric, already live.
- **Privacy behavior:** already respects Privacy Mode (the dashboard skips the whole trend chart when masked).
- **Empty state:** already handled — `null` when there's no prior-month data to compare against (no fabricated "0%").

### Category spending clarity
- **User question:** "Do people know where their biggest spending category is?"
- **Definition:** already computed and shown — `computeSpendingInsight`'s "top category" sentence on Cash Flow.
- **Formula:** existing, tested (`computeSpendingInsight`).
- **Source:** `apps/web/lib/transaction-presentation.ts`.
- **Interpretation/Action:** display metric, already live; no new instrumentation needed.
- **Privacy behavior:** category NAME is shown even when Privacy Mode is on (not itself sensitive); the PERCENTAGE and any amount are not shown under masking in the surrounding card.
- **Empty state:** returns `null` with zero transactions, rendered as an honest empty state, not a fabricated "0%."

---

## Planning

### Goal Wizard funnel
- **User question:** "Where do people give up while creating a goal?"
- **Definition:** step-by-step drop-off through the wizard's own `StepId` sequence (category → tripBand → name → amount → savings → date → account → summary → done).
- **Formula:** `count(users reaching step N) / count(users reaching step 1)` per step.
- **Source:** would need a client event per step transition; not currently emitted. BLOCKED.
- **Period:** rolling 30 days.
- **Comparison:** step-to-step within the same cohort.
- **Interpretation:** a sharp drop at one specific step (e.g., the custom-amount entry) points at that step's copy/UX, not "goals are unpopular."
- **Action:** redesign the specific step with the worst drop-off, not the whole wizard.
- **Privacy behavior:** step name + a boolean "used custom entry y/n" only, never the amount typed.
- **Empty state:** BLOCKED pending instrumentation.

### Goal contribution rate
- **User question:** "Do people keep funding goals after creating them, or is it one-and-done?"
- **Definition:** goals with >=1 `goal_contribution` transaction after the creation month.
- **Formula:** `% of goals with a contribution dated >30 days after creation`.
- **Source:** `transactions` (`type = 'goal_contribution'`), `goals.created_at`.
- **Period:** rolling 90 days.
- **Comparison:** vs. the wizard's own suggested monthly pace (are people saving as much as the plan suggested, or less?).
- **Interpretation:** low follow-through suggests the goal was created but not operationalized — worth a reminder/nudge feature, NOT worth inflating the wizard's own promised pace.
- **Action:** consider (not build yet) a gentle "you're behind pace" surfacing, reusing `calculateGoalPaceStatus` — already computed, no new domain logic required.
- **Privacy behavior:** counts and booleans only.
- **Empty state:** "No goals old enough to measure yet" below 30 days of history.

### Budget engagement rate
- **User question:** "Do people actually look at budgets after setting them, or set-and-forget?"
- **Definition:** distinct users who viewed `/cash-flow/budgets` after the month they created their first budget.
- **Formula:** same shape as Cash Flow engagement; BLOCKED pending page-view instrumentation.
- **Privacy behavior:** route name only.

### Goal pace distribution
- **User question:** "Across the whole user base, are goals realistic or overly ambitious?"
- **Definition:** distribution of `calculateGoalPaceStatus` across all active goals with a target date.
- **Formula:** `% reached / on_track / behind / no_schedule`.
- **Source:** already-computed, pure domain-core function; needs only a batch read, not new instrumentation.
- **Period:** point-in-time snapshot, weekly.
- **Interpretation:** a high "behind" percentage across the base suggests the Goal Wizard's suggested pace is too aggressive on average — a real, evidenced reason to revisit the cost-tier estimates in `apps/web/lib/goal-wizard.ts`, not a guess.
- **Action:** if "behind" exceeds ~40% sustained, review the wizard's tiered estimates.
- **Privacy behavior:** aggregate percentages only, never per-user goal names/amounts.
- **Empty state:** "No goals with a target date yet."

---

## Product Outcome / Quality

### Retention (W1/W4)
- **User question:** "Do people come back after the first week/month?"
- **Definition:** signed-up-in-week-N users who are still WAU in week N+1 / N+4.
- **Source:** BLOCKED (same page-view dependency).

### Error-rate metrics
- **User question:** "Is the product actually reliable for people?"
- **Definition:** server-action failure rate (`Result.ok === false`) for consequential commands (createGoal, createTransaction, addContribution, etc.), by command name.
- **Formula:** `count(err results) / count(total calls)`.
- **Source:** every command already returns a typed `Result` — a thin logging wrapper at the command-execution boundary would capture this without touching the commands themselves (an implementation task, not a definition gap).
- **Period:** daily.
- **Interpretation:** a spike in one command's error rate points precisely at that command, not "something is broken."
- **Action:** page-not-required-yet; treat as an internal reliability dashboard.
- **Privacy behavior:** command name + error code only, never the input payload (which could contain amounts).
- **Empty state:** n/a — zero calls means zero errors, correctly shown as "no data," not "100% healthy."

### Completion (goals/budgets reaching their end state honestly)
- **User question:** "Does the product actually help people finish what they start?"
- **Definition:** `% of goals reaching status = 'completed'` among goals with a target date now in the past.
- **Formula:** straightforward ratio over `goals.status`/`goals.target_date`.
- **Source:** existing `goals` table, no new instrumentation.
- **Privacy behavior:** aggregate only.
- **Empty state:** "No goals past their target date yet."

---

## What is explicitly OUT of scope (avoided vanity metrics)

- **"Total messages sent to Spensa"** as a headline metric — message count alone doesn't indicate whether Spensa was actually useful; a real "insight actioned" metric (did the user follow a suggestion?) would be meaningful, but inventing an "engagement score" from raw message volume was rejected as exactly the kind of vanity metric Section 8 forbids.
- **"Number of accounts connected"** as a success metric on its own — more accounts isn't inherently good if the user only needed one; account-setup COMPLETION (did they finish adding what they intended to) is tracked instead.
- **A composite "financial health score"** — this would require inventing a formula with no domain grounding (exactly what Section 5's "never manufacture benchmarks" prohibits). Not defined here.

## Dependency summary

Every BLOCKED metric above depends on one missing piece of
infrastructure: a lightweight page-view/step-event pipeline. This is a
deliberate, disclosed gap (Section 26 says "determine which events are
actually needed," not "fabricate the pipeline") — implementing it is a
real, scoped follow-up task, not a documentation gap.

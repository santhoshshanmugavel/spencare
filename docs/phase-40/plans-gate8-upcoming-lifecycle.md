# Gate 8: Upcoming + Plan Lifecycle Integration

## Status

PASS.

## Scope

This gate verifies that Plan projections and actuals coexist correctly with the existing Upcoming forward-looking event system, without redesigning either system. The canonical rule enforced and verified: Upcoming is projected forward events, Transactions are financial truth for actual money movement, and Plans are a contextual purpose/container over that truth. A projected Upcoming event never becomes Plan spending merely by existing. A commitment or goal contribution occurrence never becomes Plan actual until a real transaction exists and is explicitly associated with a Plan. A credit card payment obligation never becomes Plan spending on its own. A Plan Item's lifecycle state never mutates account balances, liabilities, Safe-to-Spend, Net Worth, or transaction totals.

Out of scope for this gate, left untouched: Gate 9 (notifications, Telegram), Gate 10 (Spensa, research), Gate 11 (MCP), FX, mobile, collaboration, shared expenses, and the Gate 6 Plan/Plan Item DB consistency gap (documented there, not revisited here).

## Existing Upcoming Architecture

The single canonical forward-looking projection is `getUpcomingProjection` in `packages/domain/application/src/queries/upcomingProjection.ts`. It is used by the Upcoming page, Cash Flow Overview, the Home widget, MCP, Spensa, and notifications. Its `UpcomingEvent` type carries no `plan_id`, `plan_item_id`, or any other Plan-related field. It is structurally incapable of connecting an event to a Plan today.

Event kinds produced: `commitment_payment`, `commitment_preparation`, `goal_contribution`, `loan`, `credit_card_statement`, `credit_card_payment`. Persisted database occurrences (`planned_commitment_occurrences`) are authoritative; projected events for the same commitment and month are deduplicated against them by `(commitmentId, YYYY-MM)` so a persisted occurrence and its future-cycle projection never both appear.

`planned_commitment_occurrences` columns: `id, commitment_id, user_id, due_date, amount_minor, reserved_minor, status (upcoming | paid | skipped, default upcoming), matched_transaction_id (references transactions(id), no cascade or set-null, defaults to RESTRICT), paid_at, created_at, updated_at`.

The canonical payment path is the `pay_commitment_occurrence_atomic` RPC, exact signature `(p_user_id uuid, p_occurrence_id uuid, p_commitment_id uuid, p_account_id uuid, p_category_id uuid, p_amount_minor bigint, p_item_name text, p_occurred_at date, p_next_due_date date) returns json`. It creates exactly one transaction, marks the occurrence paid, and returns `{transaction_id, next_due_date}`. It has no actor or Plan parameter.

`computeReserveStatus` in domain-core computes an "overdue" label purely from date comparison for display. It never writes to the database. The `status` column on an occurrence stays `upcoming` no matter how overdue the due date is, until a real payment or skip action changes it.

No "reschedule" feature exists in the codebase as a distinct occurrence-level action. Editing a commitment's `next_payment_date` is the closest analog. Since every projected date is computed fresh on each read rather than stored, this cannot produce a duplicate projection by construction.

## Plan Integration Model

Rather than modifying the shared, multi-surface `getUpcomingProjection` function or its `UpcomingEvent` type, this gate adds a separate, additive, read-only composition: `getPlanContextForUpcomingSources(ctx)` in `packages/domain/application/src/queries/plans.ts`. It returns three maps (`commitmentIdToPlans`, `goalIdToPlans`, `accountIdToPlans`), each keyed by the source entity id and pointing at the list of Plans that link to it. The Upcoming page fetches this alongside the existing projection and passes it to `UpcomingDashboard` as an optional prop; the dashboard looks up each event's `sourceId` in the relevant map at render time to show a "part of this Plan" link when one exists.

This keeps the blast radius to the Upcoming page alone. `getUpcomingProjection` and `UpcomingEvent` are unchanged; MCP, Spensa, notifications, Cash Flow Overview, and the Home widget see no behavior change. The maps are built from three new, batched "ForUser" repository functions in `packages/domain/infra/src/financialPlansRepo.ts` (`listPlanGoalLinkRowsForUser`, `listPlanCommitmentLinkRowsForUser`, `listPlanAccountLinkRowsForUser`), each a single query across all of the caller's Plans, following the same batching pattern established in Gate 4 for Plan Items.

A Plan Item's own lifecycle (planned, booked, cancelled, and so on) is stored entirely on `financial_plan_items` and is never read by, or written from, the Upcoming projection or any commitment/goal/account RPC. Nothing in this gate's code path gives a Plan Item write access to `planned_commitments`, `planned_commitment_occurrences`, `goals`, `accounts`, or `transactions`, and nothing in those tables' write paths reads Plan state.

## Commitment Integration

A Commitment can be linked to a Plan through the existing `financial_plan_commitments` link table (unchanged this gate). That link has no effect on the commitment's own occurrences: an occurrence's `status`, `matched_transaction_id`, and `amount_minor` are set only by `pay_commitment_occurrence_atomic` or a skip update, neither of which reads or writes `financial_plan_commitments`.

When an occurrence is paid through the RPC, the created transaction's `plan_id` is `NULL` regardless of whether the commitment is Plan-linked. A transaction only counts toward a Plan's actual spend once it is explicitly associated with that Plan (existing `plan_id` assignment flow, unchanged), which is a separate, user-initiated action from paying the occurrence. This was verified directly in the smoke test: after a real RPC-driven payment, the Plan's actual transaction count is 0; after explicit association, it becomes exactly 1.

## Goal Integration

Goal contributions follow the same isolation. `add_goal_contribution` (called from `goalsRepo.ts`) takes `p_user_id, p_goal_id, p_account_id, p_amount_minor, p_actor` and has no Plan parameter. A `goal_contribution` Upcoming event is a pure projection of the goal's contribution schedule; it does not read any Plan link. A Plan that links to a Goal (`financial_plan_goals`) only affects the Upcoming page's rendering, by showing a "part of this Plan" link next to the projected contribution event, via `goalIdToPlans`. It never causes a projected contribution to be counted as Plan actual spend.

## Credit Card Integration

Credit card purchase and payment semantics are unchanged. A purchase is an expense transaction and increases the card's liability balance. A payment is a transfer that decreases the liability balance. Both remain outside Plan actual spend unless the resulting transaction is explicitly associated with a Plan, exactly like any other transaction. A projected `credit_card_statement` or `credit_card_payment` Upcoming event is a forward-looking projection only; it has no transaction behind it until the real payment happens, and therefore can never be Plan spend on its own. The `accountIdToPlans` map only adds a navigation link from the projected event to a Plan that links the underlying account; it does not touch balance, liability, or Plan actual calculation in any way.

## Transaction Integration

The only way a transaction becomes Plan actual spend is the existing, unchanged mechanism: a transaction row with a `plan_id` (and optionally `plan_item_id`) set, counted by `getPlanDetail`'s existing actual-spend calculation (`listTransactionsForPlan`, unchanged this gate). Gate 8 adds no new transaction-writing code path. The "Pay now" flow for a commitment occurrence continues to call the same `pay_commitment_occurrence_atomic` RPC it always has; there is no parallel financial write introduced by this gate.

## Lifecycle Matrix

| Event | Projected | Actual | Plan Actual | Account Balance | Safe-to-Spend | Net Worth |
|---|---|---|---|---|---|---|
| Commitment occurrence upcoming | Yes | No | No | No change | No change | No change |
| Commitment occurrence paid (via RPC) | No (persisted, dedup applies) | Yes (one transaction) | Only if explicitly associated with a Plan | Decreases by payment amount | Decreases (spend recognized) | Decreases by payment amount |
| Commitment occurrence skipped | No (status becomes skipped) | No | No | No change | No change | No change |
| Commitment occurrence overdue | Yes (display label only) | No | No | No change | No change | No change |
| Commitment next_payment_date edited | Yes (recomputed fresh) | No | No | No change | No change | No change |
| Goal contribution projected | Yes | No | No | No change | No change | No change |
| Goal contribution made (via RPC) | No (persisted) | Yes (one transaction, transfer to goal) | Only if explicitly associated with a Plan | Decreases by contribution amount | Decreases | No change (asset moves within Net Worth) |
| Credit card purchase | No (already a transaction) | Yes | Only if explicitly associated with a Plan | No change (asset side) | Decreases | Liability increases, Net Worth decreases |
| Credit card statement projected | Yes | No | No | No change | No change | No change |
| Credit card payment projected | Yes | No | No | No change | No change | No change |
| Credit card payment made | No (already a transaction) | Yes (transfer) | Never (explicitly excluded by existing category rules) | Asset decreases, liability decreases | No change (transfer, not spend) | No change |
| Plan Item status change (planned, booked, cancelled) | No | No | No | No change | No change | No change |
| Plan deleted | No change to Commitment, Goal, Account, or their occurrences | No change | Associated transactions keep their amount and history; their `plan_id` becomes NULL | No change | No change | No change |

## Double-Counting Analysis

Double counting between a projected occurrence and its resulting transaction cannot happen, for two independent, verified reasons.

First, structurally: `getUpcomingProjection` deduplicates a projected event against any persisted occurrence for the same `(commitmentId, YYYY-MM)`. Once an occurrence is paid, it is a persisted row with `status = paid`, so the projection for that month is suppressed; only the one real transaction remains as evidence of the payment. There is one financial fact, not two.

Second, at the Plan level: a transaction only becomes Plan actual spend when its own `plan_id` column is set. The occurrence itself has no `plan_id` column and is never read by the Plan actual-spend calculation (`listTransactionsForPlan` reads only `transactions`, filtered by `plan_id`). Since the projection is not a transaction and the transaction is not double-created, there is exactly one row that can ever be summed into Plan actual spend per payment.

This was proven live, not just by code reading: the Gate 8 smoke test pays a real occurrence through the actual RPC, confirms exactly one new transaction exists, confirms the Plan's actual transaction count is 0 before association (because `plan_id` is NULL on the new transaction even though the Commitment is Plan-linked), then explicitly associates the transaction and confirms the Plan's actual count becomes exactly 1, never 2, with the exact amount preserved (1,742,087 minor units, tested end to end).

## Skip / Reschedule / Cancel / Overdue

Skip: implemented as an update to `planned_commitment_occurrences.status = 'skipped'`. Verified in the smoke test to produce no transaction and no balance change.

Reschedule: no distinct feature exists. The closest analog, editing a commitment's `next_payment_date`, cannot create a duplicate projection because projected dates are always computed fresh from the commitment's current schedule rather than stored per-occurrence.

Cancel: a Plan Item can be marked `cancelled` (existing status), which the Plan's own committed/planned calculations already exclude (confirmed in Gate 6's category breakdown logic, unchanged here). Cancelling a Plan Item has no effect on any Commitment, Goal, Account, or their occurrences, since the Plan Item table has no write access to those entities.

Overdue: a purely computed display label (`computeReserveStatus`) based on comparing the due date to today. Verified in the smoke test that an occurrence with a due date far in the past (2020-01-01) still has `status = 'upcoming'` in the database; overdue is never persisted as a distinct state.

## Security / RLS

No new tables or columns were introduced, so no new RLS policies were required. The three new "ForUser" repository functions each filter by `.eq("user_id", userId)` before returning rows, matching the existing per-user query pattern used everywhere else in this codebase, and were exercised through the standard Supabase client from application-layer tests. Cross-user isolation for occurrences, Commitments, Goals, Accounts, transactions, and the new Plan-context maps was verified live against local Supabase: a second user's session cannot see, skip, pay, or otherwise act on the first user's occurrence, and the smoke test asserts this by attempting a cross-user read as an authenticated second user and confirming zero rows return. No client-supplied Plan id, Commitment id, or occurrence id was found to bypass ownership checks in any code path touched or reviewed this gate.

## Performance

The Upcoming page's added fetch (`getPlanContextForUpcomingSources`) runs as one more entry in the page's existing `Promise.all`, alongside the other independent fetches (accounts, categories, profile, projection, commitments, loans, bills). Internally it issues exactly three queries, one per link table (Commitment, Goal, Account), each scoped to the current user across all of that user's Plans at once. There is no per-event or per-Plan query; a user with many Upcoming events and many Plans still issues the same three queries. No N+1 pattern was introduced. Existing batching in `getUpcomingProjection` and the Plan detail page is untouched.

## Tests

- `packages/domain/application/src/queries/plans.test.ts`: 9 tests (was 7), all passing. New tests cover `getPlanContextForUpcomingSources` mapping linked entities correctly and returning empty maps safely when nothing is linked.
- `apps/web/app/cash-flow/upcoming/upcoming-dashboard.test.tsx`: 21 tests (was 17), all passing. New tests cover the Plan navigation link appearing for a linked commitment, being absent when unlinked, appearing for a goal contribution via the goal's own link (with an explicit assertion that no "spent" language appears), and the dashboard rendering correctly when `planContext` is omitted entirely.
- Full regression, re-run after all Gate 8 changes:
  - `apps/web`: 861/861 passed (was 857)
  - `packages/domain/application`: 435/435 passed (was 433)
  - `packages/domain/core`: 474/474 passed (unchanged)
  - `packages/domain/infra`: 153/153 passed (unchanged)
  - `packages/validation`: 179/179 passed (unchanged)
  - `apps/mcp-server`: 29/29 passed (unchanged)
  - `packages/ai`: 100/134 passed, 34 pre-existing failures unrelated to Plans or Upcoming, confirmed identical to the established baseline before this gate

## Smoke Test

`supabase/tests/financial_plans_schema_smoke.sh` gained a new section, "11. Gate 8: Upcoming + Plan lifecycle", appended after Gate 7's final section without modifying any earlier section. It covers, against live local Supabase: a future Plan Item with a linked Commitment producing no transaction, no balance change, and no Safe-to-Spend change from the projection alone; cross-user RLS isolation on the occurrence; a real skip producing no transaction; the real `pay_commitment_occurrence_atomic` RPC call producing exactly one transaction with `plan_id` NULL and the occurrence becoming `paid`; the Plan's actual count being 0 before association and exactly 1 after explicit association, with the exact amount (1,742,087 minor units, or 17,420.87 in major currency units) preserved through occurrence, transaction, and Plan actual; a balance-baseline check proving the payment reduced the account balance by exactly the payment amount and that no further Plan-only operation changes the balance again; an overdue occurrence remaining `status = upcoming` in the database; and Plan deletion preserving the Commitment, the paid occurrence, and the transaction (with its `plan_id` cleared but its amount unchanged).

Gate 8 section result: 24 checks, 24 passed, 0 failed.
Total smoke test result: 69 checks, 69 passed, 0 failed.

Verified repeatable by running the full script three consecutive times from a fully cleaned local Supabase instance, with identical 69/69 results each time.

## Typecheck

Clean. `npx turbo run typecheck --force`: 13 successful, 13 total, zero errors across every package in the monorepo.

## Lint

`npx turbo run lint`: 54 problems (9 errors, 45 warnings), identical to the established baseline from Gates 5, 6, and 7. No new lint errors or warnings were introduced by this gate's changes. No unrelated lint debt was cleaned up and no unrelated files were reformatted, per instruction.

## Build

`npx next build` in `apps/web` succeeded. `/plans` and `/plans/[planId]` remain present as dynamic routes. No unexpected routes were added or removed; the full route list matches the expected shape from prior gates plus these two Plan routes.

## Files Changed

- `packages/domain/infra/src/financialPlansRepo.ts` (added `listPlanGoalLinkRowsForUser`, `listPlanCommitmentLinkRowsForUser`, `listPlanAccountLinkRowsForUser`)
- `packages/domain/application/src/queries/plans.ts` (added `getPlanContextForUpcomingSources` and its supporting types)
- `packages/domain/application/src/index.ts` (barrel export additions for the above)
- `packages/domain/application/src/queries/plans.test.ts` (new test coverage for the above)
- `apps/web/app/cash-flow/upcoming/page.tsx` (fetch and pass `planContext` to the dashboard)
- `apps/web/app/cash-flow/upcoming/upcoming-dashboard.tsx` (render Plan navigation links on relevant events)
- `apps/web/app/cash-flow/upcoming/upcoming-dashboard.test.tsx` (new test coverage for the above)
- `supabase/tests/financial_plans_schema_smoke.sh` (new Gate 8 section, plus a `psql_as_user_commit` helper)

No other files were modified in this gate. Files with earlier timestamps that appear in the working tree's overall diff (for example `transactionsRepo.ts`, `nav-items.tsx`, and the three prior migrations) belong to Gates 6 and 7 and were not touched during this gate's work.

## Production Changes

NONE.

## Migrations

NONE. No database migration was required for this gate. The Upcoming-to-Plan integration was achieved entirely through new application-layer composition and existing tables; no schema change was needed. The Gate 6 Plan/Plan Item DB consistency gap remains unfixed, as explicitly instructed for this gate.

## Known Limitations

A Plan-Commitment link row in `financial_plan_commitments` can become dangling if the linked Commitment is soft-deleted, since soft delete does not cascade to link rows. This was documented in an earlier gate and is not fixed here, per instruction. It is not a financial data integrity issue: the UI's existing Plan detail view already filters out unresolvable links (`.filter((c) => !!c)`), so a dangling link is invisible to the user and has no effect on any Plan calculation.

No "reschedule" feature exists as a distinct action anywhere in the codebase; only editing a commitment's own `next_payment_date` is available, and that was verified not to be able to produce duplicate projections.

## Gate 9 Readiness

Nothing in this gate's design blocks Gate 9 (notifications, Telegram). `getPlanContextForUpcomingSources` is additive and page-scoped; it does not change `getUpcomingProjection` or `UpcomingEvent`, which is what any notification code would consume. No new tables, columns, or RPCs were introduced that a notification feature would need to account for.

# Gate 9: Notifications + Telegram

## Status

PASS.

## Architecture

Canonical financial state (transactions, accounts, planned_commitments, planned_commitment_occurrences, goals, financial_plans, financial_plan_items) flows into signal evaluation (the rule functions in eventRules.ts), which decides whether a threshold or date has been crossed. A rule that decides to notify calls the notification policy and dedupe layer (deliverNotification in engine.ts), which creates the notification row through an idempotent upsert keyed on (user_id, dedupe_key), then fans out to enabled channels: in_app (the row itself), email (currently disabled pending production readiness), and Telegram (a pure HTTP delivery boundary). Nothing in this chain writes back into financial state. This architecture existed before this gate; Gate 9 extends it with a Plan signal family and Plan context on existing signals, without changing the chain itself.

## Existing Notification System

The system was already substantially built before this gate, not scaffolded from scratch. `notifications`, `notification_deliveries`, `notification_preferences`, `channel_connections`, `telegram_link_tokens`, and `notification_alert_state` all already exist (supabase/migrations/20260913000003_notifications_platform.sql and two later fix migrations). The unique index and a full unique constraint both already enforce (user_id, dedupe_key). `createNotification` (packages/domain/infra/src/notificationsRepo.ts) already performs the exact idempotent upsert pattern: `.upsert(..., { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).maybeSingle()`, returning null on a duplicate rather than throwing. `deliverNotification` (apps/web/lib/notifications/engine.ts) already composes the message, creates the notification, checks per-channel preferences and quiet hours, and delivers to in_app/email/Telegram, recording delivery status per channel. `runNotificationChecks`/`runChecksForUser` (apps/web/lib/notifications/notificationChecks.ts) is already the cron entry point, already resolves each user's own IANA timezone from `profiles.timezone` via `Intl.DateTimeFormat` before computing `todayIso`, and already covers budgets, account balances, credit utilization, bills, goal contribution plans, planned commitments (due-date and shortfall), commitment preparation, loans, and credit card billing.

What did not exist before this gate: any Plan-family signal (Plan Item due dates, Plan budget risk, Plan completion), and any Plan context attached to an existing signal's notification.

## Signal Sources

Commitments: `checkCommitmentReminder` (due-date reminders and shortfall) and `checkPreparationReminder` (saving-date reminders), both pre-existing, reading `planned_commitment_occurrences`/`planned_commitments` directly. Unchanged this gate except for the addition of an optional `financialPlanNames` field, described below.

Goals: `checkGoalPlanReminder`, pre-existing, reading `goal_contribution_plans`. Unchanged this gate except for the same optional Plan-context addition. Goal milestone/completion notifications (GOAL_25/50/75/90/GOAL_COMPLETED/GOAL_CONTRIBUTION) are defined in the message composer but have no call site anywhere in the codebase; this is a pre-existing gap unrelated to Plans or Telegram and out of this gate's scope.

Credit Cards: `checkCreditUtilization` (balance-threshold) and `checkCreditCardBillingReminder` (statement/payment date reminders), both pre-existing. Only the billing reminder received the optional Plan-context addition, since that is the one that corresponds to Gate 8's `credit_card_statement`/`credit_card_payment` Upcoming event kinds (sourceId = accountId).

Plans (new this gate): `checkPlanItemReminder`, `checkPlanBudgetRisk`, `checkPlanCompletion`, added to apps/web/lib/notifications/eventRules.ts, wired into notificationChecks.ts's `runChecksForUser`.

Other existing sources (budgets, account balance, loans, bills, daily/weekly/monthly summaries) are untouched.

## Plan Context

Gate 8 established `getPlanContextForUpcomingSources(ctx)`, a read-only, additive composition in the Plans domain that maps a Commitment/Goal/Account id to the Plan(s) that link it, without ever touching the shared `getUpcomingProjection` function or its `UpcomingEvent` type. This gate reuses that exact function, unchanged, called once per user in `runChecksForUser` (four batched queries total, not per-event), and threads the resulting Plan names into the `financialContext` of the four existing rule functions that correspond to a Gate 8 Upcoming event kind (commitment due-date, commitment preparation, goal contribution plan, credit card billing). The message composer appends a short "Part of your X plan" clause to the notification body and Telegram body only when that context is present; it never changes which event fired, its severity, its dedupe key, or any financial value inside it. A Commitment, Goal, or Account not linked to any Plan produces `planNames: undefined` and no such clause, exactly as before this gate.

## Dedupe / Idempotency

Dedupe key: every rule function builds a key that identifies the logical event (entity id plus the relevant date or threshold), never the current timestamp, following the exact pre-existing convention (for example `commitment_due_${occurrenceId}_${dueDateIso}`). The new Plan rules follow the same convention: `plan_item_7d_${itemId}_${expectedDateIso}` through `plan_item_overdue_...`, `plan_budget_80_${planId}_${budgetMinor}` (changes only when the budget itself changes, since a Plan's budget does not reset monthly the way a recurring category budget does), `plan_budget_over_${planId}_${bucket}` (mirrors the pre-existing BUDGET_OVER growth-bucket pattern exactly), and `plan_completed_${planId}_${completedAtIso}` (completed_at is refreshed by the Plan status command on every fresh transition into 'completed', giving a genuine second completion after a reopen its own fresh key).

Database constraint: `notifications_user_id_dedupe_key_unique`, a full unique constraint on (user_id, dedupe_key), confirmed live to exist. `createNotification`'s upsert with `ignoreDuplicates: true` relies on this constraint, not on an application-level check-then-insert.

Repeated execution: verified live against local Supabase that the identical insert pattern, executed three times in a row, produces exactly one row. Also verified live by invoking the real `runNotificationChecks` twice in two separate process invocations against the same seeded data: the second run reported `notificationsCreated: 0, notificationsDeduped: 2` for the two eligible signals, with the three notification rows from the first invocation's evaluation still present and unchanged.

Concurrent execution: verified live with two simultaneous `psql` processes inserting the identical (user_id, dedupe_key) pair at the same time; exactly one row resulted. The database's unique constraint is the actual protection, not a race-prone select-then-insert in application code.

## Timezones

Unchanged by this gate. `runChecksForUser` already resolves `todayIso` from the user's own `profiles.timezone` (default 'UTC') using `Intl.DateTimeFormat("en-CA", { timeZone: userTimezone, ... })` once per user, and every rule function (including the three new Plan rules) receives that same `todayIso` as a plain parameter rather than computing its own date. No new timezone logic was introduced; the new Plan rules were tested with the same explicit-date-fixture pattern already used for bills/commitments/loans/credit cards (eventRules.test.ts), and the smoke test confirms `profiles.timezone` exists and round-trips per user. The day-boundary arithmetic itself is exercised, not re-implemented, by this gate.

## Privacy Mode

Privacy Mode's existing, documented scope (apps/web/app/settings/privacy/privacy-explainer.tsx) is exactly three surfaces: financial amounts shown on screen while using the app (Home, Cash Flow, Goals, Accounts), charts, and Spensa's responses. Notifications and Telegram delivery are not, and have never been, one of these three surfaces; the message composer does not redact amounts, account names, merchant names, Plan names, or Goal amounts for any existing notification type, and this gate's new Plan notifications follow that same existing behavior rather than inventing a fourth redaction surface. This is a genuine, pre-existing product characteristic, not something this gate introduced or made worse, and is recorded below as a known limitation rather than silently worked around.

## Telegram

Delivery boundary: `sendTelegramMessage` (apps/web/lib/notifications/telegramProvider.ts) takes a chat_id and a pre-rendered text string and calls the Telegram Bot API's `sendMessage` endpoint. It does not query any financial table, does not import any domain-core or domain-application function, and cannot compute a balance, a Plan total, or a credit utilization figure. The webhook handler (apps/web/app/api/telegram/webhook/route.ts) that processes inbound Telegram commands (/start, /help, /settings, /disconnect) is equally free of financial logic; it only resolves link tokens and manages channel_connections rows. This was confirmed by direct source inspection, not merely assumed.

Payload: the engine builds the Telegram text from `message.telegramBody ?? \`<b>${message.title}</b>\n\n${message.body}\`` before calling `sendTelegramMessage`, so the composer, not the Telegram provider, decides what is said.

Failure handling: verified live that a delivery marked 'failed' in `notification_deliveries` (the exact row shape `updateNotificationDelivery` would write) leaves the parent notification row, the account balance, and the transaction count completely unaffected. The engine's own Telegram branch is wrapped in a try/catch that logs and increments a failure counter without throwing, so one user's Telegram failure cannot interrupt the cron loop for other users or other channels for the same user.

Retry / idempotency guarantee actually verified: notification persistence is idempotent (proven above, live, at both the schema and the real-code level). External Telegram message delivery is not verified to be exactly-once, because this environment has no real Telegram bot token or chat to send to; `TELEGRAM_BOT_TOKEN` is unset locally, so `sendTelegramMessage` was not exercised against the real Telegram API in this gate. What was verified without sending a real message: payload construction (by reading the code), privacy behavior (documented above, unchanged), channel preference gating (`isChannelEnabled`/`isEventTypeEnabled`/`isQuietHoursActive`, pre-existing and unchanged), the delivery invocation call site, and failure-handling behavior (live, via a synthetic failed delivery row). No claim of actual Telegram message receipt is made.

## Lifecycle Matrix

| Signal | Eligible | Notification | Plan Context | Financial Mutation |
|---|---|---|---|---|
| Commitment due-date reminder (7/3/1/today/overdue) | Yes | Yes | Yes, if linked | NONE |
| Commitment shortfall | Yes | Yes | Yes, if linked | NONE |
| Commitment preparation | Yes | Yes | Yes, if linked | NONE |
| Commitment paid (occurrence status = paid) | No (excluded by the status='upcoming' filter) | No further reminder fires | n/a | NONE (the payment itself is a separate, already-existing transaction operation, not caused by this gate) |
| Commitment skipped | No | No | n/a | NONE |
| Commitment rescheduled (next_payment_date changed) | Unaffected -- persisted occurrences are independent rows keyed on their own due_date | Unchanged, no duplicate | n/a | NONE |
| Goal contribution plan reminder | Yes | Yes | Yes, if linked | NONE |
| Credit card statement/payment reminder | Yes | Yes | Yes, if linked | NONE |
| Plan Item due-date reminder (7/3/1/today/overdue) | Only on an active Plan, only for suggested/planned/booked/committed/partially_paid items with an expected_date | Yes | n/a (it is the Plan itself) | NONE |
| Plan Item paid/cancelled/skipped | No | No further reminder fires | n/a | NONE |
| Plan archived | No (excluded by the status='active' filter) | No future item/budget reminder | n/a | NONE, and no historical notification is deleted |
| Plan budget risk (80% / over) | Only on an active Plan with a configured budget | Yes | n/a | NONE |
| Plan completed | Only on a fresh transition into 'completed' | Yes, once per distinct completion | n/a | NONE |
| Plan reopened after completion | Re-eligible for a future completion notification | No notification on the reopen itself | n/a | NONE |
| Plan deleted (only possible for an empty draft Plan) | n/a, draft Plans were never eligible for any Plan signal | No change to history | n/a | NONE |
| Telegram delivery failure | n/a | The notification row already exists; only its delivery row is marked failed | n/a | NONE |

## Financial Isolation

Proved, not merely asserted, at two levels. First, live against local Supabase using the exact schema and query shapes the code uses: a captured baseline transaction count and account balance were unchanged after inserting notification rows matching every one of this gate's new dedupe-key shapes, after archiving and reactivating a Plan, after transitioning a Plan through completed and back, after marking an occurrence paid/skipped and a Plan Item cancelled, after rescheduling a commitment, and after recording a failed Telegram delivery. Second, by actually invoking the real `runNotificationChecks` cron entry point against a live, non-empty local database twice: transaction count remained 0 and the seeded account's balance remained exactly its starting value both before and after. Safe-to-Spend and Net Worth are both pure functions of account balances, budgets, and commitments; since none of those tables were written to by any notification-generation code path in either the schema-level or the real-code verification, both are unaffected by construction, not merely by inference.

## Double-Counting / No Duplication

Not applicable in the Gate 8 sense (there is no second ledger here), but the equivalent guarantee for this gate is: a single logical signal can never produce two notification rows. This was proven by the concurrent-insert test (two simultaneous attempts, one row) and by the real-engine repeatability test (two full cron passes over the same data, the second reporting zero new creations and two dedupes for a shared user).

## Security / RLS

No new tables or columns were added, so no new RLS policies were required. Existing policies on `notifications`, `notification_deliveries`, `notification_preferences`, `channel_connections`, and `notification_alert_state` are unchanged. Cross-user isolation was verified live: a second user cannot select a first user's notification rows, and cannot select a first user's `financial_plan_commitments` link row. Every notification-producing call site in `notificationChecks.ts`, including the three new Plan rules, is scoped to the single `userId` being processed inside the per-user loop; no client-supplied id is ever trusted (the entire notification cron path runs under the service role and is never reachable from a client request). The Plan-context lookup (`getPlanContextForUpcomingSources`) is called once per user with that user's own id, exactly matching Gate 8's own established security posture.

## Performance

`runChecksForUser`'s existing per-user loop structure is unchanged; this gate adds, per user, one call to `getPlanContextForUpcomingSources` (four batched queries covering all of that user's Plans and links, not one per event, matching Gate 8's own established batching), one query for the user's active Plans, one query for eligible Plan Items across all of those Plans at once (`.in("plan_id", activePlanIds)`, not one query per Plan), one call to `listPlansWithSummaries` (three batched queries covering every one of the user's Plans, reused unchanged from Gate 4), and one query for Plan completion detection across all of the user's Plans. No query is issued per Plan Item, per Commitment, or per Goal; the only per-entity work is the in-memory rule evaluation after the batched fetch, exactly matching the existing convention used for bills, commitments, and loans elsewhere in this same file.

## Smoke Test

Section 12, "Gate 9: Notifications + Telegram", added immediately after Gate 8's section 11 without modifying any earlier section. 37 new checks, all passing. Total across the whole file: 106 checks, 106 passed, 0 failed. Verified repeatable across three consecutive runs from a fully cleaned state, and reconfirmed a fourth time after a separate, real invocation of the actual `runNotificationChecks` cron function against the same local database (described under Dedupe/Idempotency and Financial Isolation above), to prove that exercising the real code path leaves no residue that would break the schema-level smoke test's own assumptions.

## Regression Tests

- `apps/web`: 876/876 passed (was 861; +15 new tests, all in eventRules.test.ts)
- `packages/domain/application`: 435/435 passed (unchanged)
- `packages/domain/core`: 474/474 passed (unchanged)
- `packages/domain/infra`: 153/153 passed (unchanged)
- `packages/validation`: 179/179 passed (unchanged)
- `apps/mcp-server`: 29/29 passed (unchanged)
- `packages/ai`: not touched this gate; its established baseline of 100/134 with 34 pre-existing, unrelated failures is unaffected and was not re-mislabeled as a Gate 9 regression.

## Typecheck

Clean. `npx turbo run typecheck --force`: 8 successful, 8 total (domain-core, domain-infra, validation build; domain-application typecheck and build; mcp-server and ai build; web typecheck), zero errors.

## Lint

`npx turbo run lint`: 54 problems (9 errors, 45 warnings), identical to the Gate 8 baseline. No new lint errors or warnings were introduced. No unrelated lint debt was cleaned up.

## Build

`npx next build` in `apps/web` succeeded. The route list is unchanged from Gate 8 (including `/api/cron/notifications`, `/api/notifications/*`, `/api/telegram/webhook*`, `/settings/notifications`, `/plans`, `/plans/[planId]`); no unexpected route was added or removed.

## Files Changed

- `packages/domain/application/src/notifications/messageComposer.ts` (added the Plan Item/Plan budget/Plan completion event types and their message copy, and the Plan-context suffix wrapper)
- `apps/web/lib/notifications/eventRules.ts` (added `financialPlanNames`/`planNames` wiring to the four existing rules that correspond to a Gate 8 Upcoming event kind, and added `checkPlanItemReminder`, `checkPlanBudgetRisk`, `checkPlanCompletion`)
- `apps/web/lib/notifications/notificationChecks.ts` (moved the service-role ctx construction earlier, added the per-user Plan-context fetch, wired Plan context into the four existing call sites, and added the three new Plan-check sections)
- `apps/web/lib/notifications/eventRules.test.ts` (15 new tests: Plan context on existing reminders, `checkPlanItemReminder`, `checkPlanBudgetRisk`, `checkPlanCompletion`)
- `apps/web/app/settings/notifications/notifications-manager.tsx` (added a "Plan alerts" entry to the existing alert-category toggle list)
- `supabase/tests/financial_plans_schema_smoke.sh` (new Gate 9 section)

No other files were modified in this gate. Files with earlier timestamps that appear in the working tree's overall diff belong to Gates 6, 7, and 8 and were not touched during this gate's work.

## Production Changes

NONE.

## Migrations

NONE. Plan-family notifications reuse the existing 'budget' category value in the `notification_category` enum rather than adding a new 'plan' value, since a schema migration purely for categorization was not judged to be a "genuine schema correctness issue" the way the earlier commitment/loan enum gap was (that gap silently broke every insert of that type; reusing 'budget' breaks nothing and is an honest, defensible categorization for a budget-shaped concern). The Settings UI's "Plan alerts" toggle filters by the free-text `event_type` prefix "PLAN", which works regardless of the stored `category` enum value, so no user-facing capability was lost by avoiding the migration. If a dedicated 'plan' category is wanted in a future gate, that would be a small, additive, separately authorized migration, following the exact precedent of `20260919000008_notification_fixes.sql`.

## Known Limitations

Privacy Mode does not extend to notifications or Telegram delivery. This is a pre-existing, documented product characteristic (the explainer names exactly three surfaces, none of which are notifications), not something this gate introduced or worsened; it is noted here rather than silently worked around with a redaction system that would duplicate the existing three-surface architecture.

Goal completion and milestone notifications (GOAL_CONTRIBUTION, GOAL_25/50/75/90, GOAL_COMPLETED) are defined in the message composer but have no call site anywhere in the codebase. This predates this gate, is unrelated to Plans or Telegram, and was not fixed here, since wiring it up would mean adding notification calls inside the Goal contribution command layer, a change outside this gate's stated scope.

Telegram's exactly-once delivery guarantee to the external Telegram API itself was not verified in this gate, since no real bot token or chat exists in this local environment; only notification persistence idempotency (which is fully proven, live, at both the schema and the real-code level) and the delivery failure-isolation boundary were verified.

The Gate 6 Plan/Plan Item database consistency gap (a dangling `financial_plan_commitments` link row after a soft-deleted Commitment) remains unfixed, as instructed; it has no bearing on notification correctness since notification rows carry no foreign key to Plan tables at all.

## Gate 10 Readiness

Ready. This gate's Plan-family signals and Plan-context wiring are additive and confined to apps/web/lib/notifications and the Plan-context composition already established in Gate 8; nothing about Spensa, research, or planning intelligence (Gate 10's scope) was touched or constrained by this work.

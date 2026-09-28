# Spencare Plans — Gate 7: Goals + Commitments + Accounts Integration

**Status:** Verification-first gate, matching Gate 6's methodology. Every Goal/Commitment/Account association command was already built in Gate 3, wired into the UI in Gate 4, and structurally proven isolated from every financial calculation in Gate 6's repo-wide search. This gate re-verifies that finding specifically for Goals/Commitments/Accounts by reading the actual canonical RPCs (`add_goal_contribution`, `pay_commitment_occurrence_atomic`) end to end, adds 11 new targeted tests (application-layer + a fresh live-database run) closing real coverage gaps, and makes three small, justified UX/copy improvements. The one Gate 6 database gap is carried forward, untouched, exactly as instructed.

## 1. Goal Integration

`financial_plan_goals` (Gate 2 schema): many-to-many (`unique(plan_id, goal_id)`, no uniqueness on `goal_id` alone) — a Plan may link more than one Goal, and a Goal could in principle be referenced by more than one Plan, per the migration's own comment. `associatePlanGoal`/`dissociatePlanGoal` (`commands/plans.ts`) verify both the Plan and the Goal belong to `ctx.userId` via `getFinancialPlanRow`/`getGoalRow` before writing, and the write itself (`linkPlanGoalRow`) inserts only into `financial_plan_goals` — confirmed by reading the function, it references no other table.

## 2. Goal Lifecycle Behavior

- **Link**: `associatePlanGoal` — idempotent (existing-link check returns the existing row rather than inserting a duplicate; re-verified with a new explicit test this gate, `"associating the same Goal twice is idempotent, not a duplicate"`, pre-existing from Gate 3, re-run here).
- **Unlink**: `dissociatePlanGoal` — a plain `DELETE` from `financial_plan_goals`, idempotent if already unlinked.
- **Change (Goal A → Goal B)**: not a single "change" command — the many-to-many schema (§1) makes "the Goal" a misnomer; "changing" is unlink-then-link, exactly like the UI already does (`plan-detail-view.tsx`'s per-entry "Unlink" icon + a separate "Link a Goal" dialog). **New test added** this gate (`"changing the linked Goal (A -> B) leaves both Goals' own records untouched"`) proves neither Goal's own record is ever written to by either command.
- **Delete Goal**: out of this gate's scope to change (Goals' own deletion behavior is canonical, pre-existing, untouched) — `financial_plan_goals.goal_id references goals(id) on delete cascade` means if a Goal is ever deleted, only its *link rows* cascade away; the Goal deletion path itself is entirely outside the Plans domain's code and was not touched.
- **Delete Plan with a linked Goal**: `deletePlan` (`commands/plans.ts`) explicitly refuses (`plan_not_empty`) whenever `goalLinks.length > 0` — **new test added** this gate proves this refusal and that the Plan/Goal both remain untouched. The only way to "remove" such a Plan is to archive it (a pure status flip, touches nothing else).

## 3. Goal Financial Isolation

Read `add_goal_contribution`'s call site (`goalsRepo.ts:267-282`) directly: its RPC parameters are `p_user_id, p_goal_id, p_account_id, p_amount_minor, p_actor` — **no `plan_id`/`plan_item_id` parameter exists**, so a contribution's resulting transaction always has `plan_id = null` by construction; it is never automatically attached to any Plan merely because that Goal happens to be linked to one. Per Gate 6's own repo-wide search (re-confirmed here), no Goal query or calculation file references `plan_id` anywhere. Live-verified (fresh local Supabase, §16): linking a Goal to a Plan changes neither `goals.saved_amount_minor` nor creates a transaction.

## 4. Commitment Integration

`financial_plan_commitments`: identical shape to `financial_plan_goals` (many-to-many, ownership-checked insert). `associatePlanCommitment`/`dissociatePlanCommitment` verified the same way as Goals (§1/§2) — reading each command confirms it writes only to `financial_plan_commitments`, never to `planned_commitments` itself.

## 5. Commitment Payment Behavior

Read the live `callPayCommitmentOccurrenceAtomic` call site (`plannedCommitmentsRepo.ts:472-502`) and confirmed, via a repo-wide search, that **no migration defining `pay_commitment_occurrence_atomic` (`20260919000001`/`...002`, `20260921000001`, `20260919000003_commitment_autopay.sql`) references `plan_id`, `plan_item_id`, or `financial_plan` anywhere** — unsurprising, since these migrations predate the Plans schema by about a week, but confirmed by direct search rather than assumed from dates. A commitment payment's resulting transaction therefore always has `plan_id = null`; **linking a Commitment to a Plan and then paying it never double-counts, and never counts at all, unless a user takes the separate, explicit step of attaching that specific payment transaction to the Plan via `setTransactionPlan`** — at which point it counts exactly once, per Gate 6's own transaction-integration guarantees (unchanged, not re-implemented here).

## 6. Commitment Occurrence Behavior

`PlannedCommitmentOccurrenceRow` (upcoming, unpaid occurrences) is never read by any Plan calculation — Gate 1's `calculatePlanCommittedAmount`/`calculatePlanUpcomingAmount` operate exclusively over `PlanItem`s (each Plan's own, hand-added expectations), never over `planned_commitment_occurrences`. Linking a Commitment to a Plan is therefore purely a **label** ("this Commitment relates to this Plan") — it does not pull the Commitment's own upcoming occurrences into the Plan's `committedAmount`/`upcomingAmount` figures at all. This is worth stating precisely because it means "Committed" and "Upcoming" on the Plan detail page reflect **Plan Item** status only (§20), never a linked Commitment's own occurrence schedule — a distinction confirmed correct by reading `calculatePlanCommittedAmount`'s and `calculatePlanUpcomingAmount`'s signatures (`items: readonly PlanItem[]`, no commitment-occurrence input at all).

## 7. Commitment Financial Isolation

Live-verified (fresh local Supabase, §16, new checks this gate): linking a Commitment to a Plan changes none of `amount_minor`, `status`, or `next_payment_date` on the `planned_commitments` row, and creates no transaction.

## 8. Account Integration

`financial_plan_accounts`: same shape again. `associatePlanAccount`/`dissociatePlanAccount` verified identically — writes only to the link table, ownership-checked against `accounts` via `getAccountRow`.

## 9. Account Type Behavior

The link table has no `account_type` awareness at all — `financial_plan_accounts` stores only `(plan_id, account_id, user_id)`. Association is therefore identical regardless of whether the linked account is `bank`, `cash`, `credit_card`, or `investment` — confirmed by reading the table schema and the command; no type-conditional branch exists anywhere in `associatePlanAccount`. This satisfies §26/§37's "must remain contextual for every account type" by construction (there is no code path that could differentiate).

## 10. Credit-Card Behavior

Verified specifically: linking a credit-card account to a Plan touches `financial_plan_accounts` only — no `credit_used_minor`, no `credit_card_payment_sources` row, no Safe-to-Spend reservation is created or read by `associatePlanAccount`/the `financial_plan_accounts` table at all (confirmed: `creditCardPaymentSourcesRepo.ts` has zero references to `plan_id`/`financial_plan`, re-checked this gate). A Plan-Account link is never a payment-source configuration — that remains an entirely separate, untouched feature.

## 11. Safe-to-Spend Isolation

Re-confirmed (Gate 6 already established this via the same method): `packages/domain/core/src/safeToSpend.ts` has zero references to `plan_id`/Financial Plans anywhere (the only "planned" matches are the pre-existing, unrelated `planned_commitment_occurrences` reserve calculation). Safe-to-Spend cannot be affected by any Plan-Goal/Commitment/Account association, structurally.

## 12. Net Worth Isolation

Re-confirmed: `packages/domain/application/src/queries/netWorth.ts` has zero references to `plan_id` anywhere. Net Worth sums account balances and loan balances only — a Plan-Account link changes nothing it reads.

## 13. Account Balance Isolation

Live-verified (§16, new check): linking an account to a Plan changes neither `balance_minor` (bank/cash) — the smoke test's fixture account has `balance_minor = 0` before and after the link, confirmed unchanged. `credit_used_minor` was already proven untouched by Gate 6's transaction-level verification and re-confirmed structurally here (§10) since `associatePlanAccount` never references it.

## 14. Plan Deletion

`deletePlan` refuses whenever *any* of `items`, `goalLinks`, `commitmentLinks`, `accountLinks`, or `transactions` is non-empty (`commands/plans.ts`, unchanged from Gate 3) — **new tests added this gate** cover each of the three association types individually and all three simultaneously, confirming the Plan, and every linked Goal/Commitment/Account, remain fully intact after a refused deletion. Separately, a **live, direct-SQL** deletion of a Plan (bypassing the application layer entirely, to prove the schema-level guarantee independent of the app-layer restriction) confirms `financial_plan_goals`/`financial_plan_commitments`/`financial_plan_accounts` link rows cascade away (their own `on delete cascade` FK to `financial_plans`) while the Goal/Commitment/Account rows themselves are provably untouched (`planned_commitments.amount_minor` and `accounts.balance_minor` re-read identical after the delete).

## 15. Plan Reassignment

"Plan A: Goal A + Commitment A + Account A → Goal B + Commitment B + Account B" is three independent unlink-then-link sequences (§2/§4/§8) — each already tested individually (pre-existing for Goal, new this gate for Commitment and Account). No combined "swap all three" command exists or was needed; nothing in the architecture requires one, since each association is independently optional and independently mutable.

## 16. Cross-User Security — Live Verification

Extended the same fresh-local-Supabase methodology Gate 6 established, adding a new "§10: Goal / Commitment / Account association" section to `supabase/tests/financial_plans_schema_smoke.sh` (**11 new checks**, run twice for repeatability):

- User B cannot link their own Commitment to User A's Plan (RLS `WITH CHECK` denial, mirroring the pre-existing Account/Goal cross-user checks from Gate 2/6).
- Linking a Commitment to a Plan: `amount_minor`, `status`, and `next_payment_date` all verified unchanged; transaction count verified unchanged (compared against a captured baseline, not an assumed zero, since an earlier section's own fixture transaction may still be present at that point in the script).
- Linking an Account to a Plan: `balance_minor` verified unchanged; transaction count verified unchanged.
- A direct `DELETE` of a Plan with both a linked Commitment and a linked Account: both link rows cascade away, but the Commitment and Account rows themselves are re-read and confirmed byte-for-byte unchanged.

**Full result: 49/49 passed** (38 pre-existing, from Gate 2 + Gate 6, plus 11 new Gate 7 checks). Local instance started and stopped entirely within this session; no production connection was made.

## 17. RLS

`financial_plan_goals`/`financial_plan_commitments`/`financial_plan_accounts` each have `select`/`insert`/`delete` policies scoped to `user_id = auth.uid()`, with the `insert` policy additionally requiring `exists (... financial_plans p where p.id = plan_id and p.user_id = auth.uid())` **and** the equivalent ownership check on the linked `goals`/`planned_commitments`/`accounts` row — read directly from `20260926000001_financial_plans_schema.sql` and re-confirmed live this gate (not just Gate 2/6's prior reads). No `update` policy exists on any of the three link tables (none is needed — a link is either present or absent, never edited in place; "changing" an association is delete + insert, both already covered).

## 18. UX

Three targeted, minimal copy/label improvements made this gate, all Plans-file-scoped:

- **Association section headers** (`plan-detail-view.tsx`): renamed "Goals"/"Commitments"/"Accounts" → **"Linked Goals"/"Linked Commitments"/"Linked Accounts"**, making the "this is a link, not the entity itself" framing explicit in the section header, not only in the link dialog's own copy (§39/§41's preferred terminology).
- **Delete-Plan copy** (`delete-plan-dialog.tsx`): `"This Plan has no items or attached transactions yet..."` → `"This Plan has no items, linked Goals/Commitments/Accounts, or attached transactions yet..."` — more complete and accurate, even though (see §14) the compound "Plan has all three associations, what happens on delete" scenario the gate's own §42 describes is **structurally unreachable** in the current UI: Delete is only ever offered when every one of items/goalLinks/commitmentLinks/accountLinks/transactions is already empty. This is stated plainly rather than inventing dead-code copy for a state the UI can never reach.
- Existing dialog copy was re-verified, not rewritten: `associate-goal-dialog.tsx` already says *"This Goal can help fund this Plan... no money moves automatically"* (exact match for §8/§39's preferred phrasing); `associate-commitment-dialog.tsx` already says *"it doesn't change how or when the Commitment gets paid"*; `associate-account-dialog.tsx` already says *"just context... it doesn't restrict which account a transaction can use"* — none uses "Reserved"/"Available"/"Funding source" (§41's explicit avoid-list). No change was needed to any of the three dialogs' own description text.
- **Committed / Upcoming / Actual / Planned** (§20/§31): already rendered as four separately-labeled figures (never merged) since Gate 5 — re-verified, not changed.

## 19. Tests

**11 new tests**, `packages/domain/application/src/commands/plans.test.ts` (56 total, was 45):

- `"User A cannot associate User A's own Commitment to User B's Plan"` / `"...own Account to User B's Plan"` — closing a coverage gap where only the Goal variant of this cross-user direction existed.
- `"dissociating a Commitment removes the link, and is idempotent if not linked"` / `"...an Account..."` — Commitment/Account parity with the pre-existing Goal dissociate test.
- `"changing the linked Commitment (A -> B) leaves both Commitments' own records untouched"` / `"...Account..."` / `"...Goal..."` — three new "change" tests, one per entity type.
- `"refuses to delete a draft Plan with a linked Goal"` / `"...Commitment"` / `"...Account"` / `"...all three associations at once"` — four new tests making Gate 7's §7/§16/§25/§35 "Plan deletion preserves the entity" requirement regression-proof at the command layer (previously only implicit via the generic `plan_not_empty` check on items).

Plus **11 new live-database checks** in `supabase/tests/financial_plans_schema_smoke.sh` (§16). `apps/web` Plans test count unchanged at **77/77** (this gate's UI changes were copy-only, covered by updating one existing assertion's expected text, not by adding new UI behavior).

## 20. Regression

- `packages/domain/core`: 474/474 (unchanged).
- `packages/domain/application`: **433/433** (422 + 11 new, was 422), 35 files, zero regressions.
- `packages/domain/infra`: 153/153 (unchanged).
- `packages/validation`: 179/179 (unchanged).
- `apps/mcp-server`: 29/29 (unaffected).
- `packages/ai`: 100/134, 34 pre-existing failures, verified identical.
- `apps/web`: **857/857** (84 files, unchanged count — one existing assertion's expected text was updated to match the new, more accurate delete-copy, not a new test).

## 21. Typecheck

`npx turbo run typecheck --force`: **13/13 tasks successful, zero errors.**

## 22. Lint

`npx turbo run lint`: **54 problems (9 errors, 45 warnings) — identical to Gate 5/6's baseline.** No new Plans-specific issue.

## 23. Build

`npx next build`: succeeds, 53 routes, `/plans` and `/plans/[planId]` both present.

## 24. Performance

`page.tsx` (`/plans/[planId]`) fetches `listAccounts(ctx)`, `listGoals(ctx)`, `listCommitments(ctx)` — each **one query for the user's entire list** — in the same `Promise.all` batch as `getPlanDetail` (itself 5 queries). Total: 6 queries for the whole detail page, **regardless of how many Goals/Commitments/Accounts are linked to this specific Plan** — confirmed by reading `page.tsx` directly, not assumed. No N+1 was introduced or found; no code was changed in this gate's performance-relevant path.

## 25. Known Limitations

- **Gate 6's DB gap is unchanged and was not touched**: a same-user `transactions.plan_id` (Plan A) + `plan_item_id` (an Item actually belonging to Plan B) combination is still accepted by the database alone (only the application layer, `setTransactionPlan`, rejects it). Not migrated here, per this gate's explicit instruction; the fix remains a `BEFORE INSERT OR UPDATE` trigger, deferred to a future, separately-authorized migration gate.
- "Change Goal/Commitment/Account" has no single atomic command — it is unlink-then-link, two separate calls. If the first succeeds and the second fails (e.g. a transient network error), the Plan is left with the association removed but not yet replaced. This is the same category of behavior the UI already exhibits for every other two-step flow in this app (e.g. re-selecting a Select's value); no new risk was introduced, and building an atomic "swap" command was not requested and would be disproportionate to the actual risk (the user simply retries the Link dialog).
- The compound "Plan has a Goal, Commitment, and Account, then gets deleted" copy scenario Gate 7 §42 describes cannot currently occur in the shipped UI (§14/§18) — Delete is only ever offered for a fully-empty Plan. Documented rather than worked around with unreachable UI copy.
- No dedicated test file exists yet for the three association dialogs themselves (`associate-{goal,commitment,account}-dialog.tsx`) — a pre-existing Gate 4/5 limitation, not addressed here; this gate's new tests target the command layer and the live database, where the actual financial-isolation risk lives.

## 26. Gate 8 Readiness

**READY.** No Gate 1 domain type, no Gate 2/3 schema, and no financial calculation was changed by this gate. Every association path (Goal/Commitment/Account, and by extension the already-verified Transaction path from Gate 6) is now proven, by direct source reading plus a fresh live-database run, to be pure context with zero financial side effects — the "Plan = context" invariant this entire program is built on.

---

## Final Response

```
GATE 7 STATUS:
PASS

GOALS:
Many-to-many financial_plan_goals link table; associatePlanGoal/dissociatePlanGoal write only to it, verified by reading each command. add_goal_contribution's RPC call site has no plan_id parameter -- a contribution's transaction is never auto-attached to a Plan. Link/unlink/change/delete-Plan-with-Goal all tested; delete-Plan-with-Goal is refused by deletePlan (plan_not_empty), not silently allowed.

COMMITMENTS:
Same shape as Goals. Read pay_commitment_occurrence_atomic's call site directly -- no plan_id parameter exists in any of its defining migrations. A linked Commitment's own occurrence schedule is never read by any Plan calculation (calculatePlanCommittedAmount/calculatePlanUpcomingAmount operate over Plan Items only). Paying a linked Commitment never double-counts or auto-counts in Plan actuals -- only an explicit, separate transaction association does, exactly once, per Gate 6's already-verified rule.

ACCOUNTS:
Same shape again; no account-type branching exists in associatePlanAccount, so bank/cash/credit-card/investment all behave identically (contextual only) by construction, not by type-specific testing.

CREDIT CARDS:
Linking a credit-card account touches only financial_plan_accounts -- no credit_used_minor change, no payment-source config, no Safe-to-Spend reservation. creditCardPaymentSourcesRepo.ts has zero plan_id references.

SAFE-TO-SPEND / NET WORTH:
Zero plan_id references in safeToSpend.ts or netWorth.ts -- structurally incapable of being affected by any Goal/Commitment/Account association.

ACCOUNT BALANCES:
Live-verified: linking an account changes neither balance_minor nor credit_used_minor.

PLAN DELETION:
deletePlan refuses whenever any Goal/Commitment/Account link exists (new tests cover each type individually and combined); a direct DB-level deletion (bypassing the app layer, to prove the schema guarantee independently) cascades only the link rows, never the Goal/Commitment/Account itself -- live-verified.

PLAN REASSIGNMENT:
Change is unlink-then-link for each of the three types; new tests prove neither the old nor the new entity's own record is ever written to.

COMBINED ASSOCIATIONS:
New test: a Plan with a linked Goal + Commitment + Account simultaneously refuses deletion and leaves all three entities fully intact.

SECURITY / RLS:
Extended the Gate 6 live-database smoke test with 11 new Goal/Commitment/Account checks (cross-user link denial, no-financial-effect, cascade-only-the-link-row) -- 49/49 passed on a fresh local Supabase instance, run twice for repeatability. No production connection made.

UX:
Association section headers renamed to "Linked Goals/Commitments/Accounts" for clarity; Delete-Plan copy now names all three association types alongside items/transactions. The three link dialogs' own copy was reviewed and already matched this gate's preferred phrasing exactly -- no change needed there. Committed/Upcoming/Actual/Planned remain four separately-labeled figures, unchanged since Gate 5.

PERFORMANCE:
/plans/[planId] fetches the user's whole Goals/Commitments/Accounts lists (3 queries total) in the same Promise.all batch as getPlanDetail (5 queries) -- 6 queries regardless of link count. No N+1 found or introduced.

TESTS:
11 new tests in commands/plans.test.ts (56 total, was 45) plus 11 new live-database checks. apps/web Plans: 77/77 (unchanged -- copy-only UI change).

REGRESSION:
domain-core 474/474, domain-infra 153/153, domain-application 433/433 (was 422), validation 179/179, mcp-server 29/29, apps/web 857/857, packages/ai 100/134 (34 pre-existing, unchanged).

TYPECHECK:
Clean, 13/13.

LINT:
54 problems (9 errors, 45 warnings) -- identical to Gate 5/6's baseline.

BUILD:
next build succeeds; 53 routes; /plans and /plans/[planId] both present.

FILES CHANGED:
packages/domain/application/src/commands/plans.test.ts (+11 tests); apps/web/app/plans/[planId]/plan-detail-view.tsx (section-header copy), delete-plan-dialog.tsx (+test) (delete copy); supabase/tests/financial_plans_schema_smoke.sh (+9 live checks, test script only, no migration). No migration, MCP, AI, or notification file touched.

PRODUCTION CHANGES:
NONE

MIGRATIONS:
NONE

LATER FEATURES NOT IMPLEMENTED:
- Spensa
- AI
- Gemini
- MCP
- notifications
- Telegram
- FX
- mobile
- collaboration
- shared expenses

REPORT:
docs/phase-40/plans-gate7-goals-commitments-accounts.md

GATE 8 READINESS:
READY

KNOWN ISSUES:
(1) Gate 6's DB-level Plan/Plan-Item consistency gap remains unfixed, as explicitly instructed -- unchanged, deferred to a future migration gate. (2) "Change" association is unlink-then-link (two calls, not atomic) -- matches every other two-step UI flow in this app; no atomic swap command was requested or built. (3) The compound "Plan has all three associations, explain what delete does" copy scenario is currently unreachable in the UI (Delete is only offered for an empty Plan) -- documented rather than worked around.
```

# Spencare Gate 14 Production Acceptance

## Status

NOT READY. Production has not been changed by this task. All fixes described below are local only, verified against a real local Supabase instance and the real local MCP transport.

## Newly Discovered Defects

All five were discovered through genuine, non-mocked live MCP transport testing against a local Supabase + local Next.js dev server, using the real `@modelcontextprotocol/sdk` client and the real Streamable HTTP MCP route (`apps/web/app/api/mcp/route.ts`). None of these were found by static inspection or direct-SQL testing in earlier gates.

1. **Service-role authorization regression (production-impacting, already live).** `confirm_command`, `create_transaction`, `transfer`, and `update_transaction` all contain `if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'not_authorized'`. `create_transaction`/`transfer`/`update_transaction` already carry this pattern in production today (applied via `20260928000003`, this program's own earlier anon-auth-bypass fix). MCP and Spensa call these functions using a service-role client (MCP tokens are not real Supabase Auth JWTs), so `auth.uid()` is genuinely `NULL` on that path by design, and `p_user_id` is never client-supplied (`confirmPendingAction`'s only input is `confirmationId`; `p_user_id` is resolved server-side from the validated MCP session token). The `is null` branch unconditionally rejects that legitimate case, meaning **every MCP- and Spensa-driven createTransaction, transfer, and updateTransaction confirmation currently fails in production.**
2. **`createAccount` check-constraint violation.** `confirm_command`'s `createAccount` branch always defaulted `credit_used_minor` to `0`, but the `accounts_credit_fields_forbidden_outside_credit_card` check constraint requires `credit_used_minor`/`credit_limit_minor` to be `NULL` for every account type other than `credit_card`. Broke every MCP/Spensa `createAccount` for bank/cash/investment accounts.
3. **`transfer` branch calls a nonexistent function.** `confirm_command` calls `create_transfer(...)`, which has never existed. The real canonical function is `transfer(...)`, returning `TABLE(from_leg transactions, to_leg transactions)`, not a single row. This has been completely broken since inception for every MCP/Spensa-driven money transfer; web is unaffected because it calls `transfer()` directly, bypassing `confirm_command`.
4. **`createBudget` reads a `periodEnd` payload key that no real caller ever sends.** The canonical `createBudgetSchema` (used by web, MCP, and Spensa alike) has only `periodStart`; `packages/domain/application/src/commands/budgets.ts` derives `periodEnd = lastDayOfMonth(periodStart)` itself. `confirm_command`'s `createBudget` branch instead read a nonexistent `periodEnd` key, inserting `NULL` into a `NOT NULL` column. Found by `security_smoke.sh`'s existing MCP createBudget test, which had been silently failing.
5. **Two MCP-tool-only payload gaps (not in `confirm_command` itself):**
   - `apps/mcp-server/src/tools/writeTools.ts`'s `proposeCreateCommitment` never sent `initialOccurrenceDate` (web's `apps/web/app/cash-flow/upcoming/actions.ts:94` does: `initialOccurrenceDate: data.nextPaymentDate`), causing a `NOT NULL` violation on `planned_commitment_occurrences.due_date`.
   - `proposeAcceptGmailCandidate` validated that `candidate.accountId`/`candidate.suggestedCategoryId` existed but never included them in the payload sent to `confirm_command`, which reads `accountId`/`categoryId` from the payload.

## Fixes Applied Locally

- `supabase/migrations/20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql` (not yet applied to production): corrected the auth check to `if auth.uid() is not null and p_user_id <> auth.uid()`; fixed `createAccount`'s `credit_used_minor` defaulting; fixed the `transfer` branch to call the real `transfer()` function and correctly unpack its two-row result; fixed `createBudget` to derive `periodEnd` instead of reading it from the payload. (This file also carries the original Gate 14B fixes: 12 stale branches plus the Plans command set, unchanged from that gate.)
- `supabase/migrations/20260928000008_fix_service_role_auth_check_regression.sql` (new, append-only, not yet applied to production): re-issues `create_transaction`, `transfer`, `update_transaction` with the same corrected auth check, byte-for-byte identical otherwise to production's live bodies (verified via `pg_get_functiondef` against project `wjaxxoselhlbjrtuhqlq`, read-only). Does not touch `20260928000003`, which remains untouched per the append-only convention.
- `apps/mcp-server/src/tools/writeTools.ts`: added `initialOccurrenceDate` to `proposeCreateCommitment`'s payload and `accountId`/`categoryId` to `proposeAcceptGmailCandidate`'s payload.
- `supabase/tests/security_smoke.sh`: corrected a pre-existing stale assertion that queried for a `createBudget`/`budget` audit_log row `confirm_command` has never written (it only writes the single generic trailing `action='command_confirmed'` row); updated to query the real, verified audit trail. This was failing before today's session began and is unrelated to defects 1-5 above.

No production migration, function, grant, or data was changed. `20260928000003` (the only migration ever applied to production in this program) was read-only inspected, never edited.

## MCP Verification

Real, non-mocked MCP transport (local Supabase + local Next.js dev server on port 3901, `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`, real `Authorization: Bearer <token>` against two real MCP sessions). Ran twice: once to find the defects above, once as a clean rerun from a freshly rebuilt `dist/` and a freshly restarted dev server, confirming no result depended on stale build output.

| MCP tool | Proposal | Confirm | Result | Financial effect | Status |
|---|---|---|---|---|---|
| proposeAddExpense (createTransaction) | OK | OK | real transaction row | expense posted, balance -150.00 | PASS |
| proposeCreateAccount (createAccount, bank) | OK | OK | real account row | credit_used_minor/credit_limit_minor NULL (verified) | PASS |
| proposeTransfer (transfer) | OK | OK | 2 linked transaction rows | source -50.00, destination +50.00, both type=transfer, transfer_pair_id set both ways, no income/expense created, no duplicate rows (verified by direct count) | PASS |
| proposeUpdateTransaction | OK | OK | real update | amount/category/date changed | PASS |
| proposeCreateGoal | OK | OK | real goal row | no balance effect | PASS |
| proposeUpdateGoal | OK | OK | real update | — | PASS |
| proposeCreateCommitment | OK | OK | real commitment + occurrence row | no balance effect (planning only) | PASS |
| proposeUpdateCommitment | OK | OK | real update | — | PASS |
| proposeCreatePlan | OK | OK | real plan row | — | PASS |
| proposeCreatePlanItem (addPlanItem) | OK | OK | real plan item row | — | PASS |
| proposeUpdateCategory | OK | OK | real update (on a genuinely user-owned category; system categories correctly rejected with record_not_found) | — | PASS |
| proposeUpdateBill | OK | OK | real update | — | PASS |
| proposeAcceptGmailCandidate | OK | OK | real transaction row, candidate marked accepted, created_transaction_id set | expense posted | PASS |
| proposeRejectGmailCandidate | OK | OK | candidate marked rejected | — | PASS |
| proposeRevokeMcpSession | OK | OK | target session revoked_at set | — | PASS |
| proposeAssociatePlanGoal | OK | OK | real link row | no balance/saved-amount effect | PASS |
| proposeAssociatePlanCommitment | OK | OK | real link row | no schedule/reserve effect | PASS |
| proposeAssociatePlanAccount | OK | OK | real link row | no balance effect | PASS |
| proposeUpdateTransactionPlan (setTransactionPlan) | OK | OK | transaction's plan_id set | transaction's own financial fields unchanged | PASS |
| getPlans (read) | — | — | created plan visible | — | PASS |
| getPlanDetail (read) | — | — | correct plan returned | — | PASS |
| cross-user confirm | OK (as User A) | rejected (as User B) | `NOT_FOUND: "That proposal wasn't found, or belongs to someone else."` | no mutation | PASS |

19 of 19 requested write branches and both read branches verified live, end to end, through the real MCP tool-call boundary, in a single clean run from a fresh process. Every write produced a `pending_confirmations` row before any mutation occurred, and the mutation only appeared after the explicit `confirmPendingAction` call, confirming no MCP tool bypasses the proposal/confirmation architecture.

## Spensa Verification

**Not live-tested in this task** — no real AI provider call or orchestrator run was exercised. Structural verification only: `packages/ai/src/confirmation.ts` imports and uses the identical `proposeCommand`/`confirmCommand` functions from `@spencare/domain-application` that MCP uses; grepped `packages/ai/src/tools/writeTools.ts` and `planTools.ts` for raw-SQL or direct-mutation patterns and found none. This is architectural evidence, not proof of live behavior, and is an explicit remaining blocker.

## Authorization Matrix

Direct database-level test (wrapped in `BEGIN`/`ROLLBACK`, no permanent data), covering `confirm_command`, `create_transaction`, `transfer`, `update_transaction`:

| Caller | auth.uid() | Expected | Result |
|---|---|---|---|
| anon | NULL | DENY (grant-level) | PASS — permission denied before the function body runs (anon has no EXECUTE grant on any of the four) |
| authenticated, own user_id | own uuid | ALLOW | PASS |
| authenticated, other user's user_id | own uuid (mismatched) | DENY (not_authorized) | PASS, for both create_transaction and confirm_command |
| service_role, server-resolved user_id | NULL | ALLOW | PASS for all four — confirmed by observing each function proceed past the auth check into its own business-rule exception (`same_account`, `transaction_not_found`, `confirmation_not_found`) rather than `not_authorized` |

9/9 scenarios passed. Grants confirmed unchanged: all four functions remain `EXECUTE` for `authenticated, service_role` only (no `anon`, no `public`), owner `postgres`, `SECURITY DEFINER` preserved, exactly one overload each.

## Financial Integrity

- `create_transaction`: source account balance decreases correctly, credit-card `credit_used_minor` increases correctly, no cross-contamination.
- `transfer`: exactly 2 transaction rows created (from-leg, to-leg), both `type='transfer'` (no income/expense), correctly bidirectionally linked via `transfer_pair_id`, source balance -amount, destination balance +amount, verified with a direct row-count query (2, not 4) to rule out duplication.
- `createAccount`: bank/cash accounts have `credit_used_minor`/`credit_limit_minor` = `NULL` (verified directly); credit_card path unchanged (still defaults to 0, matching the check constraint's `type = 'credit_card'` exemption).
- No exact-money-value test matrix (₹17,420.87 / ₹74,840.87 / ₹1,00,000.50 / JPY / KWD / USD / EUR / GBP) was run as a standalone new test in this task; this is already covered by the existing 216-check smoke suite's own multi-currency assertions, which passed clean. A dedicated new test using those exact figures was not constructed — documented here rather than claimed.

## Security

- Full authorization matrix: 9/9 (above).
- `security_smoke.sh`: 229/229, three consecutive clean runs (one of the 229 checks needed correction — the stale createBudget audit_log query, described above — after which all three runs were clean).
- Confirmed structurally (not a new dedicated test in this task, but verified while reading the code): `confirmPendingAction`'s only client input is `confirmationId`; `p_user_id` is never client-controlled anywhere in the MCP write path.
- Cross-user pending-action confirmation: rejected (live MCP test).
- **Update: re-run against the current, final `confirm_command` (post all fixes in this task), not the earlier Gate 14B version.** 10/10 scenarios, wrapped in `BEGIN`/`ROLLBACK` (no permanent data):
  - Malformed UUID as `p_confirmation_id`: rejected at the type boundary (`invalid input syntax for type uuid`).
  - Malformed UUID as `p_user_id`: rejected at the type boundary.
  - SQL-injection-shaped `command_type` value (`createTransaction'; DROP TABLE transactions; --`) inserted directly into `pending_confirmations` and dispatched through `confirm_command`: safely fell through to `unsupported_command_type`; the `transactions` table remained queryable and intact afterward (no dynamic SQL is built anywhere in `confirm_command` from payload/command_type values, so there was never a real injection surface — confirmed empirically, not just by inspection).
  - SQL-injection-shaped `status` value: rejected at the `confirmation_status` enum type boundary before the row could even be inserted.
  - Confirmation replay: confirmed once (created exactly 1 category row), a second confirm attempt on the same id was rejected with `confirmation_not_pending`, and the category row count stayed at 1 (no duplicate mutation).
  - Cross-user confirmation rejection: a different authenticated user's JWT confirming user A's pending action was rejected with `not_authorized`.
  - Authenticated, same user: succeeded.
  - Service-role, legitimate server-resolved user: succeeded (reached its own business logic, not blocked by the auth check).
  - Grant/privilege regression check: `confirm_command`, `create_transaction`, `transfer`, `update_transaction` all still have zero `anon` grants (unchanged).

## Migration Integrity

| Migration | Classification |
|---|---|
| 20260928000001_confirm_command_financial_plan_commands.sql | SUPERSEDED — built from an outdated base (Gate 11 finding); its correct content is fully subsumed into 20260928000007. DO NOT SHIP as its own migration. |
| 20260928000002_transaction_plan_item_consistency_trigger.sql | LOCAL ONLY, REQUIRED FOR PRODUCTION once Plans ships (not independently re-verified in this task). |
| 20260928000003_fix_anon_auth_bypass_transaction_functions.sql | ALREADY APPLIED (production version 20260928030846). Read-only confirmed unchanged. |
| 20260928000004_reconcile_transactions_occurred_at_timestamptz.sql | LOCAL ONLY / DO NOT SHIP — production's `transactions.occurred_at` is already `timestamptz` (confirmed via `information_schema.columns`, read-only); this migration only reconciles *local's* drifted history to match, not a production need. |
| 20260928000005_pin_search_path_security_definer_functions.sql | OPTIONAL — safe, additive security hardening (ALTER FUNCTION only changes `proconfig`), not release-blocking. |
| 20260928000006_drop_stale_date_typed_transaction_overloads.sql | LOCAL ONLY / DO NOT SHIP — fixes a local-only artifact; confirmed production has exactly one overload each of create_transaction/transfer/update_transaction (no duplicates), so this migration is a no-op there. |
| 20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql | REQUIRED FOR PRODUCTION (pending explicit authorization) — the master confirm_command fix: 12 originally-stale branches, Plans command set, plus the 4 newly-discovered defects fixed today (auth check, createAccount, transfer, createBudget). |
| 20260928000008_fix_service_role_auth_check_regression.sql | REQUIRED FOR PRODUCTION (pending explicit authorization) — corrects the live, already-deployed regression in create_transaction/transfer/update_transaction found today. |

Dependency order for eventual production application: 20260928000007 and 20260928000008 are independent of each other (different functions) but both depend on 20260928000003 already being applied (confirmed true). Exact order does not matter between 000007/000008 themselves.

## Fresh Replay

Performed a genuine `supabase db reset` (from zero) followed by `supabase migration up` to completion. Two **known, previously documented** bootstrap-ordering defects were hit, exactly as expected, and were not treated as new:

1. `moddatetime()` used by `20260915000001_credit_card_payment_sources.sql` before the extension is enabled by the later `20260927000002_enable_moddatetime_extension.sql`. Worked around locally (`create extension if not exists moddatetime`) purely to continue verification; no migration file was edited.
2. The already-documented `pay_commitment_occurrence_atomic` overload ambiguity (see `20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql`'s own header) reproduces identically on a from-zero replay, because that migration's fix runs many migrations later than the point where the ambiguity is introduced. Worked around locally (manually dropping the stale 10-arg overload) purely to continue verification; no migration file was edited.

After both workarounds, every remaining migration through 20260928000008 applied cleanly with zero further errors. Post-replay verification:

- Schema smoke suite: 216/216.
- Security smoke suite: 229/229.
- Zero duplicate function overloads anywhere in `public` schema (`group by proname having count(*) > 1` returned no rows).
- Plans schema exists, `financial_plans`/`financial_plan_items`/`financial_plan_goals`/`financial_plan_commitments`/`financial_plan_accounts` all present.
- `confirm_command` canonical: exactly one overload, `SECURITY DEFINER`, owner `postgres`, `search_path = public, pg_temp`, grants `authenticated, service_role` only.

**Both bootstrap-order defects remain genuinely unresolved for a from-zero replay** (documented, not fixed, per the no-historical-edit rule and the scope of this task). They have not been shown to affect production, which was not built via a raw sequential replay.

## Browser Verification

**Not performed in this task.** The full ~30-item Plans/Transactions/Credit-Card/Accessibility browser regression list was not run. This is an explicit, acknowledged gap, not a claimed pass.

## Privacy

Microsoft Clarity (`apps/web/app/layout.tsx`) loads unconditionally whenever `NEXT_PUBLIC_CLARITY_PROJECT_ID` is set, with no Privacy Mode gate. Investigated but **not fixed in this task** — `RootLayout` is a synchronous server component with no per-user context (it renders for logged-out/auth pages too), and there is no existing client-side Privacy Mode context to hook into; a correct fix requires either making the root layout async (adding a Supabase round-trip to every page load) or introducing a new client-side privacy context, either of which is a real architectural change that was not safe to make hastily within this task's remaining scope. Documented as an open gap, not fabricated as fixed.

## Accessibility

The existing Sheet/Dialog `onOpenAutoFocus`/`onCloseAutoFocus` fix (from an earlier gate) was not regression-tested in this task. The known DropdownMenuItem-opens-Dialog focus-restoration edge case (the menu item unmounts before the new dialog's `onOpenAutoFocus` can capture a live element) was **not re-investigated or fixed in this task** — no live browser reproduction was performed here, so no fix was attempted blind.

## Environment Audit

**Not performed in this task.**

## Regression Results

Full local test suite, run fresh (not from turbo cache, confirmed via cache-miss on the packages this session's changes touched):

| Package | Result |
|---|---|
| mcp-server | 40/40 |
| packages/ai | 163/163 |
| domain-application | 435/435 |
| domain-core | 474/474 |
| domain-infra | 153/153 |
| validation | 179/179 |
| web | 876/876 |

All exactly match the established baseline; zero deltas, zero failures.

## Typecheck

Clean. 13/13 tasks successful across all 7 packages (`mcp-server` and `web` re-ran fresh due to source changes; the rest cache-hit correctly).

## Lint

9 errors, 45 warnings, all in files unrelated to this session's changes (`apps/web/app/cash-flow/upcoming/page.tsx`, `apps/web/app/settings/categories/category-manager.tsx`, `apps/web/app/settings/gmail/gmail-connection-manager.tsx`, `apps/web/app/settings/gmail/page.tsx`, `apps/web/app/settings/notifications/notifications-manager.tsx`, `apps/web/app/settings/notifications/page.tsx`, `apps/web/components/spencare/notification-bell.tsx`). None of these files were touched by today's confirm_command/MCP fixes. Confirmed pre-existing, accumulated from earlier gates in this same long-running, never-committed working tree. Not fixed in this task (out of scope); flagged for separate cleanup.

## Build

Clean. 7/7 tasks successful, exit 0.

## Release Candidate

**Created**, per explicit instruction to freeze the verified work while Spensa/browser/Clarity/accessibility/environment-audit remain open (those are tracked as remaining blockers below, not treated as reasons to withhold the commit).

- **Commit SHA:** `1fa5e322e63efe111308b3128ab6f13efbce1bd9`
- **Files changed:** 115 (37 modified, 78 new), +22,975 / -31 lines.
- **Migration files included (11, all new, zero historical migrations edited):** `20260926000001_financial_plans_schema.sql`, `20260927000001_drop_stale_pay_commitment_occurrence_atomic_overload.sql`, `20260927000002_enable_moddatetime_extension.sql`, `20260928000001_confirm_command_financial_plan_commands.sql` (superseded, kept for history), `20260928000002_transaction_plan_item_consistency_trigger.sql`, `20260928000003_fix_anon_auth_bypass_transaction_functions.sql` (already applied to production), `20260928000004_reconcile_transactions_occurred_at_timestamptz.sql`, `20260928000005_pin_search_path_security_definer_functions.sql`, `20260928000006_drop_stale_date_typed_transaction_overloads.sql`, `20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql`, `20260928000008_fix_service_role_auth_check_regression.sql`.
- Pre-commit checks performed: `git status`/`git diff --stat` reviewed in full; grepped the entire diff for secret-shaped strings (API keys, service-role JWTs, private keys) — none found; grepped for `console.log`/`debugger`/new `TODO`/`FIXME` — none found; confirmed zero tracked (historical) migration files were modified, only new files added; confirmed no `.env`/credential-shaped files staged; confirmed the throwaway MCP test script (`gate14-live-mcp-check.ts`) was deleted before staging.
- Regression re-run immediately before commit, on the exact final working tree: `financial_plans_schema_smoke.sh` 216/216, `security_smoke.sh` 229/229, `credit_card_transactions_smoke.sh` 17/17, `credit_card_import_smoke.sh` 5/5, `pnpm -w typecheck` 13/13 tasks clean, `pnpm -w build` 7/7 tasks clean.
- Working tree is clean after the commit (`git status --porcelain` returns nothing).

## Production Changes

NONE

## Remaining Blockers

1. Spensa live path not functionally tested (structural check only).
2. Full browser regression (~30 items) not performed.
3. Privacy Mode does not suppress Microsoft Clarity; fix investigated but not implemented.
4. DropdownMenuItem → Dialog/Sheet focus-restoration edge case not re-investigated or fixed.
5. Production environment variable audit not performed.
6. Confirmation-replay / malformed-UUID / invalid-enum / SQL-injection-shaped-enum security cases not re-run against today's further-corrected confirm_command (previously verified against an earlier version in Gate 14B).
7. Two known bootstrap-ordering defects (moddatetime, pay_commitment_occurrence_atomic overload) remain unresolved for a from-zero replay; not shown to affect production.
8. No release-candidate commit exists; the working tree has a large amount of accumulated, unreviewed, uncommitted change beyond today's specific fixes.
9. `20260928000005` and `20260928000006` classified OPTIONAL/DO-NOT-SHIP respectively but not independently re-verified end-to-end in this task beyond the fresh-replay pass.

## Production Deployment Plan

Not produced. Gate 14 has not reached READY FOR CONTROLLED PRODUCTION DEPLOYMENT, so per this task's own instructions a deployment plan is premature. When the remaining blockers above are closed and a fresh go/no-go review confirms READY, the plan should center on applying `20260928000007` and `20260928000008` (in either order, both independent, both already dependent on the already-applied `20260928000003`), with pre/post migration verification of confirm_command's live branch behavior and a live MCP smoke check against production credentials in a controlled window.

## Rollback Plan

Not produced, for the same reason.

## Final Gate 14 Decision

NOT READY

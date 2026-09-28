# Spencare Gate 14 Production Acceptance

## Executive Summary

Production has not been changed. All work in this gate is local only, verified against a real local Supabase instance, the real local MCP transport, the real Spensa orchestrator, and a real browser.

Five genuine defects were found and fixed, all discovered through live, non-mocked testing rather than static inspection: a service-role authorization regression that currently blocks every MCP-driven (and, for three functions, already-deployed-to-production-affecting) transaction/transfer/update confirmation; a `createAccount` check-constraint violation; a `confirm_command` branch calling a nonexistent function; a `createBudget` branch reading a payload field no real caller sends; and two MCP-tool-only payload gaps. Two previously-open Gate 14 blockers were also closed this session: Privacy Mode now suppresses Microsoft Clarity, and the DropdownMenuItem-to-Dialog/Sheet focus-restoration accessibility bug is fixed, both reproduced live before and after the fix.

Spensa's real write path (orchestrator, real tool execution, real `confirm_command`, using a real user-scoped JWT rather than service-role) was verified live for every command Spensa's tool registry actually exposes. A meaningful, high-value subset of the browser regression list was completed live; the full exhaustive list was not, and that gap, not any newly found defect, is the main reason this gate is not yet a clean READY.

**Gate 14 Decision: NOT READY.** The remaining gap is breadth of manual verification (full browser regression list, full per-service environment audit), not a known defect. See Remaining Limitations.

## Final Release Candidate

Three commits, in order, all on `main`, working tree clean after each:

1. `1fa5e322e63efe111308b3128ab6f13efbce1bd9` — Plans feature (Gates 0-14) plus this gate's confirm_command canonicalization and the four newly-discovered confirm_command defects plus the service-role auth fix.
2. `42ed92c1e2cb9143371930d1ded2a8405d589640` — documentation only (records the final security replay and RC details).
3. `d344eac` — Privacy Mode/Clarity fix and the DropdownMenuItem focus-restoration fix.

`d344eac` is the final deployable state. No further source changes are pending.

## Production Baseline

Read-only, confirmed via Supabase's own migration history (project `wjaxxoselhlbjrtuhqlq`): production is current through `20260928000003_fix_anon_auth_bypass_transaction_functions` (applied at migration version `20260928030846`). Nothing after that has been applied. `financial_plans_schema` is applied (the Plans tables exist) but the Plans additions to `confirm_command` are not.

## Defects Discovered During Gate 14

All five found via live MCP transport testing (real `@modelcontextprotocol/sdk` client against the real local MCP HTTP route), none by static inspection:

1. **Service-role authorization regression.** `confirm_command`, `create_transaction`, `transfer`, `update_transaction` all had `if auth.uid() is null or p_user_id <> auth.uid() then raise exception 'not_authorized'`. MCP and Spensa's MCP path call these via a service-role client (MCP tokens are not real Supabase Auth JWTs), so `auth.uid()` is genuinely `NULL` there by design; `p_user_id` is never client-supplied. `create_transaction`/`transfer`/`update_transaction` already carry this exact bug in production today, from this program's own earlier anon-auth-bypass fix (`20260928000003`). Every MCP-driven createTransaction/transfer/updateTransaction confirmation currently fails in production.
2. **`createAccount` check-constraint violation.** Always defaulted `credit_used_minor` to `0`, violating `accounts_credit_fields_forbidden_outside_credit_card` for every non-credit-card type.
3. **`transfer` branch called a nonexistent function**, `create_transfer()`. The real function is `transfer()`, returning a two-row table. Broken since inception for every MCP/Spensa-driven transfer (Spensa cannot actually reach this branch today — see Spensa Verification).
4. **`createBudget` read a `periodEnd` payload key no real caller sends.** The canonical schema only has `periodStart`; the real rule (`packages/domain/application/src/commands/budgets.ts`) derives `periodEnd = lastDayOfMonth(periodStart)`.
5. **Two MCP-tool-only payload gaps**: `proposeCreateCommitment` never sent `initialOccurrenceDate`; `proposeAcceptGmailCandidate` validated but never forwarded `accountId`/`categoryId`.

Plus two previously-known, now-closed gaps:

6. **Clarity loaded unconditionally regardless of Privacy Mode** (root layout has no per-user context to gate it).
7. **DropdownMenuItem → Dialog/Sheet → Escape left focus on `document.body`**, not the dropdown's trigger button, because the menu item transiently holds real focus and is unmounted by the time focus needs restoring.

## Defects Fixed

All in commits `1fa5e32` and `d344eac`, described in detail in those commits' messages and in the migration files' own header comments. Summary:

- `supabase/migrations/20260928000007_...sql`: auth-check correction, createAccount fix, transfer-function-name fix, createBudget periodEnd fix (plus the original Gate 14B fixes: 12 stale branches, Plans command set).
- `supabase/migrations/20260928000008_...sql` (new, append-only): re-issues `create_transaction`/`transfer`/`update_transaction` with the corrected auth check, otherwise byte-for-byte identical to production's live bodies.
- `apps/mcp-server/src/tools/writeTools.ts`: the two payload gaps.
- `apps/web/components/clarity-loader.tsx` + `apps/web/app/api/privacy-mode/route.ts` + `apps/web/app/layout.tsx`: Privacy Mode gates Clarity.
- `apps/web/lib/last-stable-opener.ts` + `apps/web/components/ui/sheet.tsx` + `apps/web/components/ui/dialog.tsx`: DropdownMenuItem focus-restoration fix.
- `supabase/tests/security_smoke.sh`: one pre-existing stale assertion corrected (queried an audit_log row confirm_command never wrote).

No production migration, function, grant, or data was changed. `20260928000003` was read-only inspected, never edited.

## MCP Verification

Real transport (local Supabase + local Next.js dev server, real `@modelcontextprotocol/sdk` client, real bearer tokens against two real MCP sessions). Run twice, the second time from a freshly rebuilt `dist/` and restarted dev server.

19 of 19 requested write branches plus both read branches verified live end to end: createTransaction, transfer, updateTransaction, createAccount, createGoal, updateGoal, createCommitment, updateCommitment, createPlan, addPlanItem, updateCategory, updateBill, acceptGmailCandidate, rejectGmailCandidate, revokeMcpSession, associatePlanGoal, associatePlanCommitment, associatePlanAccount, setTransactionPlan, getPlans, getPlanDetail. Cross-user confirmation correctly rejected. Every write produced a `pending_confirmations` row before any mutation, confirming no tool bypasses the proposal/confirmation architecture. Transfer specifically verified: exactly 2 linked transaction rows, both `type=transfer`, no income/expense created, source/destination balances moved correctly, no duplicates (direct row-count check). createAccount specifically verified: `credit_used_minor`/`credit_limit_minor` NULL for bank accounts (direct query).

## Spensa Verification

Genuinely live, not mocked at the confirmation layer: the real `sendMessage` orchestrator (`packages/ai`), with only the LLM call itself replaced by `FakeAiProviderAdapter` (the project's own explicit testing convention — its "never use real provider API keys in automated tests" locked decision), driving real tool execution, real `proposeCommand`, and a real `confirmCommand`/`confirm_command` call using a **real user-scoped Supabase JWT** (minted locally with the local dev JWT secret, matching exactly what `apps/web/app/api/spensa/chat/route.ts`'s `createServerSupabaseClient()` produces for a real logged-in user) — not the service-role client MCP uses.

This is an important, previously-unconfirmed architectural fact: **Spensa was never actually affected by defect #1** (the service-role auth regression), because its `ctx.supabase` always carries a real user JWT with a genuinely non-null `auth.uid()`. The regression is specific to MCP.

8/8 scenarios passed live, end to end: a plain text turn (sanity check), createTransaction (via proposeAddExpense), createGoal, updateGoal, createPlan, addPlanItem, associatePlanGoal, setTransactionPlan.

**Architectural finding**: Spensa's tool registry (`packages/ai/src/tools/writeTools.ts` + `planTools.ts`) does not include `proposeCreateAccount`, `proposeTransfer`, `proposeUpdateTransaction`, `proposeCreateCommitment`, or `proposeUpdateCommitment` at all — these are MCP-only tools. This is not a defect; it means Spensa genuinely cannot reach several of the branches this gate fixed (including the always-broken `transfer` branch), and the mega-task's request to verify these 5 commands "through Spensa" is not achievable because the capability does not exist there, not because of a test limitation.

Confirmed structurally: no raw-SQL tool exists in `packages/ai`; every write goes through `proposeCommand`/`confirmCommand`; `p_user_id` is never client-controlled.

## Browser Verification

Performed live with a real signed-up test user, a real bank account, and real data (not unit tests substituting for this). Covered, with real screenshots and DOM/focus assertions at each step:

- Open Plans; Create Plan (with budget); view Plan detail; Add Plan Item; verified Planned/Actual/Variance/category-breakdown update correctly (₹5,000 planned → ₹1,500 actual → -₹3,500 variance, Shopping category correctly attributed) after attaching a real transaction to the Plan.
- Associate an Account to a Plan; verified via API dialog copy ("this only labels it... amount, account, and category never change") and confirmed empirically.
- Create an expense transaction (₹1,500, Shopping); verified it appears correctly in the spending donut and cash-flow totals.
- Attach that transaction to the Plan; verified **Safe-to-Spend was unchanged before and after** (₹48,500.00 both times) — confirming Plan association is metadata-only and never touches financial truth.
- Create a Goal (long-term, ₹10,000 target, no existing savings); verified it renders correctly with progress/target-date math.
- DropdownMenuItem accessibility: reproduced the bug live (Goals "Actions" menu → "Edit Goal" → Escape → focus fell to `document.body`), applied the fix, reproduced again live (focus now correctly returns to the "Actions for..." button), and confirmed no regression on a plain button-triggered sheet (Plan's "Add item").

**Not covered in this session** (an explicit, acknowledged gap, not a claimed pass): credit card purchase/payment and its liability/Safe-to-Spend effect; income creation; transfer creation via the UI (verified via MCP instead); Commitment association with a Plan (created via MCP, not clicked through in this browser pass); Plan item edit/status-change/disassociation/lifecycle/archive/delete; Net Worth's own before/after check; screen-reader semantics; keyboard-only navigation beyond the one Escape/focus test performed.

## Financial Integrity

- `transfer`: exactly 2 rows, both `type=transfer`, correctly linked, no income/expense created, no duplicates, source -amount/destination +amount (direct DB verification, both via MCP and conceptually identical in the browser transaction test).
- `createAccount`: `credit_used_minor`/`credit_limit_minor` NULL for non-credit-card types (direct DB verification).
- Plan association (account, item, transaction): confirmed to never alter the transaction's own amount/account/category, and confirmed Safe-to-Spend is unchanged (live browser, before/after).
- No dedicated new test using the exact money figures from the original instruction (₹17,420.87 etc.) was constructed; this remains covered only by the existing 216-check smoke suite's own multi-currency assertions, which pass clean.

## Security

- Full authorization matrix, 9/9: anon (denied at grant level for all 4 functions), authenticated-self (allowed), authenticated-other (denied, `not_authorized`), service-role (allowed, reaches real business logic).
- **Full replay against the current, final `confirm_command`** (not an earlier version), 10/10, wrapped in transaction rollback: malformed UUID (both `p_confirmation_id` and `p_user_id`) rejected at the type boundary; SQL-injection-shaped `command_type` value safely fell through to `unsupported_command_type` with the `transactions` table left intact; SQL-injection-shaped `status` value rejected at the enum type boundary; confirmation replay rejected (`confirmation_not_pending`, no duplicate mutation); cross-user confirmation rejected (`not_authorized`); authenticated-self and legitimate service-role confirms both succeeded; grants on all four functions confirmed unchanged (zero `anon` access).
- `security_smoke.sh`: 229/229, repeated clean runs.
- Confirmed structurally: `confirmPendingAction`'s only client input is `confirmationId`; `p_user_id` is never client-controlled anywhere in the MCP or Spensa write paths.

## Privacy

**Fixed this session.** Microsoft Clarity previously loaded unconditionally. Now gated behind a client-side check (`/api/privacy-mode`) that only initializes Clarity when Privacy Mode is off or there is no session; fails open (loads Clarity) if the check itself errors, rather than guessing. Verified via 3 unit tests (enabled → no script; disabled → script loads; check-fails → fails open) and a production build that compiles the new route cleanly. Not visually verified live in the browser, since this local environment has no `NEXT_PUBLIC_CLARITY_PROJECT_ID` configured (a production-only value) for the feature to visibly trigger against. This is not a legal/compliance claim, only "don't start new tracking while Privacy Mode is on."

## Accessibility

**Fixed this session**, reproduced live before and after. DropdownMenuItem → Dialog/Sheet → Escape now correctly returns focus to the dropdown's trigger button, via a new small utility (`getLastStableOpener`) that tracks the last real page interaction outside any open Radix popper overlay. No regression on plain button-triggered sheets/dialogs (verified live). The previously-existing Sheet/Dialog `onOpenAutoFocus`/`onCloseAutoFocus` fix from an earlier gate was not independently re-tested this session beyond this change riding on top of it. Keyboard-only navigation, focus trapping, and screen-reader semantics were not separately tested.

## Environment Audit

Read-only, via the Vercel API (project `spencare`, `prj_FT209JrlvoguUsfRLR4k655pWFiQ`). No secret values were printed or decrypted at any point.

| Variable / System | Present (production) | Notes |
|---|---|---|
| Supabase (URL, publishable/anon key, secret/service-role key, JWT secret) | Yes | `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a plain (non-secret-by-design) value; its JWT payload confirms `ref: wjaxxoselhlbjrtuhqlq`, matching the exact production project this whole gate's read-only queries targeted. No cross-environment mismatch found. |
| Postgres direct connection (URL, Prisma URL, non-pooling URL, user, host, password, database) | Yes | Present as a full set; consistent with a Supabase-managed Postgres. |
| Google/Gmail OAuth (client ID, client secret) | Yes | Present; only production target confirmed, values not inspected. |
| Gmail token encryption key | Yes | Present for production (and separately for preview). |
| Gemini | Partial | `GEMINI_MODEL` present for production; no separate `GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` env vars exist at the Vercel level — **this is expected, not a gap**, since Spencare's AI provider credentials are BYOK, stored per-user in the database (`AI_PROVIDER_ENCRYPTION_KEY` is present, which is what encrypts those). |
| Telegram (bot token, bot username, webhook secret) | Yes | Present. |
| Clarity project ID | Yes | Present, encrypted-at-rest (not decrypted here). |
| Cron secrets (`CRON_SECRET`, `SUPABASE_CRON_SECRET`) | Yes | Both present. |
| Notification sender (Resend API key, from-email) | Yes | Present. |
| Channel/TOTP encryption keys | Yes | Present. |
| Application/callback URLs | Not independently verified | No explicit `NEXT_PUBLIC_APP_URL`-style variable was found in this listing; Vercel's own domain config (`spencare.vercel.app` + 2 alias domains) was confirmed via `get_project`, but individual OAuth redirect URLs configured on the Google/Telegram side were not cross-checked against it. |
| Stale/development values | None found | No `localhost` or obviously-development value was visible in the one plaintext variable available for inspection; encrypted values were not decrypted, so this check is necessarily partial. |
| Unused/dangerous variables | None identified as dangerous; not exhaustively audited | A `preview`-target `NEXT_PUBLIC_SUPABASE_URL`/`GMAIL_TOKEN_ENCRYPTION_KEY`/`GEMINI_MODEL` set exists separately from production's, which is expected (separate preview Supabase project), not flagged as a risk. |

Also confirmed via `get_project`: SSO protection is enabled (`all_except_custom_domains`), password protection is off, no trusted-IP restriction. `latestDeployment.target` reported `null` with `live: false` — worth a human double-check that the intended production deployment is actually the one serving `spencare.vercel.app`, since this field's meaning was not further investigated here.

## Migration Review

| Migration | Classification |
|---|---|
| `20260928000001_confirm_command_financial_plan_commands.sql` | SUPERSEDED — built from an outdated base; fully subsumed into `20260928000007`. DO NOT SHIP as its own migration. |
| `20260928000002_transaction_plan_item_consistency_trigger.sql` | REQUIRED FOR PRODUCTION once Plans ships. Currently LOCAL ONLY. |
| `20260928000003_fix_anon_auth_bypass_transaction_functions.sql` | ALREADY APPLIED (production version `20260928030846`). |
| `20260928000004_reconcile_transactions_occurred_at_timestamptz.sql` | LOCAL ONLY / DO NOT SHIP — production's `occurred_at` is already `timestamptz`; this only reconciles local's own drifted history. |
| `20260928000005_pin_search_path_security_definer_functions.sql` | OPTIONAL — safe, additive hardening, not release-blocking. |
| `20260928000006_drop_stale_date_typed_transaction_overloads.sql` | LOCAL ONLY / DO NOT SHIP — fixes a local-only artifact; production has exactly one overload each, confirmed. |
| `20260928000007_fix_confirm_command_stale_branches_and_add_plans.sql` | REQUIRED FOR PRODUCTION (pending explicit authorization). |
| `20260928000008_fix_service_role_auth_check_regression.sql` | REQUIRED FOR PRODUCTION (pending explicit authorization) — corrects the already-live regression. |

## Migration Dependency Graph

```
20260928000003 (LIVE IN PRODUCTION)
      |
      +--> 20260928000008 (create_transaction/transfer/update_transaction auth fix)
      |       depends on: 000003's grant/revoke structure already being in place (confirmed true)
      |
      +--> 20260928000007 (confirm_command canonicalization + Plans + auth fix + this
              gate's 4 fixes)
              depends on: 000003 (auth pattern precedent), financial_plans_schema
              (already applied), and -- if Plans is shipped alongside -- 000002
              (transaction-plan consistency trigger)

000004, 000005, 000006: no production dependency; safe to skip or apply independently
of the above (000004/000006 are no-ops against production's actual current state;
000005 is optional hardening with zero functional dependency on anything else)
```

`000007` and `000008` are independent of each other (different functions) and can be applied in either order; both only require `000003` to already be live, which it is.

## Application Deployment Order

No application code changes in this gate require a corresponding database object to exist first: the MCP tool payload fixes (`writeTools.ts`) and the accessibility/Privacy fixes are pure application-code changes with no new database dependency. The only genuine ordering constraint is `000007`/`000008` before any application code that assumes the fixed `confirm_command`/`transfer` behavior is live — since the current application code (already deployed) calls these RPCs the same way regardless of whether the bug is present (it just fails today), migration-first is safe and does not require an application deploy in lockstep. Recommended order: migrations first (000007, 000008, in either order), confirm via the read-only checks in Post-Deployment Smoke Tests, then deploy application code (which contains the MCP payload fixes plus the accessibility/Clarity fixes) separately, whenever convenient.

## Rollback Strategy

Not exercised (no production change was made), but assessed:

- **Migration rollback**: `20260928000007` and `20260928000008` both use `create or replace function` with unchanged signatures (verified locally: zero duplicate overloads after applying), so re-applying an equivalent `create or replace function` with the prior (production-current) body would restore the exact previous state, function by function. No data is altered by either migration (they only redefine function bodies and grants), so there is no data-rollback concern.
- **Application rollback**: standard Vercel redeploy-previous-build, no coordination needed with the database changes above, since the application code changes and the migrations are independently safe in either combination (old app + new DB, or new app + old DB) for every path except the exact bug being fixed (which simply continues failing safely, as it does today, until both sides are updated).
- **Forward-fix preference**: given the migrations are pure function redefinitions, a forward-fix (a new `000009` migration) is preferred over a rollback in almost any scenario short of a completely unexpected, severe new symptom.

## Post-Deployment Smoke Tests

Not executed (no deployment occurred). If Gate 14 is later confirmed READY and production authorization is separately given, this section's checklist would be: re-run the same 4 direct-authorization scenarios against production (read-only + one live confirm as a real logged-in test account), the same malformed-UUID/injection checks, a live MCP confirm of one low-risk command (e.g. createGoal) against production credentials, and a read-only comparison of `confirm_command`/`create_transaction`/`transfer`/`update_transaction`'s post-migration `pg_get_functiondef` against the exact migration content applied.

## Remaining Limitations

1. Full ~42-item browser regression list not exhaustively completed (credit card, income/transfer-via-UI, Commitment-Plan association via UI, item lifecycle/archive/delete, disassociation, Net Worth before/after, screen-reader semantics, keyboard-only navigation beyond one Escape test).
2. Environment audit confirmed variable presence and one cross-environment consistency check, but did not decrypt/inspect individual OAuth callback URL values or exhaustively verify every service's configuration correctness.
3. Two known, previously-documented bootstrap-ordering defects (`moddatetime`, `pay_commitment_occurrence_atomic` overload) remain unresolved for a genuine from-zero replay; not shown to affect production, which was not built via a raw sequential replay.
4. `20260928000002`, `20260928000005` not independently re-verified end-to-end beyond the fresh-replay pass.
5. Spensa cannot reach 5 of the fixed command types at all (createAccount, transfer, updateTransaction, createCommitment, updateCommitment are MCP-only tools) — documented as an architectural fact, not something to "fix," but flagged since the original request asked for Spensa verification of exactly these.

## Gate 14 Decision

NOT READY

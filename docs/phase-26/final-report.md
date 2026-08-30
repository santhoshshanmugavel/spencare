# PHASE 26 — FINAL REPORT

Status labels used throughout: **VERIFIED / IMPLEMENTED / LIVE VERIFIED / BLOCKED / EXTERNAL DEPENDENCY / DEFERRED / OUT OF SCOPE**.

## 1. Scope

Four in-scope areas per the Phase 26 mandate, continuing the existing repository (no rewrite, no parallel financial system): (A) Netlify production deployment prep for `spencare-alpha` only; (B) goal image upload; (C) goal image security; (D) editable goal funding account and its financial safety; (E) recurring/future monthly budgets. Explicitly out of scope and not touched: new AI providers, bank integrations, Plaid, WhatsApp/SMS, Outlook, Gmail AI extraction changes, notifications, PIN lock, unrelated Settings redesign, unrelated refactors.

## 2. Baseline

Git HEAD at start: `c6d35b1` (Phase 25 close), clean working tree except the already-disclosed pre-existing items and one untracked `netlify.toml` from an interrupted Part A deployment attempt. Regression suite green (539/539, one pre-existing flaky test confirmed to pass standalone, documented in every prior phase).

## 3. Netlify target verification — VERIFIED

Every Netlify mutation this phase (and the interrupted one before it) targeted `spencare-alpha` (site_id `41af1531-972a-4386-9471-2a67905d2632`) exclusively, verified by ID before creation. `santhosh-design` (site_id `fa2f4fb8-1c7c-47b6-95b9-a1cbb59febca`, domain `santhoshdesign.com`) was never referenced by any tool call — not read, not written, not deployed to, not configured. No ambiguity arose requiring a stop-and-ask.

## 4. Production deployment status — DEFERRED (correctly, not attempted this phase)

`netlify.toml` is configured (root-level pnpm install + `apps/web` build, `@netlify/plugin-nextjs`). No deploy was attempted this phase: production Supabase does not yet exist, and the mandate is explicit that deployment must not proceed with a fake/broken backend. The user's chosen path (create the Supabase project themselves, enter env vars directly into Netlify's dashboard) is unchanged and still the correct next step — see §29.

## 5. Supabase dependency status — EXTERNAL DEPENDENCY (unchanged)

No production Supabase project exists. Local instance fully exercised this phase (two `supabase db reset` cycles applying every migration including the two new ones cleanly from scratch).

## 6. Goal image implementation — IMPLEMENTED / LIVE VERIFIED

New private `goal-images` Storage bucket (`file_size_limit` 5MB, `allowed_mime_types` png/jpeg/webp) with path-scoped RLS (`{userId}/{goalId}/{filename}`), mirroring the existing `avatars` bucket exactly. `goalImageStorageRepo.ts` (upload/delete/signed-URL), `updateGoalImage`/`removeGoalImage` commands mirroring `updateAvatar`/`removeAvatar`. Signed-URL resolution lives only in the query layer (`resolveGoalImageUrl(s)`), never added to `GoalRow` itself. `GoalImageUploader` component covers Empty/Selected/Loading/Success/Error/Edit states, wired into `goal-card.tsx` and `goal-detail-dialog.tsx`, reusing the existing no-image-fallback markup — no new visual language. Live-verified: uploaded a real 2.3MB photo, saw it render immediately and survive a full page reload and a dev-server restart (real DB round-trip, not client-only state); replaced it; confirmed the detail dialog shows the same image; removed it and confirmed the fallback returned.

## 7. Goal image security — VERIFIED

Authenticated-only (every command resolves `ctx.userId` from the verified session, never a client-supplied ID). `updateGoalImage`/`removeGoalImage` call `getGoal` (already scoped to `ctx.userId`) before touching Storage, so a request naming another user's goal id returns `not_found` before any Storage call. Content-type validated by real magic-byte sniffing (`sniffImageMimeType`, reused unmodified), never the declared MIME type or filename extension — live-reproduced: a file named `fake.png` with `Content-Type: image/png` but non-image bytes was correctly rejected with "That file doesn't look like a valid PNG, JPEG, or WebP image." Private storage with short-lived (1-hour) signed URLs generated server-side per request, never a persisted public link. Deleting a goal cleans up its image (best-effort, after the soft delete succeeds, never blocking it). Replacing an image deletes the previous object(s) for that goal first — verified both by unit test and live (object count stayed at 1 across two uploads). Cross-goal isolation verified: replacing one goal's image never touches a different goal's own objects. `security_smoke.sh` gained an 8-check "goal-images storage: path-scoped isolation" section, run live against real Postgres/Storage (upload/read/overwrite/delete denial across two real users, wrong-goal-id-under-caller's-own-prefix denial, MIME/size rejection) — all passing.

## 8. Funding-account edit implementation — IMPLEMENTED / LIVE VERIFIED

Reverses the prior "fixed per goal, not editable" decision per explicit product direction. `updateGoalSchema` accepts an optional `fundingAccountId`; `updateGoal` re-runs the exact bank/cash-type + ownership eligibility check `createGoal` already performs. `edit-goal-sheet.tsx` gained the same `Controller`+`Select` combobox `add-goal-sheet.tsx` already used for this field. Live-verified: created "Europe Vacation" funded from HDFC Savings, reassigned it to ICICI Savings via Edit Goal, confirmed the card immediately showed "Saved in ICICI Savings."

## 9. Funding-account financial safety — VERIFIED

`UpdateGoalPatch`/`updateGoal` in `goalsRepo.ts` touch only the `funding_account_id` column — no cascade into `transactions`, `saved_amount_minor`, or account balances, verified both by code inspection (a plain conditional-spread `.update()`) and live: after reassigning the funding account, HDFC Savings and ICICI Savings balances were re-checked on the real Accounts page and were exactly unchanged (₹5,00,000.00 and ₹2,00,000.00, untouched). Historical transactions are never rewritten — the command never touches the `transactions` table at all.

## 10. Budget recurring architecture — IMPLEMENTED, decision documented

Chose Option B (bounded bulk-write-ahead against the existing `budgets` table, gated by a new `is_recurring` column) over Option A (separate template table, rejected for the blast radius of teaching every reader — Safe-to-Spend, cash-flow, the dashboard, AI/MCP tools — about template resolution) and Option C (versioned/effective-date configuration, rejected as new machinery the existing one-row-per-month schema doesn't need). Forward window: 24 months, an explicit, disclosed bound. Full reasoning is in the migration file's own comment and in `budgetsRepo.ts`'s `applyBudgetToUpcomingMonths` doc comment.

## 11. Budget UX — VERIFIED

Plain-language only: "Apply to: This month only / This month and upcoming months" (edit) and "Apply this budget to all upcoming months" (create) — no "recurrence rule," "template," "materialized instance," or "effective date" anywhere in user-facing copy (grepped the new UI files to confirm). Built from the already-installed `radix-ui` package (new `RadioGroup`/`Checkbox` primitives, matching the existing `Select`/`Label` class conventions) — no new dependency.

## 12. Month-specific override behavior — LIVE VERIFIED

Live-reproduced the mandate's own worked example: created a Dining budget for August 2026 at ₹10,000 with "apply to upcoming months," confirmed September/November/December/January all inherited ₹10,000; set December specifically to ₹20,000 without checking "apply to upcoming" (a deliberate override); re-applied the plan from November at ₹15,000 with "apply to upcoming" checked; confirmed December stayed at exactly ₹20,000 (untouched) while January correctly updated to ₹15,000 (followed the new plan).

## 13. Apply-to-upcoming behavior — LIVE VERIFIED

The confirmation dialog (`ApplyToUpcomingConfirmDialog`, reusing `ConsequentialActionPreview`) showed the mandate's exact required copy both times it was exercised live: *"Your changes will replace the current budget plan for [Month] and all upcoming months. Previous months won't be changed."* with Cancel / Confirm buttons. Declining to check the box submits immediately with no confirmation step, exactly as a plain edit always has.

## 14. Historical-month protection — VERIFIED

`applyBudgetToUpcomingMonths` only ever computes forward from the edited month (`addMonthsToPeriodStart(fromPeriodStart, i)` for `i = 0..24`); it has no code path that can reach a month before `fromPeriodStart`. Unit-tested explicitly (case 7 in the edge-case suite: a pre-existing June budget is untouched by an August "apply to upcoming").

## 15. Database changes — VERIFIED, fresh + existing DB safe

Two additive migrations: `20260907000001_goal_images.sql` (new Storage bucket + 4 policies, no table changes) and `20260907000002_budget_recurrence.sql` (`budgets.is_recurring boolean not null default false`). Both applied cleanly across two full `supabase db reset` cycles (fresh DB, every migration in order). The existing `(user_id, category_id, period_start) where deleted_at is null` unique index is untouched. Generated types (`packages/domain/infra/src/generated/database.types.ts`) were regenerated via `supabase gen types typescript --local` and diffed to confirm the change is exactly the three expected `is_recurring` fields (Row/Insert/Update) — consistent with this project's convention, generated types are not committed to git.

## 16. Security — VERIFIED

`security_smoke.sh`: **224 passed, 0 failed** (216 baseline + 8 new goal-images checks), run live against real Postgres/Storage after a fresh `supabase db reset`. `pnpm audit --prod`: zero vulnerabilities. Secret scan (`git grep` for key-shaped patterns across the diff): zero matches. Client bundle scan (fresh production build's `.next/static`): zero matches for any server-only secret name. No RLS policy was weakened; no service-role client was introduced for any new code path; every new command resolves identity from `ctx.userId`, never a client-supplied value.

## 17. Accessibility — VERIFIED

All new/updated RTL suites include `jest-axe` assertions and pass (goal image controls, funding-account combobox, budget radio/checkbox, confirmation dialog). Radio/checkbox use real `role="radio"`/`role="checkbox"` semantics (Radix primitives) with associated labels. The uploaded goal image now carries a real, descriptive `alt` (`"Photo for {goalName}"`) rather than empty alt — a genuine accessibility improvement caught during this phase's own test-writing (an empty-alt image is accessibility-invisible, which would have made a real, meaningful photo undiscoverable to screen-reader users). Dialog focus management, keyboard reachability, and touch-target sizing (44px) follow the same established components (`ConsequentialActionPreview`, `Sheet`, `Dialog`) used everywhere else in the app.

## 18. Responsive validation — VERIFIED (with one tooling caveat, disclosed)

Checked live at 320/375/390/430/768/1024/1280px: goal image controls (Replace/Remove buttons, image frame) and the budget edit sheet (radio group, confirm dialog) show no overflow or clipping at any width, full-width sheets scale correctly, no fixed pixel widths anywhere in the new code. One interactive breakpoint check (clicking through the confirm dialog specifically at a resized narrow viewport) was blocked by a browser-automation tooling limitation — clicks reliably time out on this session's Browser pane after a `resize_window` call, a tool-level quirk, not a page defect (confirmed: the identical interaction works correctly at native width via a second browser surface, and the resized layouts screenshot cleanly with all controls visible and correctly sized). Full interactive verification (including the confirm dialog) was completed at native/desktop width instead.

## 19. Tests — VERIFIED, real numbers

| Package | Test files | Tests |
|---|---|---|
| `@spencare/validation` | 10 | 173 |
| `@spencare/domain-core` | 16 | 257 |
| `@spencare/domain-infra` | 13 | 103 |
| `@spencare/domain-application` | 27 | 268 |
| `@spencare/ai` | 7 | 70 |
| `@spencare/mcp-server` | 4 | 26 |
| `@spencare/web` | 61 | 554 |
| **Total** | **138** | **1,451** |

All passing, `pnpm -r run test`, run twice (once mid-phase, once as final regression). New this phase: `goalImage.test.ts` (12), `next.config.test.ts` (1), the goals.ts funding-account-edit describe block (6), the budgets.ts 20-edge-case describe block (14), 4 domain-core date-arithmetic cases, plus updated fixtures/assertions across 10 existing UI test files that needed the new required props/behavior.

## 20. Build — VERIFIED

`pnpm -r run build`: all 7 buildable packages succeed, including a full Next.js production build (Turbopack) with the new `experimental.serverActions.bodySizeLimit` config recognized (`- Experiments (use with caution): · serverActions` in the build log). One pre-existing, unrelated warning (`Failed to find font override values for font 'Google Sans Flex'`) — documented since Phase 23, not touched.

## 21. Typecheck — VERIFIED

`pnpm -r run typecheck`: all 7 packages pass with zero errors.

## 22. Lint — VERIFIED

`apps/web`: zero errors, 3 pre-existing warnings in files this phase never touched (`onboarding-wizard.tsx`, `add-account-sheet.tsx` — a React Compiler note about `react-hook-form`'s `watch()`, unrelated to Phase 26). `packages/domain/core`'s `lint` script remains broken (`eslint: command not found`) — the same pre-existing, non-blocking defect documented since Phase 16/21/25, not touched this phase.

## 23. Conformance — VERIFIED

No new SECURITY DEFINER RPC was added where plain RLS-scoped CRUD already applied (budgets remain plain CRUD, per the locked Phase 9 decision, extended not replaced). No service-role client used in any new command. No `NEXT_PUBLIC_*` variable was added. Design-system components reused throughout — zero new visual language.

## 24. Security smoke — VERIFIED

224 passed, 0 failed (see §16).

## 25. Secret scan — VERIFIED

Zero matches across the full diff and the built output.

## 26. Client bundle scan — VERIFIED

Zero matches for any server-only secret/env-var name in `.next/static` after a fresh production build.

## 27. Browser verification — LIVE VERIFIED (real, not fabricated)

Full real user journey driven through the actual local app this phase: signed up a fresh account, completed onboarding, created two real bank accounts, created a goal, uploaded/replaced/removed a real image (including a deliberate oversized-file and invalid-content-sniffing rejection test), reassigned its funding account and confirmed balances unchanged, created a recurring budget, verified forward propagation, set and preserved a month-specific override, and re-confirmed Safe-to-Spend reflected the real budget/goal state correctly (₹10,000, matching the documented `min(budgetRemaining, balance − goalReserved)` formula by hand-calculation). One incidental note: the browser-automation tool's `file_upload` substituted a stock sample image for the very first, small test upload rather than reading the exact bytes requested — resolved by using larger, explicitly-generated test files for every subsequent upload, which uploaded and rendered correctly as the real bytes sent; this affected only the choice of test image content, not the correctness of anything verified.

## 28. Defects found — 2 real, both fixed this phase

1. **Server Actions' default 1MB body limit silently blocked any real photo upload over ~1MB** (both goal images and the pre-existing avatar feature) — found live, root-caused to Next.js's documented default, fixed via `next.config.ts`, regression-covered, re-verified live with both a 2.3MB success case and a 5.6MB correctly-rejected-with-a-friendly-message case. See §28a below and the dedicated commit.
2. **Pre-existing 320px-width overflow in the Budgets page's "Budget remaining" hero figure** — found incidentally during this phase's own responsive pass, confirmed unrelated to any Phase 26 diff by inspection. Flagged as a background task (not fixed here, per the explicit no-scope-creep instruction) rather than folded into this phase's commits.

## 29. Defects fixed

Both defects in §28 that were actionable within scope: #1 fixed and verified this phase (commit `da20f8d`). #2 is out of this phase's scope (a pre-existing, unrelated component) and was flagged for separate follow-up rather than fixed here.

## 30. Deferred items

- Actual Netlify deployment of `spencare-alpha` — waiting on the user to create their production Supabase project and enter env vars into Netlify's dashboard themselves (their own stated preference, unchanged).
- The pre-existing 320px hero-figure overflow on the Budgets page (§28.2) — flagged, not fixed, out of scope.
- Full interactive responsive click-through at every resized breakpoint (§18) — layout verified at all 7 breakpoints; the specific confirm-dialog click sequence was instead fully verified at native width due to a browser-automation tooling limitation.

## 31. External dependencies (unchanged from Phase 25, re-confirmed)

Production Supabase project, hosting/domain (Netlify site exists, deploy pending credentials), Google Cloud OAuth (Sign-In + Gmail, separate clients), a verified/rotated Anthropic API key, monitoring provider decision, email-delivery decision, legal counsel for Terms/Privacy. None of these were touched or newly blocked by this phase's work.

## 32. Netlify deployment result

Not attempted this phase (see §4) — correctly deferred pending production Supabase credentials, per the mandate's own "do not deploy a partially configured/broken application" rule. `spencare-alpha` remains the sole authorized target; `santhosh-design` remains completely untouched (§3).

## 33. Git diff summary

4 commits on `main`, `c6d35b1` → `0f0f791`: 46 files changed, 2,201 insertions(+), 69 deletions(-). Two new SQL migrations, six new source files (goal image storage/commands/component, apply-to-upcoming confirm dialog, radio-group/checkbox primitives), one new Next.js config change plus its regression test, and 34 modified files spanning validation/domain-core/domain-infra/domain-application/apps-web layers plus the security smoke script.

## 34. Commit hashes

- `3b3213d` — feat: goal image upload + editable funding account (Phase 26 B/C/E/F)
- `903b3ab` — feat: recurring/future monthly budgets (Phase 26 G)
- `da20f8d` — fix: Server Actions' default 1MB body limit silently blocked real photo uploads
- `0f0f791` — build: Netlify deployment config for spencare-alpha (Phase 26 A)

## 35. Final readiness status

**PHASE 26 SCOPE: COMPLETE.** All four in-scope areas (A–E) are implemented, tested (1,451 tests passing across 7 packages), security-verified (224/0 smoke, zero secret/bundle leaks, zero audit vulnerabilities), and live-verified end-to-end in a real browser against the real local database — including the exact worked examples both the goal-funding-account and month-specific-override scenarios describe. One real defect was found live and fixed with regression coverage (§28.1); one unrelated pre-existing defect was found incidentally and correctly left out of scope (§28.2). Overall Spencare production-readiness status is **unchanged from Phase 25's CONDITIONAL GO** — this phase added features and fixed a real defect, but did not touch, resolve, or newly block any of the external dependencies in §31. Production deployment of `spencare-alpha` remains the next real step, gated on the user providing production Supabase credentials as they chose to do themselves.

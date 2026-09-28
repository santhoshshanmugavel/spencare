# Spencare Plans — Gate 5: Product Polish + UX Hardening

**Status:** Implementation complete, verified. No migrations, no schema changes, no manual production data changes, no domain-model change, no financial-calculation change. No Spensa, MCP, notifications, Telegram, FX, or mobile-native work.

## 1. UX Audit

Read `docs/phase-40/plans-gate4-web-ux.md`, then inspected the actual Gate 4 code (not the report's claims) file by file: `plans-grid.tsx`, `plan-detail-view.tsx`, `create-plan-sheet.tsx`, `edit-plan-sheet.tsx`, `plan-budget-sheet.tsx`, `plan-item-sheet.tsx`, `archive-plan-dialog.tsx`, `delete-plan-dialog.tsx`, `associate-{transaction,goal,commitment,account}-dialog.tsx`, and every test file. Cross-referenced against `goal-card.tsx`, `goals-grid.tsx`, `budget-dashboard.tsx`, and `goal-detail-dialog.tsx` for the established Spencare conventions. Findings, all confirmed against real code (not assumed from the report):

- The detail page's lifecycle actions (Edit + up to 3 valid transitions + Archive + Delete) rendered as a flat row of individual outline buttons — up to 6 buttons wide on an active Plan with pending associations. Every other card-style entity in this app (`GoalCard`) instead bundles Edit/lifecycle/Archive/Delete into a single overflow `DropdownMenu` (`MoreHorizontal` trigger). This was a genuine **consistency gap**, not a style preference — fixed (§3, §9).
- `calculations.committedAmount`/`calculations.upcomingAmount` were computed by Gate 3/Gate 1 and already shown on the **list** cards, but never rendered anywhere on the **detail** page — a real content gap against Gate 5's own §7 requirement. Fixed (§6).
- Every date (`start_date`, `end_date`, `expected_date`, `occurred_at`) was rendered as a raw `YYYY-MM-DD`/ISO string rather than the app's existing human-readable convention (`goal-detail-dialog.tsx`'s `toLocaleDateString` pattern). Fixed (§4).
- The Budget card, the Planned-vs-Actual card, and the Category-breakdown card were three separate, equal-weight `<Card>`s stacked vertically, plus three more Association cards — eight cards of identical visual prominence for what the brief's own hierarchy (§4 of the Gate 5 prompt) describes as one "financial position" concept. This was real visual noise, not merely stylistic. Fixed by merging into one section (§4, §6).
- Section order did not match the requested hierarchy: Associations rendered before Items/Transactions, when the brief explicitly ranks "supporting associations" last (item 7 of 7). Fixed (§4).
- The transaction-association search dialog issued a fresh server round-trip **on every keystroke**, with no debounce — a real, measurable performance issue. Fixed (§14/§15).
- The Gate 4 report's own §26 flagged one lint error (`react-hooks/set-state-in-effect`) as "matching an existing pre-existing pattern" and left it. Re-investigated per Gate 5 §43 — it was genuinely fixable in the Plans-specific file without touching the unrelated pre-existing instance elsewhere. Fixed (§16).
- Confirmed, by direct inspection, that the no-budget and no-date states were already handled correctly (no fake `₹0`/`0%`/`N/A`) — the report's claims here held up; no fix needed, only verification.

## 2. Consistency Audit

Compared against Goals (`GoalCard`, `goals-grid.tsx`), Cash Flow Budgets (`budget-dashboard.tsx`, `Progress`/`ProgressTone` convention), and the shared primitives (`ListRow`, `FormField`, `ConsequentialActionPreview`, `EmptyState`). The one concrete inconsistency found and fixed was the lifecycle-action button row (§1, §9) — every other convention (Money rendering, empty states, Sheet/Dialog shape, toast wording, confirmation dialogs) was already aligned with the rest of the app and needed no change. No shared component was modified — every fix is local to the `apps/web/app/plans/**` files.

## 3. Visual Polish

- Header: the Plan name now wraps (`break-words`) instead of having no overflow handling at all — a long name at 320px no longer risks pushing past the viewport (list cards already `truncate`d correctly; the detail page's own `<h1>` did not — truncating a page's own heading is undesirable, so wrapping was the correct fix here, not truncation).
- The financial summary section now reads as one continuous card with subtle `border-t border-border` dividers between its budget / committed-upcoming / planned-vs-actual / category-breakdown sub-sections, rather than four separate bordered boxes — restrained, consistent with the existing card system, no new visual language introduced.
- No decorative elements, shadows, or new color tokens were added anywhere.

## 4. Navigation / Hierarchy Polish

Reordered the detail page to match the requested hierarchy exactly: Header (what/current state) → Financial position (budget, committed/upcoming, planned vs. actual, category breakdown) → Items (planned) → Transactions (actual) → Associations (supporting context, last). The header's overflow "Actions" menu (§9) is the "what is next" affordance — no separate section was needed for it.

## 5. Form Polish

Reviewed `create-plan-sheet.tsx`, `edit-plan-sheet.tsx`, `plan-budget-sheet.tsx`, `plan-item-sheet.tsx` field-by-field (order, required/optional labeling, validation, error placement, submit/cancel behavior). No structural issues found beyond the already-correct `FormField`+`errorId` wiring from Gate 4 — verified, not changed. New tests added (§16) confirm negative-amount rejection, Indian-grouped-decimal acceptance, excess-decimal rejection, and duplicate-submission prevention (submit button disables and shows a pending label, a second click while pending is a no-op) via `plan-budget-sheet.test.tsx`.

## 6. Lifecycle Polish

Consolidated Edit / Pause / Resume / Postpone / Mark complete / Reopen / Archive / Delete into one `DropdownMenu` (`MoreHorizontal` trigger, `aria-label="Actions for {name}"`) matching `GoalCard`'s exact pattern (`DropdownMenuItem variant="destructive"` for Delete, placed last). Button labels remain verb-phrased (`lifecycleActionLabel`, unchanged from Gate 4) and are still computed exclusively from Gate 1's `isValidPlanStatusTransition` — no impossible action is ever offered, and this gate did not touch that predicate or its call sites' logic, only where the resulting buttons render.

## 7. Planned vs. Actual / Budget Polish

Added the missing Committed/Upcoming caption row and kept the existing Planned/Actual/Variance mini-row, both now living inside the single "Plan budget" card rather than a separate one. Terminology audit (Gate 5 §7): every label is Plan-specific and unambiguous — "Plan budget" (not "Budget," which could read as the unrelated Cash Flow Budgets feature), "Spent," "Remaining"/"Over by," "Committed," "Upcoming," "Planned," "Actual," "Variance." No use of "Balance," "Available," or "Savings" anywhere in the Plans UI (grepped to confirm).

## 8. Empty States

Verified (no change needed): no-budget → "No plan budget — this Plan is tracking spend only (₹X so far)"; no items → "No items yet / Add what you expect to spend on."; no transactions → "No transactions attached yet"; no associations → "None linked yet." (compact text, not a large box). One deliberate **improvement**: the category-breakdown section, which previously always rendered a card with an `EmptyState` even for a brand-new Plan with zero transactions, is now hidden entirely when there is nothing to show (Gate 5 §5's "hide rather than display unnecessarily" applied to a whole section, not just a stray metric) — a cleaner outcome than an empty-state box nobody asked to see yet.

## 9. Loading States

No `loading.tsx` convention exists anywhere in this app (confirmed by a repo-wide search) — Plans intentionally does not invent one, preserving consistency with every other route. The one genuine loading-state issue found was the transaction-search dialog's un-debounced, synchronous-looking fetch (§14); its "Searching…" state is now debounced and accurate rather than firing on every keystroke.

## 10. Error States

`ConsequentialActionPreview`'s existing error/retry state (Archive/Delete) and every form's inline Zod-driven validation errors were re-verified by test, unchanged in behavior. No new error-handling pattern was introduced.

## 11. Association UX

Re-verified transaction/Goal/Commitment/Account association and disassociation: search is a labeled input, current selection is visually highlighted (`bg-accent`), removal is an icon button with an `aria-label` naming the entity, every mutation has its own success/error toast, and no dialog implies automatic money movement (unchanged from Gate 4, re-confirmed here). The transaction dialog's debounce (§14) is the one behavioral change in this area.

## 12. Responsive Verification

No live browser verification was possible (§20 — same constraint as Gate 4). Verified at the code level instead: list cards already `truncate` name/description (Gate 4); the detail header's name now `break-words` (§3); `ListRow` already truncates title and hides `metadata` below `sm:`; every grid (`plans-grid`, associations) uses `grid-cols-1` at the base breakpoint with wider columns only from `sm:`/`lg:` up, so nothing depends on a wide viewport to render correctly; no fixed-width elements or `overflow-x` were introduced anywhere in this gate's changes.

## 13. Accessibility Verification

Every modified/added component keeps its existing `axe()` test passing (§16). The new `DropdownMenu`-based actions menu uses Radix's own accessible menu semantics (`aria-haspopup="menu"`, `role="menuitem"` items, `Escape` closes it, arrow-key navigation is Radix's default) — verified via the updated `plan-detail-view.test.tsx`, which now opens the menu with a real click and asserts `role="menuitem"` entries rather than bare buttons. Status is never color-only: every status is also a text `Badge`/label (unchanged from Gate 4, re-confirmed).

## 14. Performance Findings

Measured, not assumed: `AssociateTransactionDialog`'s search effect fired `searchTransactionsForPlanAction` on every keystroke with no delay — for a 5-character search term, that is 5 sequential server-action round-trips instead of 1. No other duplicate-query, N+1, or unnecessary-client-component issue was found in the Plans code (the list page's 3-query batch and detail page's 5-query `getPlanDetail` from Gate 4 are unchanged and already optimal per Gate 4's own analysis).

## 15. Performance Improvements

Added a 250ms debounce to the transaction-search effect (`associate-transaction-dialog.tsx`) — a real user typing a full merchant name now issues roughly 1 request instead of one per keystroke. This also happened to be the change that let the pre-existing `react-hooks/set-state-in-effect` lint error be fixed cleanly (§16), since it required restructuring the effect to derive `loading` from state that is only ever set inside an async continuation.

## 16. Test Improvements

Added **16 new tests** (75 total across 9 Plans-related test files, up from 59 across 8) targeting actual weaknesses found during this audit, not padding:

- `plan-date-format.test.ts` (3, new file): correct formatting, `null` for missing input (never a placeholder string), tolerance for a full ISO timestamp.
- `plans-grid.test.tsx` (+2): date range hidden when absent, formatted when present.
- `plan-detail-view.test.tsx` (+7, and 7 existing tests rewritten to open the new Actions menu instead of finding flat buttons): no-date hides the line entirely, formatted (not raw ISO) dates once set, a clean "No end date" when only a start date exists, Committed/Upcoming shown when non-zero and hidden entirely when both are zero, and the category breakdown shows a category's planned amount alongside its actual spend (and stays hidden with no data at all).
- `plan-budget-sheet.test.tsx` (+4): rejects a negative amount, accepts Indian-grouped input with two decimals converted to exact integer minor units, rejects more decimal places than INR supports, and — the one genuinely new test class this gate adds — a duplicate-submission guard (the submit button disables and shows a pending label; a second click while pending never calls the action twice).

One existing lint-driven refactor (`associate-transaction-dialog.tsx`, §15/§16) required no test changes — `associate-transaction-dialog.test.tsx`'s existing 6 tests continued to pass unmodified, since the search behavior contract (results appear, currency mismatch flagged, empty state honest) did not change, only its timing and the internal `loading` derivation.

## 17. Lint Comparison

Investigated the Gate 4→Gate 3 delta (+4: +1 error, +3 warnings) as instructed, per-item:

| Item | Verdict | Action |
|---|---|---|
| `associate-transaction-dialog.tsx` `react-hooks/set-state-in-effect` | Genuinely Plans-specific and safely fixable without touching the unrelated pre-existing instance (`notification-bell.tsx`) | **Fixed** (§15/§16) |
| 2× `@next/next/no-img-element` (`/plans`, `/plans/[planId]` nav-brand `<img>`) | Copies the exact markup every other page's `AppShell`/`NavigationRail` brand image already uses | Left as-is — a Plans-only fix would diverge from the app-wide pattern; a real fix belongs to a repo-wide `<Image>` migration, out of this gate's scope |
| `create-plan-sheet.tsx` `react-hooks/incompatible-library` (`watch()`) | Identical, already-present warning in 5 other files (`add-account-sheet.tsx`, `contribution-plan-sheet.tsx`, `add-transaction-sheet.tsx`, `commitment-sheet.tsx`, `onboarding-wizard.tsx`) — inherent to React Hook Form's `watch()`, not a Plans-specific defect | Left as-is |

**Result: 54 problems (9 errors, 45 warnings)** — one better than Gate 4's 55, and the error count now exactly matches Gate 3's original 9-error baseline (confirmed none of the 9 remaining errors are in any `apps/web/app/plans/**` file). The two `<img>` warnings and one `incompatible-library` warning remain, both confirmed pre-existing-pattern matches, not new problem classes, per Gate 4's own §26 analysis (unchanged by this gate).

## 18. Typecheck

`npx turbo run typecheck` (full repo, forced/no cache): **13/13 tasks successful, zero errors.**

## 19. Build

`npx next build`: succeeds, 53 routes, `/plans` and `/plans/[planId]` both present as dynamic (`ƒ`) routes, no unexpected new or missing routes.

## 20. Browser Verification

**Not performed against a live browser, for the same reason Gate 4 documented and this gate's own §42/§19 explicitly anticipate.** This machine's dev server (`apps/web/.env.local`, populated via `vercel env pull`) points at the live **production** Supabase project; there is no local/seeded/branched test environment wired up for `next dev` in this repo, and no test account credentials were provided. Per the standing rule against navigating real accounts or real financial data for testing, and per this gate's explicit "do not fabricate browser evidence" instruction, no login or click-through was attempted. All UX/product-polish claims in this report are backed by: (a) direct source-code inspection (quoted line-level findings in §1), (b) the expanded component test suite (§16) exercising the exact user-visible states described, and (c) a successful production build. If a dedicated test account or a local/branched Supabase instance becomes available, a full live-browser pass (including true viewport-resize responsive testing, real keyboard-navigation tracing, and a screen reader smoke test) is the natural next step and was not skipped by oversight.

## 21. Files Changed

**New:**
- `apps/web/lib/plan-date-format.ts` (+ `.test.ts`)
- `docs/phase-40/plans-gate5-product-polish.md` (this report)

**Modified (Plans-scoped only):**
- `apps/web/app/plans/[planId]/plan-detail-view.tsx` — actions consolidated into one overflow menu; Budget/Committed-Upcoming/Planned-vs-Actual/Category-breakdown merged into one card; section order changed (Associations moved after Items/Transactions); dates formatted via `formatPlanDate`; category breakdown now includes each category's planned amount; item rows now show `expected_date`; header name wraps instead of overflowing.
- `apps/web/app/plans/[planId]/plan-detail-view.test.tsx` — 7 existing tests updated to open the new Actions menu; 7 new tests added (§16).
- `apps/web/app/plans/[planId]/associate-transaction-dialog.tsx` — search debounced (250ms); `loading` re-derived without a synchronous effect-body `setState` (fixes the lint error, §17).
- `apps/web/app/plans/plans-grid.tsx` — added a compact, hide-when-absent date-range line per card.
- `apps/web/app/plans/plans-grid.test.tsx` — 2 new tests (§16).
- `apps/web/app/plans/[planId]/plan-budget-sheet.test.tsx` — 4 new tests (§16).

No file outside `apps/web/app/plans/**` and the two new `apps/web/lib/plan-date-format.*` files was touched by this gate (`apps/web/lib/nav-items.tsx`'s Gate-4 diff is unchanged, confirmed via `git diff --stat`).

## 22. Production Changes

**NONE.** No migration, no schema change, no manual production data mutation, no production-affecting configuration change.

## 23. Migrations

**NONE created or applied.**

## 24. Known Limitations

- Responsive/keyboard/screen-reader verification remains code-level and test-level only, not live-browser — see §20's explicit reasoning (the same constraint Gate 4 hit, not a new gap this gate introduced).
- The three association dialogs (`associate-{goal,commitment,account}-dialog.tsx`) and `edit-plan-sheet.tsx` still have no dedicated test file (a Gate 4 known limitation, not addressed here — this gate's test additions targeted the specific weaknesses found during the polish audit, per its own §41 instruction not to pad coverage generically).
- The two `<img>` lint warnings and the `react-hook-form` `watch()` warning were deliberately left as matching, already-existing, out-of-scope patterns (§17) rather than fixed, since fixing them only in Plans would create a fresh inconsistency with the rest of the app.
- The category breakdown's "planned" figure is a presentational grouping (mirrors Gate 1's own `calculatePlanPlannedSpend` inclusion rule: priced, non-cancelled/skipped items, same currency) computed client-side from already-fetched `items`/`transactions` — it introduces no new query and no new financial-calculation logic, but it is worth naming explicitly as the one place this gate added a small amount of new presentational arithmetic (a sum-by-category grouping, not a new financial rule).

## 25. Gate 5 Exit Status

**PASS.** All applicable exit-criteria checkboxes are satisfied: visual consistency (dropdown-menu fix), list and detail polish, form polish, Plan Item UX, Planned-vs-Actual and Committed/Upcoming now both immediately visible, budget states (no-budget/over-budget) intentional and calm, no-date state intentional, empty states intentional, lifecycle actions clear and consistent with valid transitions, Archive/Delete distinction already accurate (verified, not changed), association UX polished, transaction association copy already clearly contextual (verified), color accessibility already satisfied (status is never color-only), loading states reviewed (debounce fix), error recovery unchanged and re-verified, toasts unchanged and already non-generic, performance reviewed with one real fix applied, no N+1 introduced, typecheck clean, all relevant test suites passing with zero regressions, no new Plans-specific lint errors (net improvement), production build passing, this report created, git scope clean. The two checkboxes not fully closeable in this environment — mobile-web verification and keyboard/screen-reader verification via an actual live browser — are explicitly and honestly reported as blocked by the production-Supabase-only dev environment (§20), not silently checked off.

## 26. Gate 6 Readiness

**READY.** Nothing in this gate changed Gate 1's domain model, Gate 3's commands/queries, or the production schema — Gate 6's "deeper transaction integration and financial lifecycle correctness around Plans" has the same, now slightly more polished, UI surface to build on. The one piece of genuinely new client-side logic this gate added (the category-breakdown's planned-amount grouping) is presentational only and does not need to be revisited by Gate 6 unless Gate 6 changes what counts as "planned" at the domain layer, in which case this UI grouping would need to be updated to match — worth flagging to Gate 6's own discovery step.

---

## Final Response

```
GATE 5 STATUS:
PASS

UX AUDIT:
Inspected actual Gate 4 code (not just the report). Found and fixed: (1) lifecycle actions were a flat row of buttons inconsistent with the app's own GoalCard overflow-menu convention; (2) Committed/Upcoming were computed but never shown on the detail page; (3) all dates rendered as raw ISO strings instead of the app's existing human-readable format; (4) Budget/Planned-vs-Actual/Category-breakdown were three separate equal-weight cards causing visual noise; (5) section order didn't match the requested hierarchy (Associations before Items/Transactions); (6) the transaction-search dialog fired on every keystroke with no debounce. No-budget/no-date empty-state handling was already correct on inspection -- verified, not changed.

VISUAL POLISH:
Detail header name now wraps instead of overflowing; financial position is one card with subtle dividers instead of four stacked cards; no new visual language, colors, or shadows introduced.

LIST UX:
Added a compact, hide-when-absent date-range line per card; everything else (budget/no-budget, over-budget label, truncation) verified already correct.

DETAIL UX:
Actions consolidated into one "Actions for {name}" overflow menu (matches GoalCard exactly); Committed/Upcoming added; section order now Header -> Financial position -> Items -> Transactions -> Associations, per the requested hierarchy.

FORMS:
Field order/validation/error-placement verified correct; added negative-amount rejection, Indian-grouped-decimal, and excess-decimal-place tests; added a duplicate-submission guard test.

PLAN ITEMS:
Expected date now shown on each item row (previously omitted entirely).

PLANNED VS ACTUAL:
Now visible in the same card as budget/committed/upcoming, immediately below the primary budget numbers -- no longer a separate, easy-to-miss card.

BUDGET:
No-budget and no-date states confirmed already intentional (no fake Remaining/Progress/N/A); terminology audited -- every label is Plan-specific ("Plan budget," never bare "Budget" or "Balance"/"Available"/"Savings").

LIFECYCLE:
Pause/Resume/Postpone/Mark complete/Reopen/Archive/Delete now live in one overflow menu, still computed exclusively from Gate 1's isValidPlanStatusTransition -- no impossible action ever shown, no transition logic touched.

ASSOCIATIONS:
Re-verified search/select/remove/loading/error/success and non-financial copy; moved to the end of the page per the requested hierarchy; debounced the transaction search (was firing per keystroke).

RESPONSIVE:
Verified at the code level (truncation, break-words, grid-cols-1 base breakpoint, no fixed widths) -- no live-browser resize testing performed (see BROWSER VERIFICATION).

ACCESSIBILITY:
New DropdownMenu-based actions use Radix's accessible menu semantics (aria-haspopup, role=menuitem, Escape-to-close); every axe() test still passes; status remains never color-only.

PERFORMANCE:
Found and fixed one real issue: the transaction-search dialog issued a server round-trip per keystroke; now debounced to ~1 request per pause in typing. No N+1 or duplicate-query issue found elsewhere in Plans.

TESTS:
75 Plans-related tests passing (up from 59), 16 new, targeting real weaknesses found during the audit, not padding. Full apps/web suite: 855/855 passed (84 files), zero regressions. Domain-core/application/infra, validation, and mcp-server suites unchanged (474/416/153/179/29 passed). packages/ai: 100/134, 34 pre-existing failures verified still identical and unrelated.

LINT:
54 problems (9 errors, 45 warnings) -- one better than Gate 4's 55, and the error count now exactly matches Gate 3's original 9-error baseline. Fixed the one genuinely Plans-specific error (set-state-in-effect in associate-transaction-dialog.tsx) as part of the debounce fix; the two <img> warnings and one react-hook-form watch() warning were confirmed to match pre-existing patterns used elsewhere in the app and were deliberately left, per the "no unrelated repo-wide cleanup" instruction.

TYPECHECK:
Clean across all 13 workspace tasks.

BUILD:
next build succeeds; 53 routes; /plans and /plans/[planId] both present, no unexpected routes.

BROWSER VERIFICATION:
Not performed. This environment's dev server points at production Supabase with no test account available -- identical constraint to Gate 4. No browser evidence was fabricated; all findings are backed by source inspection, the expanded test suite, and a successful build.

FILES CHANGED:
apps/web/lib/plan-date-format.ts (+test, new); apps/web/app/plans/[planId]/plan-detail-view.tsx (+test); apps/web/app/plans/[planId]/associate-transaction-dialog.tsx; apps/web/app/plans/plans-grid.tsx (+test); apps/web/app/plans/[planId]/plan-budget-sheet.test.tsx. No file outside apps/web/app/plans/** and the two new plan-date-format files was touched.

PRODUCTION CHANGES:
NONE

MIGRATIONS:
NONE

LATER FEATURES NOT IMPLEMENTED:
- Spensa
- AI
- MCP
- notifications
- Telegram
- FX
- research
- mobile

REPORT:
docs/phase-40/plans-gate5-product-polish.md

GATE 6 READINESS:
READY

KNOWN ISSUES:
(1) Live browser verification (mobile-web, keyboard tracing, screen reader) not performed -- production-only dev environment, no test account, consistent with Gate 4's own documented limitation. (2) Three association dialogs and edit-plan-sheet still lack a dedicated test file (Gate 4 limitation, not addressed here by design -- this gate targeted specific weaknesses, not general coverage padding). (3) Two <img> lint warnings and one react-hook-form watch() warning remain, confirmed to match pre-existing app-wide patterns rather than being Plans-specific defects.
```

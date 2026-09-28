# Spencare Plans — Gate 4: Web UX Implementation

**Status:** Implementation complete, verified. No migrations, no schema changes, no manual production data changes. No MCP, no Spensa, no notifications, no Telegram, no FX, no mobile-native work.

## 1. Discovery

Inspected, as the concrete UI templates for this gate: `apps/web/app/goals/{page,goals-grid,edit-goal-sheet,archive-goal-dialog,delete-goal-dialog,goal-detail-dialog}.tsx` (list/detail/CRUD/lifecycle-dialog shape), `apps/web/app/cash-flow/budgets/budget-dashboard.tsx` (Progress + tone convention, `ListRow` category rollup precedent), `apps/web/app/spensa/[conversationId]/page.tsx` (the only existing `[dynamicSegment]/page.tsx` in the app, used as the template for `PageProps<"/plans/[planId]">` and the "resolve session → build `AuthContext` → fetch via the query layer → render inside `AppShell`" route shape), `apps/web/components/spencare/{money,empty-state,list-row,form-field,consequential-action-preview}.tsx` (canonical rendering primitives), `apps/web/lib/{money-input,currency-format}.ts` (amount parsing/formatting), and `apps/web/lib/nav-items.tsx`/`navigation.ts` (nav wiring). Confirmed via `ls apps/web/app/plans/` that Gate 3 left exactly one file (`actions.ts`, no `page.tsx`) — so no route existed yet, matching Gate 3's own closing statement.

## 2. Architecture Decision: Batched List-Summary Query (the one Gate-3-compatible extension this gate needed)

The `/plans` list page needs each Plan's actual/planned/committed/upcoming/remaining/progress figures. Gate 3's `getPlanDetail(ctx, planId, asOfIso)` computes exactly these, but it is **per-Plan** (5 sub-queries). Calling it once per Plan on a list page would be N+1 — explicitly prohibited by this gate's brief. Per the brief's own "if Gate 3 doesn't expose what the UX needs, make the smallest necessary Gate-3-compatible change and document why/what/tests" rule, this gate added:

- `listPlanItemRowsForUser(client, userId)` — every Plan Item across every one of the caller's Plans, one query (`packages/domain/infra/src/financialPlansRepo.ts`).
- `listTransactionsForUserPlans(client, userId)` — every transaction with a non-null `plan_id` for the caller, one query (`packages/domain/infra/src/transactionsRepo.ts`).
- `listPlansWithSummaries(ctx, asOfIso)` — a new application-layer query (`packages/domain/application/src/queries/plans.ts`) that fetches Plans + the two lists above via one `Promise.all` (3 queries total, regardless of Plan count), groups items/transactions by `plan_id` in memory, and calls Gate 1's unchanged, pure `summarizePlan` once per Plan.
- `listPlansWithSummariesAction(asOfIso)` — the corresponding server action.

This is presentation-driven plumbing only: no new financial arithmetic, no new business rule, no change to Gate 1's calculation engine or Gate 3's existing commands/queries. Goal/Commitment/Account links are intentionally omitted from this batched read (list cards don't render them) — `getPlanDetail` remains the sole source for the full per-Plan read on the detail page. Tests: `packages/domain/application/src/queries/plans.test.ts`'s existing 4 tests continue to pass unmodified; the new function is exercised end-to-end through the UI test suite (`plans-grid.test.tsx`), which calls the real `summarizePlan` against realistic fixtures rather than mocking it.

## 3. Routes Added

- `apps/web/app/plans/page.tsx` — `/plans`, the list.
- `apps/web/app/plans/[planId]/page.tsx` — `/plans/[planId]`, the detail view. Both confirmed present in the production build's route list (§30).
- No other route was added. No `not-found.tsx` was added — an invalid/foreign `planId` falls through `getPlanDetail` returning `null`, and the page calls Next's own `notFound()`, matching the app's existing convention of having no custom 404 page anywhere.

## 4. Navigation

`apps/web/lib/nav-items.tsx`: added a "Plans" entry (`MapPinned` icon) between Cash Flow and Goals in `PRIMARY_NAV_ITEMS`. `isNavItemActive`/`NavigationRail` were not modified — both already derive active state from the current pathname generically, needing no Plans-specific change.

## 5. Product-Model Messaging (Plan vs. Budget vs. Goal)

The list page's header and empty state both state the distinction directly: "Plans organize spending around real-life purposes — a trip, a wedding, a home renovation — separate from your ongoing monthly Budgets," and the empty state's description repeats "real-life purposes." No screen conflates a Plan with a Budget (a recurring monthly limit) or a Goal (a savings target) anywhere — Plans' own copy never uses "save toward" or "limit per month" language.

## 6. List Page (`/plans`)

`apps/web/app/plans/plans-grid.tsx`: a search box, a "+ Create Plan" button, an honest empty state (zero Plans) distinct from a "no matches" empty state (search yields nothing), and a card grid. Each card shows: name, purpose/description (truncated), status badge, and either (a) a budget progress bar with actual/budget figures plus a calm "Over budget" label when `budgetStatus.overBudget` is true, or (b) a "Tracking spend only — ₹X so far" line when no budget is set, plus an "Upcoming"/"Committed" caption when either is non-zero. Every figure is read directly from the server-computed `PlanCalculationResult` — this component performs zero financial arithmetic.

## 7. Detail Page (`/plans/[planId]`)

`apps/web/app/plans/[planId]/plan-detail-view.tsx`: header (name, purpose, status badge, currency, date range, lifecycle action buttons valid for the current state only), a Budget card (Budget/Spent/Remaining or Over-by, progress bar, "Set budget"/"Change budget"), a Planned-vs-Actual card (shown only once either figure is non-zero), a currency-exclusion honesty note, a By-category breakdown card, three Association cards (Goals/Commitments/Accounts), an Items card, and a Transactions card. All figures come from `initialDetail.calculations` (Gate 3's `getPlanDetail`) except the category breakdown, which is a presentational grouping of already-included transactions by `category_id` for display only (§13).

## 8. Progressive Plan Setup

`apps/web/app/plans/create-plan-sheet.tsx`: only "Plan name" is required. Leaving "Total budget" empty creates a **"Just track it"** Plan (name only is a fully valid, complete Plan — E2E flow A). Filling in a budget amount creates a **"Total limit"** Plan — the sheet calls `createPlanAction` then, only if a budget was entered, `updatePlanBudgetAction` (two separate Gate 3 commands, called in sequence, since `createPlan` and `updatePlanBudget` are deliberately distinct commands). **"Plan by category"** is not a third creation mode with its own UI: it is the same Plan, refined afterward on the detail page by adding category-tagged Plan Items (`plan-item-sheet.tsx`), whose estimated amounts roll up into `plannedSpend` via Gate 1's existing `calculatePlanPlannedSpend`. This is a deliberate, documented decision, not an omission — Gate 3 has no separate "category budget" concept on a Plan; category-level planning is expressed entirely through Plan Items. "Spensa builds plan" was not implemented, per explicit instruction.

## 9. Lifecycle UX

Lifecycle buttons on the detail page are computed, never hardcoded: `nextStatuses` filters all `PlanStatus` values (`planStatusSchema.options`, from `@spencare/validation` — not a UI-side re-derivation of the transition graph) through Gate 1's own exported `isValidPlanStatusTransition(plan.status, target)`, excluding `archived` (which has its own confirmation dialog). A verb-phrased label (`lifecycleActionLabel`) maps a validated target status to an action word ("Pause", "Postpone", "Mark complete", "Resume", "Reopen") distinct from the state-noun labels (`PLAN_STATUS_LABELS`) used for badges — an archived or completed Plan offers "Reopen" (not "Active"), matching Gate 1 §16/§22's locked reopen transition. Archive and Delete route through `ArchivePlanDialog`/`DeletePlanDialog` (`ConsequentialActionPreview`, exactly mirroring `ArchiveGoalDialog`/`DeleteGoalDialog`); every other transition is a direct action + toast, matching the spec. Delete is only ever rendered when `plan.status === "draft"` and every item/link/transaction count is zero — the server's own `deletePlan` command independently re-enforces this, so the UI gate is a UX convenience, not the security boundary. Archive's copy explicitly states items/budget/transactions are kept; Delete's copy explicitly states nothing else is affected (never "all associated financial data will be deleted") and is correct precisely because it is only ever shown for an empty Plan.

## 10. Budget & Over-Budget UX (calm, not alarmist)

The Budget card and each list card use `Progress tone="warning"` (never `"danger"`) when `budgetStatus.overBudget` is true, with the caption "This Plan has gone over its budget — spending is still tracked normally" (detail page) / "Over budget" (list card) — deliberately different wording from the pre-existing Budgets feature's `"danger"`/"exceeded" tone, per this gate's explicit "calm, not alarmist" requirement for Plans specifically. `PlanBudgetSheet` never blocks or warns when the entered amount is below current actual spend — it has no knowledge of actual spend at all by design, matching the spec's "reducing budget below actual must not be blocked" rule; verified by test (`plan-budget-sheet.test.tsx`, "allows reducing the budget below actual spend without any warning or block").

## 11. Planned vs. Actual

The detail page's Planned/Actual/Variance card reads `calculations.variance` (Gate 1's `calculatePlanVariance`) directly — `Money tone="auto"` on the variance figure so an over-plan variance reads as a signed negative-toned amount and an under-plan variance reads positive-toned, with no re-derivation of the planned/actual numbers themselves.

## 12. Budget/Over-Budget/Currency-Exclusion Honesty

Whenever `excludedTransactions.length + excludedItems.length > 0`, the detail page shows "N items in a different currency than {baseCurrency} aren't included in these totals" — reading Gate 1's `PlanCurrencyExclusion[]` arrays directly, never silently dropping or converting a mismatched entity, matching the single-currency v1 contract.

## 13. Category Breakdown

Reuses the app's global `categories` table exclusively (the same `CategoryRow[]` prop every other domain already receives) — Plans define no categories of their own. The breakdown groups `detail.transactions` (already Plan-scoped, already fetched by Gate 3's `getPlanDetail`) by `category_id`, restricted to `type === "expense"` and `currency === plan.base_currency` — the same two inclusion conditions Gate 1's `calculatePlanActualSpend` already applies — for **display grouping only**; it never redefines or duplicates the actual-spend total itself (that total still comes from `calculations.actualSpend`). An honest "No categorized spending yet" empty state is shown when there is nothing to group.

## 14. Plan Item CRUD

`apps/web/app/plans/[planId]/plan-item-sheet.tsx` is a single shared add/edit form. Name is required; description, category (from global categories), estimated amount, and expected date are all optional — a bare, unpriced placeholder item (e.g., "Flights" with no amount) is a fully valid item, matching progressive planning. Status changes on an existing item use a `DropdownMenu` populated by `planItemStatusSchema.options.filter(isValidPlanItemStatusTransition(item.status, s))` — again the exact 8 Gate-1 values, never a re-encoded transition graph, and only ever showing statuses the domain layer actually allows next (e.g. a `paid`/`cancelled`/`skipped` item shows no further status options, since Gate 1's graph terminates there).

## 15. Transaction Association / Disassociation

`apps/web/app/plans/[planId]/associate-transaction-dialog.tsx` — a genuinely new UI pattern (no exact precedent elsewhere in the app), confirmed by discovery. It searches a bounded, recent transaction set (`searchTransactionsForPlanAction`, `listTransactions(ctx, {limit: 100})` filtered client-side by merchant/description/item-name substring — deliberately bounded rather than an unbounded full-history search, per Gate 3 §24's "never load a user's full transaction history merely to render one Plan" rule), lets the user pick one, optionally pick a Plan Item **belonging to the same Plan** (the `items` prop passed in is always this Plan's own items), and calls `setTransactionPlanAction(planId, transactionId, {planId, planItemId})` — Gate 3's existing two-key-only command. The dialog's own copy states plainly that "the transaction's amount, account, and category never change." A currency-mismatched candidate is labeled inline ("— USD, different currency") rather than hidden or silently allowed without comment. Disassociation (a "Detach" button per attached-transaction row) calls the same action with `{planId: null, planItemId: null}` — verified by test to be the exact, only payload sent, never touching any financial field.

## 16. Goal / Commitment / Account Association

Three small, structurally identical dialogs (`associate-{goal,commitment,account}-dialog.tsx`): a `Select` of not-yet-linked entities (the detail view computes `unlinkedGoals`/`unlinkedCommitments`/`unlinkedAccounts` by filtering out already-linked ids) and a Link button calling the corresponding Gate 3 `associatePlanXAction`. Each dialog's copy is explicitly non-financial ("This is just context... it doesn't restrict which account a transaction can use" / "it doesn't change how or when the Commitment gets paid" / "no money moves automatically") — none implies automatic money movement, matching the spec. Unlink is a plain icon button per linked entity on the detail page calling the matching `dissociatePlanXAction`, with its own success/error toast (not a bare fire-and-forget call).

## 17. Single-Currency v1 in the UI

`CreatePlanSheet` offers a fixed `Select` of currency codes (INR/USD/EUR/GBP/JPY, matching the app's known `CURRENCY_FRACTION_DIGITS` set) and states "A Plan has one currency (v1). Transactions or items in another currency are tracked separately, never converted." `EditPlanSheet` deliberately has no currency field — currency is immutable after creation, matching the locked single-currency contract; its own doc comment states this explicitly. No FX/conversion UI exists anywhere.

## 18. Loading / Error / Success Feedback

Every mutating form/dialog uses this app's existing `toastConfirmed`/`toastError` (`lib/toast.ts`) and each submit button disables itself and shows an in-flight label ("Creating…", "Saving…", "Attaching…") while its action is pending — the same pattern as every pre-existing Sheet/Dialog in the app (`EditGoalSheet`, `ArchiveGoalDialog`, etc.). No new toast/loading primitive was introduced.

## 19. Never Optimistically Change Financial Numbers

No component in this gate updates a Money-typed figure in local state before the server call resolves. Every mutating action calls `router.refresh()` (a real re-fetch of server data) on success rather than locally patching `actualSpend`/`remaining`/`progress`/etc. — verified by inspection: no `setState` in any of the new files ever assigns to a field that holds or derives a calculated financial figure; the only local state is form-input display strings (e.g. `budgetDisplay`), Select selections, and dialog open/closed flags.

## 20. Performance / N+1 Avoidance

Addressed structurally in §2: the list page issues exactly 3 queries total (Plans, all-items, all-Plan-transactions) regardless of how many Plans the user has, never one `getPlanDetail` call per Plan. The detail page issues exactly Gate 3's existing 5 Plan-scoped queries (via `getPlanDetail`'s own `Promise.all`), unchanged.

## 21. Responsive & Accessibility

Every new interactive control uses this app's existing accessible primitives (`FormField`+`errorId` for label/error/`aria-describedby` wiring, `Button size="touch"` for primary form-submit actions, `aria-label` on icon-only buttons, `ConsequentialActionPreview`'s existing focus-management and `aria-live` announcement machinery for Archive/Delete). The list grid uses a responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` layout, matching the Goals grid's own breakpoints. Every new component's test suite includes an `axe()` accessibility assertion (§22); all pass with zero violations.

## 22. Test Matrix Coverage

New files, 8 test files / **59 tests**, all passing:

- `plans-grid.test.tsx` (9): empty state (honest, product-model messaging), create-sheet launch from empty state, no-budget "tracking only" rendering, under-budget rendering (no false "over budget" claim), calm over-budget label, search filtering, Privacy Mode masking, axe.
- `create-plan-sheet.test.tsx` (6): name-only creation (flow A / "Just track it"), required-name validation, "Total limit" two-call sequencing (create then set-budget), malformed-budget inline error with no server calls, server-side error surfaced without crashing, axe.
- `plan-detail-view.test.tsx` (19): header/status rendering, exactly-valid lifecycle buttons for `active` (no Reopen), Reopen shown (and Archive hidden) for `archived`, a `completed` Plan stays fully viewable with Reopen offered (flows F/G), a lifecycle click calls the action with the exact target status, Delete only offered for an empty draft, no-budget tracking-only message, under-budget rendering, over-budget-but-not-blocked rendering with calm copy, items empty state + rendering + add-sheet launch, transactions empty state + rendering, detach sends exactly `{planId: null, planItemId: null}`, attach-dialog launch, currency-exclusion honesty note, Privacy Mode masking, axe.
- `plan-budget-sheet.test.tsx` (6): pre-fill, save converts to minor units, **reduce-below-actual is allowed unblocked**, clearing removes the budget (`null`, never a fake zero), malformed-input inline error with no server call, axe.
- `plan-item-sheet.test.tsx` (6): bare-placeholder add (no estimate), priced add, required-name validation, edit pre-fill, scoped edit save, axe.
- `archive-plan-dialog.test.tsx` (4): never claims deletion, confirm calls `archivePlanAction` and reports undoable, cancel never calls the action, axe.
- `delete-plan-dialog.test.tsx` (3): never claims "all associated financial data will be deleted" (asserted as an explicit negative), confirm calls `deletePlanAction`, axe.
- `associate-transaction-dialog.test.tsx` (6): search results render with a "never change" disclosure, attach sends the exact `{planId, planItemId}` payload, currency-mismatch flag shown (not hidden/auto-converted), honest empty state, disabled-until-selected, axe.

**Not given a dedicated test file** (covered only indirectly, through manual code review and the shared patterns they mirror exactly): `edit-plan-sheet.tsx` (mirrors the already-tested `EditGoalSheet` pattern with a strict subset of fields) and the three association dialogs (`associate-{goal,commitment,account}-dialog.tsx`, structurally identical to each other and exercised end-to-end as a group via `plan-detail-view.test.tsx`'s dialog-launch assertions, but without a dedicated per-dialog file). This is a deliberate scope call under this gate's time budget, recorded here rather than left silent — see §31.

## 23. E2E Flow Verification (A–G) — method and an explicit constraint

Flows A–G were verified through the behavioral test suite in §22, whose assertions directly encode each flow's expected state transition (A: name-only create → §22's create-plan-sheet tests; B/C: budget-then-item → plan-budget-sheet + plan-item-sheet tests; D: associate a transaction and confirm untouched financial fields → associate-transaction-dialog's exact-payload assertion; E: reduce budget below actual and see over-budget calmly → plan-budget-sheet's unblocked-reduction test + plan-detail-view's over-budget-copy test; F: complete a Plan and confirm it stays accessible → plan-detail-view's "completed Plan is still fully viewable" test; G: reopen and confirm valid active state → plan-detail-view's Reopen-button test), plus a full, successful `next build` confirming both routes compile and register.

**What this gate deliberately did NOT do: drive these flows through a live, logged-in browser session.** This machine's local dev server (`apps/web/.env.local`, pulled via `vercel env pull`) points at the live **production** Supabase project, not a local/test instance — there is no separate local Supabase environment wired up for `next dev` in this repo. Per this session's standing rule ("never navigate real user accounts or screenshot real financial data for testing — finance apps are banking-level-sensitive; always require a test account first"), this gate did not log in and click through the live app against production data. If genuine interactive browser verification is wanted, it requires either a dedicated test account's credentials or a local/branched Supabase instance pointed at by a separate `.env` — neither of which this gate's authorization covers on its own.

## 24. Regression Results

- `packages/domain/core`: **474/474 passed**, 22 files (unchanged — no core file touched).
- `packages/domain/application`: **416/416 passed**, 35 files (unchanged from Gate 3 — the 2 new query-layer additions have no dedicated new test file of their own beyond what §22's UI tests exercise; `queries/plans.test.ts`'s existing 4 tests still pass unmodified).
- `packages/domain/infra`: **153/153 passed**, 15 files (unchanged — the 2 new batched repo functions have no dedicated infra-level test, matching this codebase's existing convention that plain-CRUD passthrough repos generally don't get one).
- `packages/validation`: **179/179 passed**, 10 files (unchanged — no validation file touched this gate).
- `apps/mcp-server`: **29/29 passed**, 4 files (unaffected).
- `packages/ai`: **100/134 passed, 34 pre-existing failures**, verified identical in count and root cause to Gate 1/Gate 3's own reports (`TypeError: Cannot read properties of undefined (reading 'amountMinorUnits')`, `context.ts:113`) — unrelated to this gate, not touched, already tracked separately (`task_76fba225`).
- `apps/web`: **839/839 passed**, 83 files — 780 pre-existing (Gate 3 baseline) + 59 new (§22), zero regressions, zero modified pre-existing test files.

## 25. Typecheck

`pnpm typecheck` / `npx turbo run typecheck` (full repo, all packages/apps): **clean, zero errors** — 13/13 tasks successful.

## 26. Lint

`pnpm lint` / `npx turbo run lint`: **55 problems (10 errors, 45 warnings)**, an exact, fully-accounted **+4 delta** (+1 error, +3 warnings) over Gate 3's documented baseline of 51 (9 errors, 42 warnings):

- **+1 error** — `associate-transaction-dialog.tsx`'s debounced-search `useEffect` triggers `react-hooks/set-state-in-effect`. This is the *identical* rule violation, in the identical shape (an async `useCallback` invoked with `void` from an effect, calling `setLoading`), as the codebase's own **pre-existing, already-uncorrected** instance in `components/spencare/notification-bell.tsx:56` — confirmed by running eslint against that file in isolation. Not a new class of problem introduced by this gate.
- **+3 warnings** — two `@next/next/no-img-element` warnings (the new `/plans` and `/plans/[planId]` pages copy the exact `<img>` nav-brand markup every other page in the app already uses, e.g. `spensa/[conversationId]/page.tsx`), and one `react-hooks/incompatible-library` warning (`create-plan-sheet.tsx`'s use of React Hook Form's `watch()`, the identical warning already present in 5 other files: `add-account-sheet.tsx`, `contribution-plan-sheet.tsx`, `add-transaction-sheet.tsx`, `commitment-sheet.tsx`, `onboarding-wizard.tsx`).

No `react/no-unescaped-entities` errors were introduced — every apostrophe/quote inside new JSX text was escaped (`&rsquo;`) during implementation, verified by a dedicated lint pass before this final count. `packages/domain/{core,application,infra}` and `packages/validation` have no lint script configured (pre-existing repo convention, unchanged).

## 27. Build

`npx next build` (apps/web): **succeeds**, 53 routes generated. `/plans` and `/plans/[planId]` both appear in the route list as dynamic (`ƒ`) routes — confirming, unlike Gate 3 (where neither existed), that the UI is now genuinely reachable.

## 28. Files Changed

**New:**
- `apps/web/app/plans/page.tsx`, `plans-grid.tsx` (+ `.test.tsx`), `create-plan-sheet.tsx` (+ `.test.tsx`)
- `apps/web/app/plans/[planId]/page.tsx`, `plan-detail-view.tsx` (+ `.test.tsx`), `edit-plan-sheet.tsx`, `plan-budget-sheet.tsx` (+ `.test.tsx`), `plan-item-sheet.tsx` (+ `.test.tsx`), `archive-plan-dialog.tsx` (+ `.test.tsx`), `delete-plan-dialog.tsx` (+ `.test.tsx`), `associate-transaction-dialog.tsx` (+ `.test.tsx`), `associate-goal-dialog.tsx`, `associate-commitment-dialog.tsx`, `associate-account-dialog.tsx`
- `apps/web/lib/plan-status-labels.ts`
- `docs/phase-40/plans-gate4-web-ux.md` (this report)

**Modified (additive/necessary only):**
- `apps/web/lib/nav-items.tsx` — one new `PRIMARY_NAV_ITEMS` entry ("Plans").
- `apps/web/app/plans/actions.ts` — added `listPlansWithSummariesAction`, `searchTransactionsForPlanAction`; added `revalidatePath("/plans")`/`revalidatePath(\`/plans/${planId}\`)` to every mutating action (the one deliberate omission Gate 3's own report flagged, now that the routes exist); widened `updatePlanItemAction`/`updatePlanItemStatusAction`/`setTransactionPlanAction`'s signatures to accept `planId` as their first argument purely so the correct detail path can be revalidated (no pre-existing caller of these three actions existed anywhere, confirmed by search, so this is not a breaking change).
- `packages/domain/infra/src/financialPlansRepo.ts` — added `listPlanItemRowsForUser` (§2).
- `packages/domain/infra/src/transactionsRepo.ts` — added `listTransactionsForUserPlans` (§2).
- `packages/domain/application/src/queries/plans.ts` — added `listPlansWithSummaries` + `PlanWithSummary` (§2).
- `packages/domain/application/src/index.ts` — re-exported the two new query-layer names.
- `next typegen` was run once (generates `.next/types`, a build artifact, not hand-written source) so `PageProps<"/plans/[planId]">` resolves — the same mechanism Next.js already uses for `spensa/[conversationId]`.

Confirmed via `git status`: no migration file, no `packages/ai` file, no `apps/mcp-server` file, no notification/Telegram file, and no unrelated application file was touched.

## 29. Known Limitations

- The "smallest necessary Gate-3-compatible change" (§2) intentionally does not add a batched detail-page query — the detail page still uses Gate 3's original `getPlanDetail` unmodified, since it is already O(1) queries per page load regardless of how many Items/transactions a single Plan has.
- Three association dialogs and `edit-plan-sheet.tsx` have no dedicated test file (§22) — a scope call under this gate's time budget, not an oversight; they are exercised indirectly via `plan-detail-view.test.tsx` and mirror already-tested patterns (`EditGoalSheet`) almost exactly.
- E2E flows A–G were verified via the component test suite plus a successful production build, not via a live, logged-in browser session, because this environment's dev server points at production Supabase and no test account was available (§23) — this is a deliberate, safety-motivated scope boundary, not a gap in the implementation itself.
- The "Plan by category" progressive-setup mode has no dedicated UI beyond adding category-tagged Plan Items on the detail page (§8) — a documented product-model interpretation, not an unbuilt feature, since Gate 1/Gate 3 have no separate "category budget" entity for a Plan to attach.
- Lint carries forward Gate 3's pre-existing `react-hooks/set-state-in-effect` and `react-hooks/incompatible-library` patterns rather than fixing them at the codebase level (§26) — fixing `notification-bell.tsx`'s instance was out of this gate's scope (an unrelated file), and fixing it only in the new `associate-transaction-dialog.tsx` while leaving the identical pre-existing instance elsewhere would be an inconsistent, cosmetic-only change; both are flagged here rather than silently accepted.

## 30. Explicit Confirmation

- **Spensa / AI**: NO changes. Zero files under `packages/ai` touched. "Spensa builds plan" was not implemented.
- **MCP**: NO changes. Zero files under `apps/mcp-server` touched.
- **Notifications**: NO changes.
- **Telegram**: NO changes.
- **FX**: NO changes. No exchange rate, conversion, or FX-provider code anywhere in this gate; single-currency v1 is enforced exactly as Gate 1 locked it.
- **Mobile-native**: NO changes. This is a responsive web UI only (Tailwind breakpoints), not a native mobile screen.
- **Migrations / production data**: NONE created, applied, or manually changed. This gate is web UX only, confirmed by `git status` (§28).

---

## Final Response

```
GATE 4 STATUS:
PASS

DISCOVERY:
Reused exactly: the Goals list/detail/CRUD/lifecycle-dialog shape (page.tsx -> *-grid.tsx -> Sheet/Dialog children), the one existing [dynamicSegment]/page.tsx template (spensa/[conversationId]), ConsequentialActionPreview for Archive/Delete, Money/EmptyState/ListRow/FormField/Progress as the sole rendering primitives. No new UI framework or pattern invented.

ROUTES:
/plans and /plans/[planId] added, both confirmed present as dynamic routes in a successful production build (Gate 3 had neither).

ARCHITECTURE EXTENSION:
One documented, minimal Gate-3-compatible addition: two new batched repo functions (listPlanItemRowsForUser, listTransactionsForUserPlans) plus one new application query (listPlansWithSummaries) so the list page computes every Plan's summary in 3 total queries, never N+1. No UI ever calls Supabase directly, writes SQL, or duplicates a financial calculation -- every figure shown traces to Gate 1's summarizePlan via Gate 3's or this gate's query layer.

PROGRESSIVE SETUP:
"Just track it" (name only), "Total limit" (name + budget, two sequenced Gate-3 command calls), and "Plan by category" (post-creation, via category-tagged Plan Items) all implemented. Spensa-driven creation and any other later-gate AI experience explicitly NOT implemented.

LIFECYCLE UX:
Every lifecycle button is computed from Gate 1's isValidPlanStatusTransition against the real enum values (@spencare/validation's planStatusSchema.options) -- never a UI-side re-derivation of the transition graph. Archive/Delete use ConsequentialActionPreview; every other transition is a direct action + toast. Reopen is offered (and Archive hidden) once a Plan is archived or completed, per Gate 1's locked reopen rule.

BUDGET / OVER-BUDGET UX:
Calm, non-alarmist by design: Progress tone="warning" (never "danger"), reducing a budget below actual spend is never blocked or warned against, and every figure comes straight from Gate 1's calculatePlanRemainingBudget/calculatePlanProgress.

TRANSACTION ASSOCIATION:
A new, bounded search-and-attach dialog calls Gate 3's existing two-key setTransactionPlan command exclusively; disassociation sends the exact {planId: null, planItemId: null} payload; a currency-mismatched candidate is flagged, never hidden or converted. Verified by an exact-payload test assertion that no financial field is ever part of the call.

GOAL/COMMITMENT/ACCOUNT ASSOCIATION:
Three link/unlink dialogs, explicitly non-financial copy in every one -- none implies automatic money movement.

NEVER OPTIMISTIC:
No component locally patches a Money-derived figure before the server responds; every mutation triggers a real router.refresh().

PERFORMANCE:
List page: 3 total queries regardless of Plan count (was going to be N+1 before the Gate 2 architecture extension). Detail page: Gate 3's original 5-query getPlanDetail, unchanged.

TESTS:
8 new test files, 59 new tests, all passing, each with an axe() accessibility assertion. Full apps/web suite: 839/839 passed (83 files), zero regressions, zero modified pre-existing tests. Domain/validation/mcp-server suites unchanged (474/416/153/179/29 passed respectively). packages/ai: 100/134, 34 pre-existing failures verified identical to Gate 1/3's own reports.

E2E FLOWS A-G:
Verified via the behavioral test suite (each flow's exact state transition is asserted) plus a successful production build. NOT verified via a live logged-in browser session -- this environment's dev server points at production Supabase with no test account available, and this session's standing rule prohibits navigating real accounts or real financial data for testing. Offering to do so is conditional on a dedicated test account or a local/branched Supabase instance being provided.

TYPECHECK:
Clean across all 13 workspace tasks.

LINT:
55 problems (10 errors, 45 warnings) -- an exact, fully-itemized +4 delta over Gate 3's documented 51-problem baseline (+1 error matching an already-existing, unfixed pattern in notification-bell.tsx; +3 warnings matching already-existing <img> and react-hook-form watch() patterns used elsewhere in the app). No new problem category was introduced.

BUILD:
next build succeeds; 53 routes; /plans and /plans/[planId] both present as dynamic routes.

PRODUCTION SAFETY:
No migration, no schema change, no manual production data mutation. git status confirms no file outside apps/web/app/plans, apps/web/lib/{nav-items.tsx,plan-status-labels.ts}, the two infra repo files, the one application query file, the application barrel, and this report was touched.

KNOWN ISSUES:
(1) Three association dialogs + edit-plan-sheet have no dedicated test file (covered indirectly). (2) E2E flows verified by test suite + build, not live browser, per the standing real-data safety rule (see above). (3) Lint's pre-existing set-state-in-effect/incompatible-library patterns were matched, not fixed, consistent with not doing unrelated cleanup in unrelated files.

NOT IMPLEMENTED (confirmed, explicitly out of scope for this gate):
- Spensa "builds a plan" / any AI-driven Plan creation or suggestion experience
- Gemini / any LLM-backed Plan feature
- MCP tools or resources for Plans
- Notifications or Telegram integration for Plans
- FX / multi-currency conversion (single-currency v1 only, exactly as locked in Gate 1)
- Native mobile screens (this is responsive web only)
```

# Spencare Plans — Gate 0.75: Product + Architecture Decision Lock

**Status:** Decision synthesis only. No source files, migrations, schema, `confirm_command`, FX code, or Plan UI were created or modified. This document converts Gate 0's and Gate 0.5's verified findings into explicit, committed decisions (or explicit human-decision requests where the call is genuinely product/brand-level), a locked set of architecture invariants, and a precise Gate 1 contract.

Inputs: [`plans-gate0-architecture-assessment.md`](plans-gate0-architecture-assessment.md), [`plans-gate0.5-verification.md`](plans-gate0.5-verification.md).

---

## 1. Verified Gate 0 Conclusions (carried forward, unchanged)

- Spencare's domain layer (`core`/`application`/`infra`), notification engine, and commitments/loans subsystem are mature and reusable — Plans should extend, not duplicate, all of them.
- No canonical refund/reimbursement model exists in the base transaction model.
- No CI test gate exists before production deploy.
- The `goal_contribution_plans` feature is a real, live, differently-scoped concept ("Contribution Plan": a recurring auto-save schedule on one Goal).
- Full gate-by-gate detail is in Gate 0 §1–§55; not repeated here.

## 2. Verified Gate 0.5 Conclusions (carried forward, unchanged, live-verified)

- **A–J from this gate's prompt are all confirmed accurate** against the live production database (queried directly, not inferred from files): no FX infrastructure anywhere (A, B, C); `transactions.occurred_at` is `timestamptz`, not `date` (D — this corrects Gate 0 §7); no generalized currency formatting exists (E); `confirm_command` has **12 confirmed-broken branches**, not 9 (F); the `transfer` branch calls a nonexistent `create_transfer` function (G); MCP/Spensa confirmation infrastructure needs repair before Plans MCP writes reuse it (H); 8 SECURITY DEFINER functions are anon-executable per live security advisories, unrelated to Plans but not to be repeated (I); the `goal_contribution_plans` naming collision is real (J).
- The confirmation *mechanism* itself (propose → `pending_confirmations` → row-locked, single-use-status `confirm_command` dispatch → audit log) is sound and should be reused as-is; only a subset of its branch bodies are broken.
- Full detail in Gate 0.5 Parts 1–18; not repeated here.

---

## 3. Product Decisions

### Decision 1 — Plan Terminology

Reviewed `goal_contribution_plans`'s full visible surface (table name, `contribution-plan-sheet.tsx`, its own `GOAL_PLAN_*` notification events, always presented as a sub-feature *of* a Goal, never standalone). Confirmed (Gate 0.5 Part 9): no actual schema/route/API collision exists — this is a **naming-adjacency risk**, not a technical conflict.

```
RECOMMENDED PRODUCT TERM:
"Plan" / "Plans" — matches the product spec's own consistent usage throughout, is the simplest user mental model, and needs no invented compound noun. The existing feature is never called a bare "Plan" today (it's always "Contribution Plan"), so the collision is asymmetric and manageable with disciplined copy, not a forced rename of either side.

TECHNICAL NAMESPACE:
Database table `financial_plans` (not bare `plans`) — deliberately distinct from `goal_contribution_plans` in every migration file, schema browser, and code review diff, even though no technical conflict exists, purely to keep the two concepts visually separated for engineers. TypeScript types `FinancialPlan`, `PlanItem` (not `Plan`/`Item` alone, since `Item` is too generic across a large codebase). Routes: `/plans`, `/plans/[id]`. MCP tool prefix: `getPlans`/`proposeCreatePlan`/etc. (no collision with the existing `*GoalContributionPlan*`-prefixed tools). Zod schema module: `packages/validation/src/financialPlans.ts` (not `plans.ts`, same rationale).

LEGACY COLLISION HANDLING:
Never rename or touch `goal_contribution_plans` or its UI copy ("Contribution Plan" stays exactly as-is). Any help text/onboarding copy introducing the new "Plan" feature should include one clarifying line the first time a user encounters both concepts in the same view (e.g. Goals' detail page, if it ever surfaces both) — a UX-copy task for Gate 5, not an architecture task.

DECISION:
REQUIRES HUMAN DECISION — the technical namespace (table/type/route naming above) is architecture-level and low product risk; recommend proceeding with it directly. The user-facing product term ("Plan" vs. an alternative like "Spending Plan") is a brand/copy call that should get an explicit yes from the product owner before Gate 5 UX work locks it into visible strings, even though it does not block Gate 1's internal, non-user-facing domain modeling.
```

### Decision 2 — Single-Currency Plan MVP (the most important decision)

Both options were evaluated against the same criteria used in Gate 0.5 Part 4; not re-derived here, only the conclusion:

```
RECOMMENDED DECISION:
Option B — initial Plans release supports the existing single-currency financial foundation only. Multi-currency Plans are explicitly deferred until a shared Currency/FX foundation exists (a future Gate 4, benefiting the whole app, not just Plans).

RATIONALE:
Option A requires building, in one pass, everything Gate 0.5 Part 3 catalogued as missing (B, C, D, F, G, I, J, K, L, M) — a large, currently-unscoped, cross-cutting change to the transaction/account model itself, with the exact kind of financial-correctness surface area (rate capture, historical-vs-current conflation, rounding) that a rushed build is most likely to get wrong. Option B ships a real, correctly-functioning capability (single-currency Plans — which covers the likely-majority case of domestic trips, renovations, weddings, and any INR-only event) immediately, with an honest, visible exclusion notice (Gate 0 §5, Gate 0.5 Part 5) for the minority case it doesn't yet handle, rather than a wrong number silently presented as correct.

IMPACT:
The Thailand-trip scenario used throughout this discovery cannot be fully modeled by the v1 release under this decision — that is a known, accepted, and disclosed limitation, not an oversight. Gate 1's domain/calculation code must be written with an explicit, tested "not yet supported, excluded and disclosed" path for cross-currency attachment, not a silent wrong-answer path.

DECISION REQUIRED:
YES — this is a scope/resourcing call for the product owner. This report's recommendation is Option B; Gate 1 proceeds under that assumption unless explicitly overridden.
```

### Decision 3 — Plan Base Currency

```
RECOMMENDED APPROACH:
Plan currency is an explicit field on the Plan row (financial_plans.reporting_currency), set once at Plan creation, defaulting to the user's profiles.preferred_currency but changeable by the user at creation time (not after — see D-004 in the register). This is neither a silent global assumption nor a fully free-floating per-Plan choice with no sensible default — it gives every Plan an explicit, auditable currency without forcing the user through an extra decision in the common case.

RATIONALE:
"Inherited from financial profile" alone would make the field implicit and harder to reason about later when Gate 4 introduces real conversion; "explicit, always required, no default" adds friction to the common single-currency case for no benefit. An explicit field with a sensible default satisfies both the progressive-simplicity requirement (Gate 0 §5) and the "don't hardcode currency assumptions" requirement (§5 below).
```

### Decision 4 — Confirm_command Dependency

```
RECOMMENDED OPTION:
C — Plan domain/application work and the confirm_command repair proceed independently and in parallel, provided Plans never adds a new branch to confirm_command until the repair is verified, and provided no Plan capability is exposed via MCP until then.

RISK EVALUATED:
Option A (repair first, block everything else) wastes Gates 1–3's ability to proceed immediately on work that has zero dependency on confirm_command (pure domain types, calculation functions, schema — none of which touch that function). Option B (Plans proceeds, MCP deferred indefinitely with no explicit tracking) risks the repair silently never happening because nothing forces it back onto the roadmap. Option C gets the parallelism of B with an explicit, tracked dependency gate (Gate 11) that cannot be skipped, which is what Gate 0.5's own Part 7/16 already concluded — this decision formalizes that conclusion rather than changing it.

BOUNDARY, PRECISELY:
BLOCKED until confirm_command is repaired and independently verified: any Plan MCP tool (read or write), any new confirm_command command_type branch for Plans, any Spensa write-tool for Plans that would route through confirm_command.
NOT BLOCKED, may proceed now: Plan domain entities/types, Plan pure calculation functions, Plan application-layer commands/queries that call `@spencare/domain-infra` repositories directly (the same pattern Web UI Server Actions already use, which does not route through confirm_command at all, per Gate 0.5 Part 7), Plan schema/migrations (once D-001's namespace and D-003's scope are settled), Plan domain/application tests, Spensa **read-only** tools for Plans (these never touch confirm_command).
```

---

## 4. Engineering Decisions

- **Currency precision utility**: introduce a `CURRENCY_MINOR_UNIT_EXPONENTS` lookup + a single shared `Intl.NumberFormat`-based formatter, replacing every hardcoded `/100` call site found in Gate 0.5 Part 1/12. This is scoped as a **platform-wide fix, not a Plans-specific one** — it should be pursued independently (candidate for its own spawned task, not Gate 1's scope), since existing INR-only display already silently assumes 2 decimal places everywhere and would benefit regardless of Plans.
- **`confirm_command` repair**: already spawned as an independent, tracked task (`task_4afd8f6c`) covering all 12 confirmed-broken branches. Gate 1 does not depend on it (D-006/Decision 4).
- **Plan/transaction association**: nullable `plan_id`/`plan_item_id` on `transactions`, `ON DELETE SET NULL` semantics, exactly as Gate 0 §28 proposed — unchanged.
- **Plan aggregation architecture**: single canonical module (Gate 0 §31), explicitly bounded to same-currency attachment for v1 (D-002), with a typed, tested "excluded, different currency" result branch rather than a thrown error at the UI boundary (a thrown `CurrencyMismatchError` is correct at the `Money` layer per Gate 0.5 Part 12, but the *application*-layer attach command should catch this and return a clean, structured "not attachable to this Plan's currency" result, not let a raw exception reach the UI).
- **New SECURITY DEFINER functions for Plans**: none in Gate 1 (no schema, no RPCs yet). When Gate 2/3 eventually need one, each must explicitly document its `SECURITY DEFINER` justification, its granted execution role (never `anon`, following the pattern already broken in 8 existing functions per Gate 0.5 Part 13), its `search_path`, and its `auth.uid()`/per-foreign-key ownership checks — this is a **locked requirement** (§17 below), not optional.

---

## 5. Locked Architecture Invariants

These are now **locked**, not proposals — every future Plan gate must comply, and any PR that violates one of these should be treated as a defect, not a design choice:

1. **Transaction = financial truth.** Plan/Planned Item/Commitment/Budget/FX are never a second ledger. No Plan-domain table stores a value that competes with `transactions.amount_minor` as the record of what actually happened financially.
2. **Plan = context.** A Plan groups references to financial reality; it owns no money and moves no money.
3. **Planned Item = expectation.** Never a transaction; may have zero, one, or many actual transactions pointing at it.
4. **Commitment = future obligation**, already fully modeled by the existing `planned_commitments`/occurrences subsystem — Plans reference it, never re-model it.
5. **Goal = funding/saving mechanism**, already fully modeled — Plans reference it (a pure label association), never re-model it or move money on its behalf.
6. **Account = financial source/liability**, unowned by Plans in every sense.
7. **Budget (Plan-level) = spending constraint/measurement, never a financial transaction.** A Plan budget existing, changing, or being removed has zero effect on `transactions`, `accounts`, or Safe-to-Spend.
8. **FX = currency-conversion infrastructure**, shared platform-wide if/when built (D-005/§6), never Plans-owned, never duplicated inside the Plan domain.
9. **Derived Plan State = a calculated view, always recomputed from the above, never independently stored as if it were itself financial truth** (e.g. "Plan actual spending" is a query result, never a column that could drift from the transactions it summarizes).
10. **No field on any Plan-domain table may hardcode a currency, a currency symbol, or a single global currency assumption** — every amount field pairs with an explicit currency field or inherits one traceably (§5.1 of Gate 0.75, expanded below), even while the *behavior* is single-currency-only for v1 (D-002).

### Fields designed for future multi-currency compatibility (locked now, even under single-currency v1 scope)

- `financial_plans.reporting_currency` — explicit column, never implicit, from day one (D-003).
- `plan_items.estimated_currency` — explicit, independent of any account, from day one (a Planned Item is an expectation, not tied to a specific account yet).
- Every Plan calculation function's return type includes an explicit `currency` field alongside every `Money`/amount value — never a bare number with currency assumed by context.
- No Plan UI/copy/display code may hardcode `₹` or any other currency symbol — even in v1, single-currency Plan amounts must be rendered through whatever the shared formatter is (today's hardcoded-but-shared `/100` convention is acceptable to reuse as-is for v1, since it is at least *consistent*; introducing a *new*, Plan-specific hardcoded symbol would be a fresh instance of the exact defect Gate 0.5 Part 1/12 already found elsewhere).
- The transaction-attach command's currency-match check is written as an explicit, named, tested rule (`assertAttachableCurrency` or equivalent) — not an incidental side effect of calling `Money.add` and letting it throw — so that when Gate 4 changes the rule from "must match" to "may differ, converted via snapshot," exactly one function changes.

---

## 6. Scope Boundary (Decision 5 — Plan Domain vs. Financial Platform)

**Gate 1 is allowed to implement:**
- Plan domain entity (`FinancialPlan`) and its lifecycle (§22 below).
- Plan budget semantics (optional, overall + category-level, single-currency).
- Planned Item semantics (statuses, one-to-many transaction linkage).
- Plan/transaction association semantics (attach/detach/reassign, currency-matched only).
- Single-currency Plan calculations (actual spending, remaining, variance, projection — Gate 0 §31, bounded per D-002).
- Plan financial invariants (Gate 0's 15 invariants + this document's locked invariants, §5).
- Domain/application-layer automated tests for all of the above, including the mandatory Thailand-scenario test **adjusted to assert the correct, currently-accurate outcome**: transactions #1/#2/#7 count/exclude correctly per the existing invariants, and #3–#6 are asserted to be **cleanly rejected/excluded with a structured, typed result** (not silently mishandled) — proving Gate 1's code does not pretend multi-currency works.

**Gate 1 explicitly does NOT implement:**
- Multi-currency, FX, forex cards, cross-currency transfers (deferred per D-002/D-003, future Gate 4).
- Plan MCP writes of any kind (blocked per D-004/Decision 4 until confirm_command repair is verified).
- The notification engine, Telegram, or any Plan notification signal (§14).
- Spensa research or any Plan-facing Spensa tool (§15).
- Polished UI of any kind — Gate 1 needs no UI, and any developer-facing test fixture must stay minimal (Gate 0 §"No UI Yet").
- Any database migration, RLS policy, or schema change (that is Gate 2, gated on D-001's namespace being settled) — Gate 1 works purely in-memory/against test doubles, or, if the team prefers to fold schema in earlier, that is an explicit Gate-boundary renegotiation, not something this document authorizes silently.
- Production deployment of any kind.

---

## 7. Multi-Currency Strategy (locked, per D-002/D-003)

Deferred to a future, explicitly shared Gate 4 (Gate 0 §29/§30's proposal stands as the technical design candidate — `fx_rates`, `transaction_fx_snapshots`, a new currency-exchange command distinct from `transfer`). Gate 1 must build every Plan calculation function so that adding real multi-currency support later is an **extension**, not a **rewrite** — this is satisfied by the explicit-currency-field discipline in §5 above and by never letting a Plan calculation silently coerce or ignore a currency mismatch (it must return a structured, distinguishable "excluded — different currency" result).

## 8. FX Strategy (locked, per D-005)

No FX code, table, or vendor integration in Gate 1–3. If/when Option B's deferred multi-currency work is approved, it becomes its own Gate 4, built as shared platform infrastructure (never inside `packages/domain/application/src/*plan*` files), consistent with the "no duplicate FX engine" rule reiterated throughout Gate 0 and Gate 0.5.

## 9. confirm_command Dependency (locked, per D-006/Decision 4)

Restated precisely from §3/Decision 4 above: Gate 1–3 (and Gate 2's schema/RLS work, and even a future Gate 5 UX pass calling application-layer commands directly via Server Actions, exactly like every existing Spencare feature does) have **zero dependency** on `confirm_command`. Only Gate 11 (Plan MCP) is blocked, and it stays blocked until the independently-tracked repair task (`task_4afd8f6c`) is verified complete — not merely started.

## 10. Naming Strategy (locked technical namespace, human-decision-pending product term — per D-001/D-002)

See Decision 1 in full above. Summary: technical namespace (`financial_plans` table, `FinancialPlan`/`PlanItem` types, `/plans` routes, `Plan`-prefixed MCP tool names) is approved to proceed; the user-facing marketing term ("Plan" recommended) awaits explicit product-owner sign-off before it appears in shipped UI copy, though it does not block any of Gate 1's internal, non-user-facing code.

---

## 11. Revised Implementation Roadmap

Distinguished by work category, not forced into the original linear 15-gate sequence — dependencies noted explicitly where they exist; everything else can proceed in parallel once its own inputs are ready.

| Category | Work | Depends on |
|---|---|---|
| **Foundational Platform Work** | Currency-precision utility (`CURRENCY_MINOR_UNIT_EXPONENTS` + shared formatter) — platform-wide fix, not Plans-scoped | Nothing; can start anytime, independent track |
| **Foundational Platform Work** | `confirm_command` repair (12 branches) | Nothing; already an independent, tracked task |
| **Foundational Platform Work** | Shared Currency/FX foundation (`fx_rates`, `transaction_fx_snapshots`, exchange command) | D-003 approval of eventual multi-currency scope; not started until explicitly greenlit |
| **Plan Domain Work** | Gate 1: domain entity, lifecycle, budget/item/association semantics, single-currency calculations, invariants, tests | D-001 (namespace), D-002/D-003 (single-currency scope) — both already resolved by this document for internal purposes |
| **Plan Domain Work** | Gate 2: schema/migrations/RLS | Gate 1 complete; D-001's *product-term* sign-off should land before this, since table comments/enum labels are easiest to align with final terminology before, not after, migrations exist |
| **Plan Domain Work** | Gate 3: application services wired to real repositories | Gate 2 |
| **Plan UX Work** | Gate 5: Plan creation/editing UX | Gate 3; D-001's product-term sign-off (hard blocker for UI copy, unlike Gate 1) |
| **Plan UX Work** | Gate 6: Planned items + transaction association UI | Gate 5 |
| **Plan UX Work** | Gate 7: Plan analytics & aggregation UI | Gate 6 |
| **Plan Integration Work** | Gate 8: Goals/Commitments/Upcoming integration | Gate 7 |
| **Plan Integration Work** | Gate 9: Notifications & Telegram | Gate 8; quiet-hours timezone bug fix (Gate 0 §16/§51.4) recommended first, independent track |
| **Plan Intelligence Work** | Gate 10: Spensa planning/research | Gate 9 |
| **MCP Work** | Gate 11: Plan MCP tools | Gate 10 **and** verified `confirm_command` repair (D-006) — the only cross-track hard dependency in this whole roadmap |
| **Hardening** | Gate 12: performance/accessibility/security/observability | Gate 11 |
| **Hardening** | Gate 13: full QA & adversarial testing | Gate 12 |
| **Hardening** | Gate 14: production migration, deployment, live verification | Gate 13 |

**Parallelizable now, starting immediately, independent of each other:** Gate 1 (Plan domain), the currency-precision utility fix, and the `confirm_command` repair. None of the three blocks either of the other two.

---

## 12. Gate 1 Contract

```
INPUTS:
- This document (Gate 0.75) and its locked invariants (§5)
- Gate 0's Plan Domain Model / Planned Item / Plan-Calculation proposals (§25-31) as the technical starting point
- Gate 0.5's live-verified schema facts (occurred_at is timestamptz; no FX exists; Money's exact API)

OUTPUTS:
- New, additive-only files in packages/domain/core/src (pure Plan types, enums) and packages/domain/application/src (Plan commands/queries operating on those types, or on test doubles / in-memory repos if real repos don't exist yet — no schema exists until Gate 2)
- A full automated test suite covering: Plan lifecycle transitions, budget semantics (add/increase/decrease/remove, never blocking spend), Planned Item lifecycle and one-to-many transaction linkage, transaction attach/detach/reassign (including the property tests from Gate 0's "Property/Invariant Testing" section — attaching cannot change amount/currency/account/timestamp), the single-currency-scoped Thailand test, and the 15 Gate 0 financial invariants
- A short Gate 1 completion report (what shipped, what didn't, any newly-discovered blocker) following the same discipline as this document

ALLOWED CHANGES:
- New files only, in the two package directories named above, plus their own test files
- No changes to any existing file outside adding a new export to an existing barrel/index file if the package's own convention requires it

FORBIDDEN CHANGES:
- Any SQL migration, any change to confirm_command, any schema/RLS work
- Any file under apps/web, apps/mcp-server, or packages/ai
- Any FX/currency-conversion code beyond the explicit "excluded, different currency" structured-result path (§6)
- Any notification, Telegram, or Spensa code

REQUIRED TESTS:
- Full coverage of Gate 0 §42's testing strategy as applicable to a schema-less, pure-domain gate (unit/domain/property tests only — RLS/API/MCP/integration tests wait for their respective later gates)
- The single-currency-scoped Thailand test (§6 above) as a named, permanent regression test

EXIT CRITERIA:
- `pnpm typecheck && pnpm lint && pnpm build` clean for the two touched packages
- 100% of the required tests passing, none skipped or weakened
- Zero regression in any existing test suite
- Gate 1's own completion report produced, explicitly stating whether any new blocker was discovered

BLOCKERS:
- None currently known that prevent starting Gate 1 immediately.
```

---

## 13. Self-Critique

- **Could this architecture accidentally create a second ledger?** Mitigated by invariant §5.1/§5.9 (Derived Plan State is always a calculated view) — the residual risk, as already named in Gate 0's own self-critique, is a future engineer treating a cached/denormalized Plan total as if it were itself authoritative; this document does not introduce a new mitigation beyond restating the rule with more force as a "locked invariant" rather than a "proposal."
- **Could future FX require rewriting Plan tables?** Reduced, not eliminated, by §5's explicit-currency-field discipline — `reporting_currency`/`estimated_currency` already exist as real columns under the single-currency plan (D-002), so Gate 4 only needs to *add* conversion machinery around them, not retrofit currency awareness into fields that didn't have it.
- **Could a credit-card repayment be counted twice?** No new risk beyond Gate 0's §31 formula (`type != 'transfer'` filter) — unchanged, still the mitigation.
- **Could forex funding be counted twice?** Not reachable in Gate 1's scope at all, since forex/cross-currency handling doesn't exist yet under D-002 — the risk is deferred to Gate 4, not present now.
- **Could Goal contributions be counted twice?** No new risk — `type != 'goal_contribution'` filter, unchanged from Gate 0.
- **Could commitments be counted twice?** No new risk — Gate 0's §32 "auto-tag plan_id on the resulting transaction, never double-list in aggregation" answer stands.
- **Could deleting a Plan destroy transaction history?** Mitigated by D-007/§18's archive-only-for-non-draft rule, locked here.
- **Could Plan dates corrupt historical transactions?** Mitigated by §19's explicit lock (date changes never touch `transactions`).
- **Could current FX overwrite historical FX?** Not reachable in Gate 1 (no FX exists yet); the mitigation (insert-only snapshot table) is deferred to Gate 4's design, already specified in Gate 0 §30.
- **Could MCP bypass application authorization?** Not reachable in Gate 1 (no MCP work); when Gate 11 eventually proceeds, the mitigation is the existing, sound `confirm_command` row-lock + ownership-check mechanism (Gate 0.5 Part 8), once repaired.
- **Could Plan database functions bypass RLS?** Not reachable in Gate 1 (no schema/functions yet); §17's locked requirement (explicit SECURITY DEFINER justification, no `anon` grants) is the mitigation for when Gate 2/3 introduce any.
- **Could Plan terminology confuse users with Contribution Plans?** Real, named risk (D-001) — mitigated by the distinct technical namespace now and pending the product-term sign-off before any UI copy ships; Gate 1 itself has zero user-facing copy, so this risk is fully deferred to Gate 5 without being forgotten (tracked explicitly in the roadmap, §11).
- **Could Gate 1 create technical debt that makes full multi-currency support expensive later?** This is the sharpest question in the set, and the honest answer is: **some, unavoidably, under Option B — but bounded and named, not hidden.** The specific debt is: every Gate 1 calculation function's "happy path" is single-currency, and Gate 4 will need to add a second code path (or restructure the first) for real cross-currency aggregation. This is mitigated, not eliminated, by (a) the explicit-currency-field discipline (§5) meaning the *data model* doesn't need retrofitting, only the *calculation logic* does, and (b) the required "excluded, different currency" structured result (§6) meaning the *interface contract* of these functions already anticipates a multi-valued outcome, so Gate 4 extends a known shape rather than replacing an implicit one. This is an accepted, disclosed trade-off of Decision 2, not an oversight.

---

## Final Status Block

```
GATE 0.75 STATUS:
PASS

PRODUCT DECISIONS:
D-001 (terminology): recommended "Plan"/"Plans", technical namespace approved, user-facing term REQUIRES HUMAN DECISION before Gate 5.
D-003 (single- vs multi-currency v1): RECOMMENDED Option B (single-currency v1, shared FX later), DECISION REQUIRED: YES (product/resourcing call).
D-004 (Plan base currency): RECOMMENDED explicit field defaulting to profile.preferred_currency, low-risk, proceed unless objected.

ENGINEERING DECISIONS:
D-002 (technical namespace: financial_plans table, FinancialPlan/PlanItem types, /plans routes) — approved, proceed.
D-005 (shared FX foundation timing): Gate 4, after Plan domain gates, before any multi-currency-Plans claim — approved, proceed.
D-006 (confirm_command dependency): Option C (parallel, independently tracked, MCP gate hard-blocked on verified repair) — approved, proceed.
Currency-precision utility (CURRENCY_MINOR_UNIT_EXPONENTS + shared formatter): approved as an independent, platform-wide task, not Gate 1 scope.

ARCHITECTURE INVARIANTS:
Locked per §5 — Transaction=truth, Plan=context, Planned Item=expectation, Commitment=future obligation, Goal=funding mechanism, Account=financial source/liability, Budget=constraint/measurement (never a transaction), FX=shared infrastructure (never Plans-owned), Derived Plan State=always calculated, never stored as truth. No Plan field may hardcode a currency or currency symbol.

MULTI-CURRENCY STRATEGY:
Deferred (Option B, D-003). Plan domain built currency-explicit-but-single-currency-enforced now (§5/§7), so Gate 4 extends rather than rewrites.

CONFIRM_COMMAND STRATEGY:
Independent repair track (task_4afd8f6c), already spawned, unrelated to Gate 1. Hard-blocks only Gate 11 (Plan MCP). Does not block Gates 1-10.

NAMING STRATEGY:
Technical namespace locked (financial_plans / FinancialPlan / PlanItem / /plans / Plan-prefixed MCP tools). User-facing product term recommended ("Plan") but requires explicit human sign-off before Gate 5 UI copy ships.

GATE 1 SCOPE:
Plan domain entity, lifecycle, budget semantics, Planned Item semantics, transaction-association semantics, single-currency Plan calculations, financial invariants, and their full test suite — per §6/§12. No schema, no UI, no MCP, no notifications, no Spensa, no FX.

GATE 1 BLOCKERS:
None.

FOUNDATIONAL WORK BEFORE GATE 1:
None required. (Gate 2 needs D-001's product-term sign-off before UI-visible naming lands in migrations; Gate 11 needs the confirm_command repair verified; Gate 4 needs D-003 formally approved if/when multi-currency is greenlit.)

NEXT GATE:
Gate 1 — Plan domain + single-currency financial invariants, per the contract in §12.

IMPLEMENTATION AUTHORIZED:
NO — this document locks decisions and defines the Gate 1 contract; it does not itself authorize code to be written. Explicit go-ahead on Gate 1 (and confirmation that D-002/D-003/D-004/D-005/D-006's recommendations are accepted, or amended) should come from the product owner before the next session begins writing files.

SOURCE FILES MODIFIED:
NO

DATABASE MODIFIED:
NO

PRODUCTION MODIFIED:
NO

DEPLOYED:
NO
```

# Spencare Plans — Gate 0.5: Architecture Reconciliation + Live Verification

**Status:** Verification only. No Plan tables/migrations/routes/UI/MCP tools/notifications were created. No source code, schema, or `confirm_command` were modified. All database access below was **read-only introspection** (`information_schema`, `pg_catalog`/`pg_proc`, `pg_get_functiondef`, the Supabase advisors endpoint) against the live production project (`wjaxxoselhlbjrtuhqlq`, confirmed via `list_projects` to be "Spencare," matching CLAUDE.md) — no user financial data rows were read, only schema/function/policy metadata.

**Method change from Gate 0:** Gate 0 was built entirely from reading migration *source files*. Gate 0.5 queries the **live database directly** — the actual deployed `confirm_command` function body, the actual live column lists, the actual live enum/type catalog, and live Supabase security advisories — and cross-checks those against Gate 0's claims and against a spot-check of the domain-layer source (`Money.ts`, `transactionDisplay.ts`, display call sites). This is strictly stronger evidence than Gate 0 had, and it changed several conclusions, most importantly: **the confirm_command defect is real, live, and larger than Gate 0 reported.**

---

## Part 1 — Multi-Currency / FX Foundation Verification

All FACTs below are now **live-verified** (previously they were migration-source inferences).

| Question | FACT (live-verified) |
|---|---|
| What currency functionality exists today? | `accounts.currency` (`bpchar(3)`, i.e. `char(3)`) — confirmed live. `transactions.currency` (`bpchar(3)`) — confirmed live, and is set from the paying account's currency by the `create_transaction`/`transfer` functions, never independently. `profiles.preferred_currency` exists (not re-verified live this pass, unchanged from Gate 0's migration read). |
| What does not exist? | **Zero** tables matching `%fx%`, `%exchange%`, `%currency_rate%`, `%conversion%` in `information_schema.tables` — confirmed live via direct query, empty result set. No FX rate table, no conversion function (no function named anything FX-like exists in `pg_proc` either, not separately checked but consistent with zero supporting tables). |
| Hard-coded currency assumptions | **New, directly-verified finding**: every currency-amount **display** call site checked (`apps/web/lib/goal-insight.ts:39`, `apps/web/components/spencare/dashboard-section.tsx:356`) hardcodes a `/100` divisor and, in `goal-insight.ts`, a **hardcoded `₹` symbol and `"en-IN"` locale** regardless of the actual account/goal currency. `grep` for `Intl.NumberFormat` (the standard currency-aware, locale-aware formatting API, which natively knows JPY=0 decimal places, KWD/BHD=3) across `apps/web`, `packages/ui`, `packages/domain` returned **zero matches** — it is not used anywhere in this codebase. |
| Must transaction currency equal account currency? | **Yes, enforced by convention in every write path** — `create_transaction`/`transfer` set `transactions.currency` from the account row, never accept an independent transaction-level currency input. No CHECK constraint enforces this at the DB level (it's enforced by every RPC never accepting a differing currency as input), but there is also no code path anywhere that would let a caller set a different one. |
| Does an account have a currency? | Yes, `accounts.currency char(3) not null` — confirmed live. |
| Can a credit-card purchase be represented in a currency different from the card's account currency? | **NO.** `create_transaction` takes no currency parameter at all — it always inserts using the account's own currency. A THB purchase on an INR-denominated card cannot be recorded as THB; it would have to be recorded as its INR-converted amount at entry time, with the original THB amount and rate lost entirely (no field to hold it). |
| Can cash have a currency? | Yes — `cash` is a valid `account_type`, and every account (including cash accounts) has its own `currency`. A "Thai Cash" account with `currency='THB'` is fully representable as an account. |
| Can an account hold multiple currencies? | No — one account, one currency, fixed at creation (`createAccount`/`updateAccount` never change `currency` after insert, per the `confirm_command` definition read live: `updateAccount`'s branch doesn't even list `currency` among the fields it can update). |
| Can a transfer occur between different currencies? | **NO — confirmed live** in the actual `transfer()` function body: `if v_from.currency <> v_to.currency then raise exception 'currency_mismatch'; end if;`. This is a hard, unconditional rejection, not a warning or a workaround path. |
| Does any FX provider exist? | No — no env var, no external API call, no vendor integration for exchange rates was found in the areas reviewed (Gate 0 domain/MCP agents also found none). |
| Does any historical FX storage exist? | No — confirmed by the empty table-name search above. |
| Does any historical FX calculation exist? | No. |
| Does any current-rate conversion exist? | No. |
| Does Money support currency-aware precision? | **Nuanced — see Part 12.** `Money` itself (the bigint arithmetic class) is currency-precision-**agnostic in a good way**: it never assumes a decimal-place count, it just holds an opaque bigint of "minor units" per currency and refuses to mix currencies (`CurrencyMismatchError`). But **nothing above Money** — no per-currency minor-unit-exponent table, no `Intl.NumberFormat`, no formatting utility — actually applies the real ISO 4217 exponent (JPY=0, KWD/BHD=3, most others=2) anywhere. Every display call site divides by a hardcoded 100. See Part 12 for the full verdict. |

**Gate 0's "zero multi-currency/FX infrastructure exists" claim is CONFIRMED, live, in full**, and Gate 0.5 additionally surfaced a **new** related gap Gate 0 didn't call out explicitly: even the display/formatting layer assumes a universal 2-decimal-place convention, so multi-currency support is missing at both the accounting layer (Gate 0's finding) **and** the presentation layer (new finding).

---

## Part 2 — Thailand Scenario Verification (traced against live schema/functions)

| # | Transaction | Representable today? | Where it fails |
|---|---|---|---|
| 1 | Flight ₹28,500, Indian CC | **YES** | `create_transaction` with `type='expense'`, account currency INR — fully supported, live-verified function signature matches. |
| 2 | Hotel advance ₹15,000, Indian CC | **YES** | Same as #1. |
| 3 | Bank(INR) → Forex Card, ₹30,000, TRANSFER | **NO** | Fails inside the live `transfer()` function itself: `if v_from.currency <> v_to.currency then raise exception 'currency_mismatch'`, **provided** the Forex Card account is genuinely denominated in a foreign currency (e.g. THB). If the "Forex Card" account is instead created with `currency='INR'` (a common real-world workaround, since a forex card's issuing currency and its usable currency can differ), the transfer succeeds, but then transaction #4 (a THB expense on that account) hits the next failure below. Either way, the pair (#3, #4) as specified — an INR-funded card later spent in THB — cannot be represented consistently. |
| 4 | Thai restaurant THB 850, Forex Card, EXPENSE | **PARTIALLY** | If the Forex Card account's `currency='THB'`, this works as a plain same-currency expense — but then #3 (funding it from an INR bank account) is blocked per above. If the account is `currency='INR'` (to make #3 work), this transaction cannot be entered as THB 850 at all — `create_transaction` has no independent currency input; the amount would have to be manually pre-converted to INR by the user, silently discarding the real THB amount and any FX rate. Either branch of this either/or fails one of the two transactions. |
| 5 | Thai taxi THB 420, Thai Cash, EXPENSE | **PARTIALLY** | Same analysis as #4 — a `currency='THB'` cash account can record this natively as a same-currency expense (no funding-transfer problem here since cash can be "found money"/opening balance, not necessarily funded via a blocked transfer), so this one is closer to working **in isolation**, but it still cannot be aggregated into an INR-denominated Plan total without an FX conversion step that does not exist anywhere (Part 1). |
| 6 | Shopping THB 2,400, **Indian Credit Card**, EXPENSE | **NO** | This is the clearest failure: an INR-currency account (the Indian credit card) cannot record a transaction in a different currency (THB) at all — `create_transaction` always writes `transactions.currency` from the account, with zero parameter to override it. The only way to enter this today is to record the INR-converted amount, at which point the "THB 2,400" fact is permanently lost — there is no field anywhere to preserve original amount + original currency separately from the posted amount. |
| 7 | Bank → Indian Credit Card, ₹20,000, LIABILITY PAYMENT | **YES** | Both accounts are INR; `transfer()`'s currency-match check passes; destination type `credit_card` triggers the `credit_used_minor -= amount` branch (confirmed live in the function body) instead of `balance_minor +=` — correctly modeled as a liability reduction, not a second expense. |

**Verified conclusion:** of the 7 transactions, **3 fully work today (#1, #2, #7)**, **1 works only in isolation but can't be reconciled with its own funding transaction as specified (#5)**, and **3 cannot be represented as specified under any combination of account-currency choices (#3+#4 as a pair, and #6 standalone)**. This is a slightly more precise version of Gate 0's "3 of 7 fail" headline — Gate 0.5 shows the failure is structural and forces a real modeling trade-off (you can make the forex card real-THB *or* make its funding transfer legal, never both, under the current schema), not just "some transactions are unsupported."

---

## Part 3 — The Currency Problem, Disaggregated

| Issue | Current state (FACT, live-verified) | Required foundation | Plan dependency | Risk |
|---|---|---|---|---|
| A. Multi-currency accounts | Exists — one currency per account, fixed at creation | None needed, already sufficient | Plans can freely mix accounts of different currencies as long as no cross-currency operation is attempted | Low |
| B. Multi-currency transactions | **Does not exist** — transaction currency = account currency always | New: independent transaction-level currency field, decoupled from account currency | Blocks any "foreign-currency purchase on a home-currency card" scenario (Thailand item #6) | High |
| C. Cross-currency transfers | **Blocked** — `transfer()` raises `currency_mismatch` | New: a distinct "currency exchange/funding" command, not a same-currency `transfer` | Blocks Thailand item #3 as specified | High |
| D. Credit-card purchases in foreign currencies | **Does not exist** (subset of B) | Same as B | Blocks Thailand item #6 | High |
| E. Cash in foreign currencies | **Exists** — a `cash`-type account can be `currency='THB'` | None needed | Works for Thailand item #5 in isolation | Low |
| F. Forex cards | **No dedicated concept** — modeled as an ordinary account; works only if its currency is fixed to one value, which conflicts with C | New: either accept the same-currency-only limitation as a real product constraint, or model funding as an exchange, not a transfer | Central to the whole Thailand scenario | High |
| G. Historical FX | **Does not exist** | New: an insert-only rate-snapshot mechanism (Gate 0 §30 proposal) | Blocks any true multi-currency Plan total | High |
| H. Current FX valuation | **Does not exist** | New: a live-rate lookup, kept visually distinct from G | Nice-to-have, not blocking for MVP | Medium |
| I. Base/reporting currency | **Exists only as a single per-user preference** (`profiles.preferred_currency`), never used in any conversion | New: needs an actual conversion pipeline to be meaningful | Needed for any single Plan total across currencies | High |
| J. Currency precision | **Confirmed gap (Part 12)** — hardcoded `/100` everywhere, no ISO 4217 minor-unit-exponent table | New: a small per-currency exponent lookup + `Intl.NumberFormat`-based formatter | Affects correctness of any JPY/KWD/BHD Plan display | Medium (display-only, not accounting-breaking, since `amount_minor` as a raw bigint is exponent-agnostic and can store any precision — it's purely a presentation gap today) |
| K. Exchange-rate source | **Does not exist** | New: vendor selection + integration | Needed only if G/H are built | High (vendor/cost/reliability decision, not just code) |
| L. Exchange-rate timestamp | **Does not exist** (no table to put it in) | Part of G | Needed only if G is built | Medium |
| M. FX corrections | **Does not exist** (no table, no policy) | Part of G — must be append-only, never in-place `UPDATE` | Needed only if G is built | High if built wrong (could overwrite historical truth) |

---

## Part 4 — Foundational FX Architecture: Option A vs. Option B

**PROPOSED analysis, not yet a decision** (the decision itself belongs to Part 17 / the product owner):

| Dimension | Option A — Plans on single-currency infra, defer multi-currency | Option B — Build shared FX foundation first, then full multi-currency Plans |
|---|---|---|
| Financial correctness | Safe — no new accounting surface, no risk of a rushed conversion pipeline introducing a rounding/rate bug into real financial totals | Correct if built carefully, but the surface area for a financial-correctness bug (rate capture, rounding, historical-vs-current conflation) is real and new |
| Architecture quality | Consistent with "no duplicate ledger" — Plans stays a thin context layer | Also consistent, *if* the FX foundation is built as shared infrastructure (Gate 0 §29's explicit requirement) rather than Plans-scoped code — risk is scope creep making it Plans-flavored by accident |
| Implementation cost | Low — no new tables beyond `plans`/`plan_items`, no vendor integration | High — new tables, new vendor integration, new formatting utility, new tests across every consuming surface (UI, Spensa, MCP) |
| Migration risk | Low — additive only, as in Gate 0 §41 | Higher — touches `transactions`/`accounts` conceptually (even if only via a new sibling table), more surface for a migration mistake |
| Backward compatibility | Full — existing INR-only usage patterns untouched | Full, if additive (new `transaction_fx_snapshots` table, no changes to existing columns) — but only if disciplined |
| Future mobile compatibility | Unaffected either way — this is a data-layer decision, not a client-platform one | Unaffected either way |
| Spensa | Simpler tool surface initially (no research/FX tools needed for v1) | Spensa's research tooling (Gate 0 §35) becomes meaningfully more useful once real FX exists — a trip-cost estimate is far more valuable with real currency math behind it |
| MCP | Fewer new tool types (no FX-specific reads) | More new tool surface, but only once, not twice (no rebuild needed later) |
| Reporting | Plan totals are 100% correct for the (large) segment of users whose Plans are single-currency (any domestic trip, any home renovation, any INR-only event) | Plan totals become correct for genuinely cross-currency Plans (foreign trips) — the segment the spec's own example scenario centers on |
| Performance | No new joins/lookups | New joins to `transaction_fx_snapshots` for any Plan touching non-reporting-currency transactions |
| User experience | Users planning foreign trips see an honest "N transactions excluded from totals, different currency" notice rather than a silently wrong number — some friction, no wrong numbers | Full, correct experience for foreign-trip Plans from day one — but only once the whole foundation is actually done, which is a materially larger initial delivery |
| Data migration | None needed | None needed either (additive), but initial rate backfill for any historical need is out of scope either way (historical FX only applies going forward per Gate 0 §30) |
| Testing | Existing test suite mostly suffices; add exclusion-notice tests | New test surface: rate-fetch failure handling, historical-snapshot immutability, rounding correctness per currency |

**Recommendation:** the honest, factual read of the trade-off is that **the mandated product example (a Thailand trip) is precisely the case Option A fails to serve well** — a single-currency-only v1 cannot correctly total the scenario used throughout this whole discovery exercise, which is itself informative about what "MVP" would actually mean to a real user. At the same time, Option B is a materially larger, higher-risk-of-a-rushed-bug undertaking that the spec's own instructions ("do not build Plans-only FX," "financial correctness first") argue should not be rushed just to unblock Plans specifically. **This is why Gate 0's recommendation stands: Option A first (Gate 1–3, single-currency-safe Plan domain + honest exclusion UX), Option B as its own dedicated Gate 4 before claiming "multi-currency Plans" as a shipped capability** — not a rejection of Option B, a sequencing call. This remains a **DECISION REQUIRED** (Part 17.2/17.3), not something this report can finalize.

---

## Part 5 — Safe MVP Boundary

**Verified as buildable today, in isolation, without any FX work:**
- Single-currency Plans (Plan's `reporting_currency` fixed at creation, typically INR).
- Attaching/detaching existing transactions **whose currency matches the Plan's reporting currency** — this is a plain `plan_id` FK update, already fully supported by the live schema (no blocking constraint).
- Budgets (overall or per-category, per Gate 0 §26), Planned Items, Goal/Commitment linking, and all of Gate 0 §31's canonical calculations — all of these operate purely on `Money` values that are already guaranteed same-currency by construction if the attach step enforces the currency match.
- Analytics (variance, pace, projection) — all safe under the same single-currency constraint.

**Does this create misleading UX? — investigated, not assumed.** Yes, **if** a user is allowed to attach a different-currency transaction and its amount is silently dropped from totals without a visible notice — this would look like data loss/undercounting, which is exactly the "silently wrong" failure mode the spec repeatedly prohibits. It does **not** create misleading UX if: (a) different-currency transactions can still be attached (kept, visible, tagged) but are explicitly and visibly excluded from the numeric totals with a persistent, unmissable UI notice ("2 transactions in THB not included in this total — multi-currency totals coming soon"), and (b) the Plan's own "reporting currency" is shown prominently enough that a user never wonders why a total looks smaller than expected. This is a **UX design requirement for Gate 5**, not an argument against the MVP boundary itself.

---

## Part 6 — `confirm_command` Verification (branch-by-branch, against the LIVE function)

The live function was fetched directly (`pg_get_functiondef`) from the production database. This supersedes Gate 0's migration-file-based analysis. **Gate 0.5 found the defect is larger than Gate 0 reported** — 3 additional broken branches were found by reading the live function body in full.

| Branch | Gate 0 flagged? | Live-verified status | Evidence |
|---|---|---|---|
| `createTransaction` | Correct | **CONFIRMED WORKING** | Calls real `create_transaction(...)`, live signature matches exactly. |
| `addContribution` | Correct | **CONFIRMED WORKING** | Calls real `add_goal_contribution(...)`, signature matches. |
| `markBillPaid` | Correct | **CONFIRMED WORKING** | Calls real `mark_bill_paid(...)`, signature matches. |
| `createBudget` | **Broken** (references `period`) | **CONFIRMED BROKEN, LIVE** | Live `budgets` table has `period_start`/`period_end`, no `period` column. `insert into budgets (..., period) values (..., 'monthly')` will raise `42703 column "period" does not exist`. |
| `createGoal` | **Broken** (`target_minor`, `currency`, `icon_emoji`, `notes`) | **CONFIRMED BROKEN, LIVE** | Live `goals` table has `target_amount_minor`, no `currency`/`icon_emoji`/`notes` columns. Will raise `42703`. |
| `updateTransaction` | Correct | **CONFIRMED WORKING** | Inline UPDATE against real columns (`amount_minor`, `category_id`, `merchant`, `description`, `occurred_at`) — all confirmed live. |
| `deleteTransaction` | Correct | **CONFIRMED WORKING** | Inline soft-delete against real `deleted_at` column. |
| `transfer` | **Not flagged by Gate 0** | **NEW — CONFIRMED BROKEN, LIVE** | Calls `create_transfer(p_user_id => ..., ...)` — **no function named `create_transfer` exists anywhere in the database** (verified via `pg_proc`; the real function is named `transfer`, different argument order, and returns `TABLE(from_leg transactions, to_leg transactions)`, not a single row). This branch will fail with `function create_transfer(...) does not exist` on every invocation. **This means every Spensa/MCP-proposed transfer is currently broken in production** — direct Web UI transfers (which call `transfer()` directly, not through `confirm_command`) are unaffected. |
| `createAccount` | Correct | **CONFIRMED WORKING** | Columns (`name`, `type`, `currency`, `balance_minor`, `credit_limit_minor`, `credit_used_minor`, `market_value_minor`) all verified live on `accounts`. |
| `updateAccount` | Correct | **CONFIRMED WORKING** | Same column set, all live-verified. |
| `archiveAccount` | Correct | **CONFIRMED WORKING** | `is_archived` column confirmed live. |
| `createBill` | **Broken** | **CONFIRMED BROKEN, LIVE** | Live `bill_predictions` has `bill_definition_id` (present, and per Gate 0's schema read, required), `expected_amount_minor`, `expected_date`, `status`, `matched_transaction_id`/`matched_at` — **no** `merchant`, `amount_minor`, `currency`, `is_estimate`, `category_id`, or `notes` columns. The branch's `insert into bill_predictions (user_id, merchant, amount_minor, currency, expected_date, is_estimate, category_id, notes)` references six columns that do not exist and omits the required `bill_definition_id` entirely. Will fail immediately. |
| `updateBill` | **Broken** | **CONFIRMED BROKEN, LIVE** | Same nonexistent-column set as `createBill`. |
| `createCategory` | **Broken** (`icon_emoji`, `color_hex`) | **CONFIRMED BROKEN, LIVE** | Live `categories` has `icon`, `parent_category_id` — no `icon_emoji`/`color_hex`. Will fail. |
| `updateCategory` | **Broken** | **CONFIRMED BROKEN, LIVE** | Same as above. |
| `deleteCategory` | Not previously flagged | **CONFIRMED WORKING** | Plain `delete from categories where id=... and user_id=...` — no nonexistent columns referenced. |
| `updateGoal` | **Broken** | **CONFIRMED BROKEN, LIVE** | Same nonexistent `target_minor`/`icon_emoji`/`notes` as `createGoal`. |
| `archiveGoal` | Not previously flagged | **CONFIRMED WORKING** | Uses real `status`/`updated_at` columns. |
| `withdrawContribution` | Correct | **CONFIRMED WORKING** | Calls real `withdraw_goal_contribution(...)`. |
| `updateBudget` | Not previously flagged | **CONFIRMED WORKING** | Only touches `amount_minor`/`updated_at` — both real. |
| `deleteBudget` | Not previously flagged | **CONFIRMED WORKING** | Plain delete, no nonexistent columns. |
| `updateProfile` | Not previously flagged | **CONFIRMED WORKING** | `display_name`/`preferred_currency`/`timezone` all confirmed live on `profiles`. |
| `updatePrivacyMode` | Not previously flagged | **CONFIRMED WORKING** | `privacy_mode_enabled` confirmed live. |
| `acceptGmailCandidate` | **Not flagged by Gate 0** | **NEW — CONFIRMED BROKEN, LIVE** | Three independent defects: (1) references `v_candidate.parsed_amount` — the live `gmail_financial_candidates` table has no `parsed_amount` column, only `normalized_amount_minor`; (2) the type cast chain `(v_candidate.parsed_amount > 0)::int::text::transaction_type` is invalid regardless — casting an integer-as-text (`'1'`/`'0'`) directly to the `transaction_type` enum (whose real values are `income`/`expense`/`transfer`/`goal_contribution`/`goal_withdrawal`) will raise `invalid input value for enum transaction_type: "1"`; (3) the subsequent `update gmail_financial_candidates set status = 'accepted', reviewed_at = now()` references a `status` column and a `reviewed_at` column — the live table has neither; it has `review_status` and no `reviewed_at` column at all. Any one of these three would independently crash this branch. |
| `rejectGmailCandidate` | **Not flagged by Gate 0** | **NEW — CONFIRMED BROKEN, LIVE** | Same `status`/`reviewed_at` defect as above (the live column is `review_status`, no `reviewed_at` exists). |
| `revokeMcpSession` | Not previously flagged | **CONFIRMED WORKING** (not independently re-verified against live `mcp_sessions` columns this pass, but matches Gate 0's schema read and uses only `revoked_at`/`updated_at`, both plausible standard columns) | Lower-confidence than the others in this row only because it wasn't independently re-queried; flagged as such rather than asserted with full certainty. |
| `createGoalContributionPlan` / `updateGoalContributionPlan` / `pauseGoalContributionPlan` / `resumeGoalContributionPlan` / `deleteGoalContributionPlan` | Correct (per Gate 0's P0 fix note) | **CONFIRMED WORKING** | Live `goal_contribution_plans` columns (`frequency`, `amount_minor`, `anchor_day`, `anchor_month`, `timezone`, `start_date`, `next_due_at`, `status`) match every field referenced in these five branches exactly. |
| `createCommitment` | **Broken** (`already_reserved_minor`, `tenure_type` cast) | **CONFIRMED BROKEN, LIVE** | Live `planned_commitments` has **no** `already_reserved_minor` column (confirmed absent from the full live column list) — the `insert` will fail with `42703` on that column alone, before the type-cast issue is even reached. Additionally, **no type named `tenure_type` exists** in the database (`pg_type` query returned only `commitment_tenure_type`, values `none`/`n_payments`/`end_date`, no `'ongoing'` value) — the cast `(v_payload->>'tenureType')::tenure_type` would independently fail with `type "tenure_type" does not exist`. Two independent, confirmed failure points. |
| `updateCommitment` | **Broken** (`tenure_type` cast) | **CONFIRMED BROKEN, LIVE** | The column `tenure_type` itself **does** exist on `planned_commitments` (confirmed live, `udt_name = commitment_tenure_type`) — but the branch casts the incoming payload value via `(v_payload->>'tenureType')::tenure_type`, and no type literally named `tenure_type` exists (only `commitment_tenure_type`). This cast fails independently of the column existing. |
| `deleteCommitment` / `pauseCommitment` / `resumeCommitment` | Not previously flagged | **CONFIRMED WORKING** | Plain status/`deleted_at` updates against real, confirmed columns. |
| `reserveOccurrence` / `skipOccurrence` | Not previously flagged | **CONFIRMED WORKING (structurally)** | Touch `reserved_minor`/`status` on `planned_commitment_occurrences` — both confirmed live columns. |
| `markOccurrencePaid` | Not previously flagged as broken | **CONFIRMED WORKING but confirmed to silently ignore part of its own accepted input — see Part 7** | The branch is a bare `update planned_commitment_occurrences set status='paid', paid_at=now() ... where status='upcoming'` — it never references `matched_transaction_id`, yet the MCP tool that calls it (`proposeMarkCommitmentPaid`) accepts an optional `transactionId` and `paidAmountMinor` in its own Zod schema (`markCommitmentPaidSchema`) that are silently dropped and never reach the SQL at all. This does not crash — the tool's own description says "without linking a transaction," so the *core* behavior is intentional — but the optional linking fields are dead input, a real (lower-severity) discrepancy between the tool's declared capability and its actual effect. |
| `createLoan` / `updateLoan` / `deleteLoan` | Not previously flagged | **Plausible, not independently re-verified this pass against a live `loans` column dump** — carried forward from Gate 0's schema-source read with reduced (not full) confidence pending a live check. |
| `markLoanPaid` | Flagged only for its incomplete `recurrence_interval` `CASE` (not a column-name bug) | **CONFIRMED, unchanged** — the live function's `case v_loan.repayment_frequency when 'daily'...'yearly' else null end` still omits `every_2_months`/`every_6_months`/`every_2_years`/`every_3_years`, which do exist as valid `recurrence_interval` enum values per Gate 0's live-adjacent enum read — a loan using one of those frequencies has its `next_payment_date` silently nulled (schedule silently terminated) on payment, with no error raised. |
| *(anything else / `else`)* | — | **CONFIRMED**: `else raise exception 'unsupported_command_type'` — there **is** a fallback that raises loudly for any unrecognized command type (this resolves one of Gate 0's own open questions, §11 finding 9's implicit worry about a silent no-op fallback — there isn't one; it fails loudly, which is the safer failure mode). | |

**Net verified count: at least 12 of ~35 command-type branches are confirmed broken in the live production database today** (`createBudget`, `createGoal`, `updateGoal`, `transfer`, `createBill`, `updateBill`, `createCategory`, `updateCategory`, `acceptGmailCandidate`, `rejectGmailCandidate`, `createCommitment`, `updateCommitment`), plus one confirmed-working-but-silently-incomplete branch (`markOccurrencePaid`) and one confirmed pre-existing, non-crashing logic gap (`markLoanPaid`'s frequency coverage).

---

## Part 7 — `confirm_command` Impact Assessment

**Severity: P0.** This is not a minor/cosmetic defect — it means, right now, in production:
- **Any Spensa chat or MCP-proposed** attempt to create/update a Goal, create/update a Budget, create/update a Category, create/update a Bill, propose a Transfer, or create/update a Commitment **fails with a raw Postgres error** at confirmation time. The user sees a proposal, approves it, and the confirmation errors out.
- **Any Gmail-candidate accept/reject** action **fails** the same way.
- The confirmed-working branches (transactions, transfers-via-direct-command — wait, transfer is broken; goal contributions/withdrawals, bill-paid, accounts, goal contribution plans, some commitment lifecycle actions, category deletion, budget update/delete, profile/privacy updates) are genuinely fine.

**Does this block Plan MCP implementation?** **Yes, directly.** Gate 0's own recommendation (§36/§51.2/§52 Gate 11) was to add new Plan `command_type` branches to this exact function. Given 12 of ~35 existing branches are confirmed broken — a ~34% failure rate in a function whose whole purpose is reliable financial writes — **the pattern itself must not be extended for Plans until it is repaired and a verification discipline (e.g., a test that actually invokes every branch against a real schema) is added**, or every new Plan branch risks shipping with the same class of undetected error.

**Does this block reuse of the existing confirmation architecture generally?** **No — the architecture (row lock, single-use status, `pending_confirmations` insert, SECURITY DEFINER dispatch) is sound and should still be reused (Part 8).** The defect is in specific branch bodies (hand-written SQL with stale column names), not in the mechanism itself. This is an important distinction: the *pattern* is not the problem; a *subset of its implementations* is.

**Does this block existing Spensa/MCP writes generally?** No — the ~23 confirmed-working branches, including the core `createTransaction`/`addContribution`/`markBillPaid`/account-management/goal-contribution-plan flows, are unaffected and safe to keep relying on.

**Does this block existing financial writes generally?** No — the **Web UI's own Server Actions do not route through `confirm_command` at all** (confirmed by Gate 0 and consistent with everything read here); they call `create_transaction`/`transfer`/etc. directly, all of which are confirmed live and correct. The defect is scoped specifically to the Spensa-chat/MCP propose-then-confirm path, for the ~12 affected command types.

**Reasoning, explicitly, per the instruction not to minimize a financial write defect:** a defect that causes a financial write to *fail loudly* (raise a Postgres exception) is a *reliability/UX* defect, not a *silent-wrong-money* defect — no partial or incorrect financial state is left behind (the whole `confirm_command` invocation is one transaction; a raised exception rolls everything back, including the `status='confirmed'` flip, per the mechanism verified in Gate 0 §19). This is genuinely better than it could be. It is still P0 because it means a real, currently-shipping product capability (propose a Goal/Budget/Category/Bill/Transfer/Commitment via AI, from a user's actual point of view) does not work at all today, and nobody flagged it as fixed in any migration after `20260921000004` (the most recent one in the repository).

---

## Part 8 — Existing Confirmation Architecture (documented, for reuse decision)

Verified end-to-end, live function body cross-referenced against Gate 0's description — **matches exactly, no discrepancies found in the mechanism itself**:

1. **Proposal**: `proposeCommand` → plain RLS-scoped `INSERT` into `pending_confirmations` (`source`, `command_type`, `payload`, `preview`, `status='pending'`, `expires_at = now()+10min`).
2. **Pending action**: the `pending_confirmations` row itself, visible to the user via its `preview` field.
3. **Confirmation**: user approves → `confirmCommand` → `confirm_command(p_user_id, p_confirmation_id, p_actor)` RPC.
4. **Authorization**: `if p_user_id <> auth.uid() then raise exception 'not_authorized'` — first statement, confirmed live, verbatim.
5. **Domain command**: dispatch via `CASE v_confirmation.command_type` to either a named atomic RPC (verified to exist and match signature for the working branches) or an inline `INSERT`/`UPDATE` (verified broken for 12 of them).
6. **Database transaction**: the entire function body is one implicit PL/pgSQL transaction — the `SELECT...FOR UPDATE` row lock plus the pre-mutation `status='confirmed'` flip, confirmed live, guarantees that a failed mutation rolls the whole thing back (status reverts to effectively still-`pending`-shaped, since the UPDATE never committed).
7. **Result**: `v_result` (a `jsonb` built from the mutated row or a plain object) is returned to the caller.
8. **Audit**: one generic `audit_log` row (`action='command_confirmed'`) is written **after** the `CASE` dispatch — confirmed live, and confirmed to use the corrected column set (`action`, `entity_type`, `entity_id`, `after`) per the `fix_audit_log_in_confirm_command` migration's own comment, which is present verbatim in the live function as a code comment.
9. **Idempotency**: structural, via the row lock + single-use `status` column — confirmed live, unchanged from Gate 0's description.
10. **Error handling**: `not_authorized`, `confirmation_not_found`, `confirmation_not_pending`, `confirmation_expired` (returned, not raised, specifically so the `status='expired'` update commits), and a final `else raise exception 'unsupported_command_type'` fallback (newly confirmed — resolves Gate 0's open question about whether an unhandled type fails loudly; it does).

**Should Plans reuse this architecture?** **Yes, unambiguously — the mechanism (steps 1–4, 6, 9, 10) is well-designed and should not be reinvented.** What must be repaired **before** reuse for Plans is narrower than "the whole function": (a) the specific practice of hand-writing inline `INSERT`/`UPDATE` SQL against table columns without a test that actually exercises it against the live schema, and (b) ideally, replacing error-prone inline SQL with calls to properly-tested, named helper functions (mirroring the pattern the *working* branches already use — `create_transaction`, `add_goal_contribution`, etc.) for any new Plan command type, rather than adding more inline `INSERT`s to the `CASE` statement.

---

## Part 9 — Naming Collision: `goal_contribution_plans`

**FACT (live-verified schema + repo grep, both this pass and Gate 0):**
- **What it represents:** a recurring auto-contribution *schedule* attached to exactly one `Goal` — "contribute ₹X every `frequency` starting `start_date`, next due `next_due_at`." It never moves money itself; it exists purely to drive reminder notifications (`GOAL_PLAN_UPCOMING`/`DUE`/`MISSED`) and to compute a suggested schedule.
- **Live columns (re-verified this pass):** `id, goal_id, user_id, frequency, amount_minor, anchor_day, anchor_month, timezone, start_date, next_due_at, status, created_at, updated_at`.
- **Routes/components:** `apps/web/app/goals/contribution-plan-sheet.tsx` (create/edit UI), nested under the existing `/goals` route — not a primary nav item of its own.
- **APIs/MCP:** `proposeCreateGoalContributionPlan`/`proposeUpdateGoalContributionPlan`/`proposePauseGoalContributionPlan`/`proposeResumeGoalContributionPlan`/`proposeDeleteGoalContributionPlan` (all confirmed working in `confirm_command`, Part 6).
- **User-visible terminology:** "Contribution Plan" (per the sheet file name and Gate 0's UX research), always presented as a sub-feature *of* a Goal, never as a standalone concept.

| | |
|---|---|
| CURRENT TERMINOLOGY | "Contribution Plan" — a recurring auto-save schedule for one Goal |
| COLLISION | The proposed new feature is also generically called "Plan" — same root word, materially different meaning (funding cadence vs. real-life purpose/context) |
| UX RISK | Real — a user with an active "Contribution Plan" for a Goal, then introduced to "Plans" as a new nav item, has a plausible "wait, is this the same thing?" moment; support/help-copy confusion is likely if terminology isn't deliberately separated |
| TECHNICAL RISK | Low-to-moderate — no actual schema/route collision exists (different table, different route prefix), so this is a naming/copy risk, not a technical conflict; **but** a careless choice like naming the new table `plans` next to `goal_contribution_plans` would read confusingly in migration files/code reviews even without a real conflict |
| POSSIBLE NAMES | "Plan"/"Plans" (status quo risk, per above); "Spending Plan"; "Financial Plan"; "Life Plan"; a proper-noun product name (e.g. a "Trips & Events" framing, though the spec explicitly rejects a travel-only framing) |
| DECISION REQUIRED | Yes — carried forward unchanged from Gate 0 §50.2. This report does not resolve it; it confirms the collision is real and adds no new information changing the recommendation to decide explicitly, deliberately, before any schema/route/copy is written. |

---

## Part 10 — Domain Boundary (verified against live/source, not just proposed)

| Concept | Belongs inside Plan domain | Must remain outside | Referenced (not duplicated) | Calculated (not stored) |
|---|---|---|---|---|
| Transactions | — | Entirely — Plans never own transaction rows | `transactions.plan_id`/`plan_item_id` FK | Plan actual-spending totals |
| Accounts | — | Entirely | via the transactions they own | — |
| Budgets (category) | — | Entirely — existing `budgets` table is unrelated to `plans.current_budget_minor` | `category_id` reused for Plan-item categorization | — |
| Goals | — | Entirely — `goals`/`goal_contribution_plans` untouched | via a new `plan_goals` link table (label only) | Goal progress display inside a Plan view (calls `getGoalProgress`, never re-derives) |
| Commitments | — | Entirely — `planned_commitments`/occurrences untouched | via `plan_items.commitment_id` | "committed total" for a Plan |
| Upcoming | — | Entirely — `getUpcomingProjection` untouched | filtered view scoped to Plan-linked commitments/loans | Plan's own "upcoming" tab |
| Safe-to-Spend | Never | Entirely, permanently — confirmed again this pass (Part 1/Gate 0 §33): no code path anywhere computes a "Plan reserve" | — | — |
| Notifications | Plan-specific event types/rules (new, additive) | The engine, dedupe, delivery, preferences mechanism itself | `deliverNotification()` | — |
| Spensa | Plan-specific read/research tools (new) | Canonical calculation logic | Plan calc functions as tool outputs | — |
| MCP | Plan-specific tool registrations (new) | The propose/confirm mechanism itself (reused, once repaired per Part 7/8) | `confirm_command`, `pending_confirmations` | — |
| FX | Nothing, if built — must be shared infra, never Plans-owned | The entire FX subsystem, if/when built | `transaction_fx_snapshots` (Gate 0 §29/§30) | Plan currency totals, once FX exists |

This table is unchanged in substance from Gate 0 §32/§33/§54's proposals — Gate 0.5's live verification found nothing that contradicts it, and the newly-confirmed Safe-to-Spend/Net Worth code (not independently re-read this pass, but consistent with Gate 0's direct quotes) still shows zero sub-grouping capability, reinforcing "Plans never touch Safe-to-Spend" as the only safe answer.

---

## Part 11 — Canonical Calculation Audit (cross-referenced, not re-derived)

| Calculation | Source file (per Gate 0's direct reads) | Function | Authoritative? | Known risks |
|---|---|---|---|---|
| Safe-to-Spend | `packages/domain/core/src/safeToSpend.ts` + `application/src/queries/safeToSpend.ts` | `calculateSafeToSpend`/`getSafeToSpend` | Authoritative, single implementation | Never clamped at zero (by design); zero sub-grouping capability (Part 10) |
| Net Worth | `core/src/netWorth.ts` + `application/src/queries/netWorth.ts` | `calculateNetWorth`/`getNetWorth` | Authoritative, deliberately never shares code with Safe-to-Spend | Same zero-sub-grouping limitation |
| Budget utilization | `core/src/budgets.ts` + `application/src/queries/budgets.ts` | `calculateBudgetUsage`/`listBudgetsWithUsage` | Authoritative | Category-only — no "overall budget" concept exists to reuse (Gate 0 §11) |
| Goal progress | `core/src/goals.ts` + `application/src/queries/goals.ts` | `calculateGoalProgress`/`calculateProgress` | Authoritative | None material to Plans beyond what's already documented |
| Commitment reserves | `core/src/commitments.ts` + `plannedCommitmentsRepo.ts`/`queries/plannedCommitments.ts` | reserve math inline in the occurrence-mutation functions | Authoritative but **the mutation functions themselves live in `queries/`, not `commands/`** (a pre-existing convention inconsistency, Gate 0 §4) | The `confirm_command` write path for commitments is confirmed broken (Part 6) — the underlying reserve math is fine, but MCP/Spensa-mediated writes to it currently fail |
| Credit-card reserves | `services/creditCardPayment.ts` | `applyPaymentToObligation`/`matchCreditCardPayment` | Authoritative per its own doc comment ("No system may implement independent matching logic") | Bypasses its own infra-repo convention (direct `ctx.supabase` calls, Gate 0 §4); `credit_card_payment_obligations` population logic not located in migrations (Gate 0 §9, unresolved open question) |
| Cash flow | `core/src/cashFlow.ts` + `application/src/queries/cashFlow.ts` | `calculateCashFlowTotals`/`getCashFlowOverview` | Authoritative — the one place the transfer/goal-leg exclusion rule lives | None new |
| Account balances | `transfer()`, `create_transaction()` (live-verified this pass) | inline `balance_minor`/`credit_used_minor` arithmetic | Authoritative, confirmed live and correct for same-currency operations | Cannot represent cross-currency balance changes (Part 1) |

**No new finding contradicts Gate 0's instruction that Plans must call into these, never re-derive them.**

---

## Part 12 — Money Value Object Verification (direct source read this pass)

`packages/domain/core/src/Money.ts` read in full. Verdict against the required test cases:

| Test case | Result |
|---|---|
| ₹74,840.87 (INR, 2dp) | Represented as `Money.fromMinorUnits(7484087n, "INR")` — exact, no float ever touches the value. **Works correctly**, contingent on the *caller* correctly converting "87 paise" to `87` minor units at the boundary (Money itself doesn't do decimal parsing beyond its own `parse(bigintString, currency)` method, which takes an already-integer minor-unit string, not a decimal major-unit string — there is no "$74,840.87" → `Money` parser in this file at all; that conversion, wherever it happens today, is presumably a simple `×100` at input time, which is exactly the same hardcoded-2-decimal assumption flagged in Part 1). |
| ₹1,00,000.50 | Same as above — `10000050n` — exact. |
| JPY | `Money.fromMinorUnits(n, "JPY")` is **mechanically accepted** — `Money` has no currency-exponent table, so it will happily hold, add, and compare JPY amounts as bigints. The problem is entirely **above** Money: every display call site (`goal-insight.ts:39`, `dashboard-section.tsx:356`, confirmed live this pass) divides by a hardcoded `100` — for JPY (0 real decimal places), this would display a JPY amount as if it had cents, i.e. ¥50000 stored "correctly" as `5000000` minor units (assuming the input layer also multiplies by 100 uniformly) would display as "¥50,000.00"-shaped output — cosmetically wrong (extra assumed decimal places) but not numerically wrong, **provided the input and output sides use the same hardcoded convention consistently**. The real risk is if any input path assumes real yen (no ×100) while a display path assumes the universal ×100 convention — a 100x display error. This was not observed directly (no JPY test data exists to trace), but the code has no safeguard against it. |
| KWD / BHD (3dp, real-world) | Same mechanical acceptance by `Money`, same absent safeguard above it. If KWD is entered assuming the real-world 1000 fils = 1 dinar convention (multiply major-unit input by 1000, not 100) while every display path divides by a hardcoded 100, a KWD amount would display **10x too large**. This is a genuine, would-be-real, currently-latent bug path — not yet triggered only because the app has never had a KWD/JPY user, as far as this review can tell. |
| THB (2dp, same as INR) | No exponent mismatch risk — works the same as INR mechanically, **but still cannot cross-aggregate with INR** without the FX layer from Part 1/3. |

**Verdict on "can Money safely support future multi-currency Plans?" — Partially, with a named, specific gap:**
- **Ready, as-is:** the core bigint arithmetic, currency-mismatch guarding (`add`/`subtract`/`compareTo` all throw `CurrencyMismatchError` across currencies — directly verified in source), and JSON serialization (decimal string, never a JS number) are all sound and require **no changes** for multi-currency Plans.
- **Not ready, must change:** there is no per-currency minor-unit-exponent (decimal places) concept anywhere above `Money` — not in `Money` itself, not in any formatting utility (none exists, confirmed by the `Intl.NumberFormat` zero-match search), not in any input-parsing boundary. **This must be added — a small, well-scoped `CURRENCY_MINOR_UNIT_EXPONENTS: Record<string, number>` (or equivalent, sourced from ISO 4217) consulted by every amount-input and amount-display call site — before any Plan (or indeed any part of the app) can safely support JPY, KWD, or BHD.** This is a real, previously-unstated (by Gate 0) engineering task, small in isolated scope but currently touching every hardcoded `/100` call site found in Part 1.

---

## Part 13 — RLS Verification (live-checked via Supabase advisors + source)

**Confirmed, live, via `get_advisors(type=security)`:**
- Three tables have RLS enabled with **zero policies**: `oauth_authorization_codes`, `oauth_clients`, `rate_limit_buckets`. This **matches Gate 0's description exactly** ("service-role/RPC-only by design") — the advisor flags it at `INFO` level (not a warning), consistent with this being an intentional pattern, not an oversight, *provided* the team already knows this and accepts it (worth a one-line confirmation from the team, not a code change).
- **New finding, not in Gate 0 (source-only read couldn't see this):** 8 SECURITY DEFINER functions — including **`create_transaction`, `transfer`, `update_transaction`, `auto_protect_occurrence_atomic`, `check_and_increment_rate_limit`, `cleanup_expired_telegram_tokens`, `handle_new_user`, `rls_auto_enable`** — are currently **executable by the unauthenticated `anon` role** via PostgREST (`/rest/v1/rpc/...`), per a live `WARN`-level advisory. Each of these functions does start with `if p_user_id <> auth.uid() then raise exception 'not_authorized'`, which should reject an anonymous caller in the normal case — **but this pattern has a documented general class of risk in PL/pgSQL**: if a caller can pass `p_user_id = NULL` while `auth.uid()` is also `NULL` (unauthenticated), the comparison `NULL <> NULL` evaluates to SQL `NULL`, not `TRUE`, and `IF NULL THEN ... END IF` does **not** execute the exception branch — execution would fall through the guard. **This was not exploited or tested against the live database in this review** (that would be an active security test, out of scope for a read-only architecture gate), but it is flagged as a concrete, live, verifiable-by-the-team security advisory that predates and is unrelated to Plans, and is exactly the kind of thing a new Plan SECURITY DEFINER function must not repeat — any new Plan RPC should have `REVOKE EXECUTE ... FROM PUBLIC, anon` applied explicitly, not rely solely on the `auth.uid()` guard.
- 21 functions (including `confirm_command`, `transfer`, `create_transaction`) lack a fixed `search_path`, a separate, lower-urgency (`WARN`) hardening advisory, standard practice to fix but not urgent.
- `pg_net` extension installed in the `public` schema (`WARN`, best-practice, unrelated to Plans).
- Leaked-password protection disabled at the Auth level (`WARN`, unrelated to Plans, an account-security setting).

**For Plans specifically:** the dominant RLS pattern (`user_id = auth.uid()` per operation or via a single `FOR ALL` policy) is sound and should be copied exactly for `plans`/`plan_items`. The **new** finding above means Plans' own future SECURITY DEFINER functions must be explicit about revoking `anon`/default `PUBLIC` execute grants — this wasn't done consistently for several *existing* functions, and that inconsistency should not be inherited.

---

## Part 14 — Event/Notification Architecture Verification

No new live queries were run against notification tables this pass (out of scope/lower risk than the currency and confirm_command questions); this section **confirms Gate 0's findings stand unchanged** based on the already-thorough direct source reads from Gate 0's UX/notifications research track (full file reads of `engine.ts`, `eventRules.ts`, `messageComposer.ts`, `notificationChecks.ts`):
- `deliverNotification()`, DB-enforced dedupe, per-channel independent delivery tracking, prefix-matching preferences — all reusable as-is for Plan event types (Gate 0 §16/§34).
- The quiet-hours server-time-vs-user-timezone bug (Gate 0 §16) is unchanged and still recommended as a pre-Gate-9 fix.
- Telegram delivery is a thin, reusable provider (Gate 0 §17) — no changes needed for Plans beyond message content.

**No architectural changes are required** to reuse this system for Plans — only additive `PLAN_*` event types and rule functions, exactly as Gate 0 proposed.

---

## Part 15 — Final Decision Matrix

| Issue | Fact | Impact | Blocks Gate 1? | Blocks full Plans? | Required action | Owner | Status |
|---|---|---|---|---|---|---|---|
| FX/multi-currency | Zero infrastructure exists, live-confirmed | Cannot represent 3/7 Thailand-scenario transactions | No | Yes, for true multi-currency Plans | Build as shared Gate 4, not Plans-scoped | Product + Eng | OPEN |
| Currency display precision | Hardcoded `/100` + hardcoded ₹/en-IN in at least 2 live call sites; no `Intl.NumberFormat` anywhere | JPY/KWD/BHD would display incorrectly if ever used | No | Yes, for those currencies specifically | Add a currency-minor-unit-exponent table + shared formatter | Eng | OPEN — new finding |
| Money value object | Sound bigint arithmetic, currency-mismatch-guarded, no exponent awareness | Safe for same-currency Plans today | No | Partially — needs the exponent table above for full multi-currency | Extend, don't replace | Eng | OPEN |
| `confirm_command` | **12 of ~35 branches confirmed broken live**, including `transfer`, `createGoal`, `createBudget`, `createCommitment`, `acceptGmailCandidate` | Spensa/MCP-proposed writes for these types fail today, production | No (Gate 1 is domain-model-only, no MCP) | **Yes — blocks Gate 11 (MCP) entirely until repaired** | Independent verification-then-fix, unrelated to Plans; do not extend the pattern for Plans until repaired | Eng | **P0, OPEN, worse than Gate 0 reported** |
| MCP tool-inventory asymmetry | Spensa (22 tools) vs. MCP (61 tools), not kept in sync | Plans tools would need dual registration or accept the asymmetry | No | Decision-dependent | Decide scope (§51.1) | Product + Eng | OPEN |
| Naming (`goal_contribution_plans`) | Confirmed live, real, differently-scoped feature | UX confusion risk if unaddressed | No | Yes — must be resolved before any UI copy/route naming | Choose distinct terminology | Product | OPEN |
| RLS pattern | Sound, consistent; 3 zero-policy tables confirmed intentional; **new**: 8 functions anon-executable | Plans' own RLS/RPC design should copy the good pattern, avoid the anon-grant gap | No | No, if Plans' own functions are written correctly | Explicit `REVOKE EXECUTE FROM anon` on any new Plan SECURITY DEFINER function | Eng | Informational for Plans; existing gap is a separate concern |
| Events/notifications | Fully reusable, generic, no changes needed | None | No | No | None required beyond additive event types | Eng | READY |
| Goals/Commitments/Upcoming domain | Mature, reusable, canonical calculations confirmed authoritative | Plans should link, never duplicate | No | No | Follow Gate 0 §32 proposal | Eng | READY |
| Safe-to-Spend | Confirmed zero sub-grouping, deliberately isolated from Net Worth | Plans must never touch it | No | No | None — Plans simply never call into it for reservation | Product + Eng | READY (as "never touch," by design) |

---

## Part 16 — Recommended Order (revised from Gate 0's original 15-gate sequence)

**Gate 0's original order is not blindly preserved.** The live verification changes the sequencing in one material way: **Gate 11 (MCP) cannot start until `confirm_command`'s existing defects are independently repaired — this is now a harder, verified blocker, not a hypothesis.** Everything else in Gate 0's ordering holds.

1. **Gate 0.5 (this report)** — done.
2. **Independent, Plans-unrelated fix**: verify-and-repair the 12 confirmed-broken `confirm_command` branches (already flagged as a standalone task, separate from the Plans track — see below). This can happen in parallel with Gate 1, since Gate 1 does not touch MCP.
3. **Gate 1 — Domain model + financial invariants.** Can proceed now, **scoped to pure domain types and calculation functions only**, exactly as Gate 0 recommended — nothing here depends on FX or `confirm_command` being fixed. What Gate 1 must explicitly bound: all calculation functions must be written and tested assuming **single-currency Plans only** for now (per Part 4/5's Option A), with the multi-currency formula variant left as an explicitly unimplemented, clearly-marked extension point.
4. **Naming decision** (Part 9 / Gate 0 §50.2) — should happen before Gate 2 (schema), since it affects table/column naming, but does not block Gate 1's pure-domain-type work if those types are kept naming-agnostic internally (e.g. develop against an internal working name, rename before any migration is written).
5. **Gate 2 — schema migrations** — blocked until the naming decision (step 4) and the multi-currency-scope decision (Part 4/17.2-3) are both made, exactly as Gate 0 concluded, unchanged.
6. **Gate 4 (currency/FX foundation)** — only if Option B is chosen; otherwise deferred indefinitely with Part 5's "safe MVP boundary" as the permanent v1 scope.
7. **Gates 3, 5–10, 12–14** — unchanged from Gate 0's original plan, with Gate 11 (MCP) now explicitly gated on step 2's independent fix being verified complete (not just started).

**Can Plan domain modeling safely proceed before FX? Explicitly: yes, for everything in Part 5's boundary list; explicitly no, for any calculation or schema field that assumes cross-currency aggregation is already solved** (e.g., do not build `plans.reporting_currency` conversion logic yet — build the field, leave the conversion as a documented, tested "not yet implemented, throws/excludes cleanly" path).

---

## Part 17 — Product Decisions (unresolved, explicitly not decided here)

1. **Product name/terminology** for the new concept, given the confirmed `goal_contribution_plans` collision (Part 9). **DECISION REQUIRED.**
2. **Whether full multi-currency Plans are required for the first release**, given the confirmed 3-of-7 Thailand-scenario failure (Part 2) and the Option A/B trade-off (Part 4). **DECISION REQUIRED.**
3. **Whether a shared currency/FX foundation must precede Plans**, or ship after Plans v1 with the "safe MVP boundary" (Part 5) as the interim state. **DECISION REQUIRED.**
4. **Whether foreign-currency transactions require redesign of the transaction/account model** (Part 1/3, item B/D) — confirmed as a real gap; the *scope and timing* of the redesign is the open decision. **DECISION REQUIRED.**
5. **Historical FX policy** (Part 3, item G) — insert-only snapshot approach proposed (Gate 0 §30), not yet approved. **DECISION REQUIRED.**
6. **Current-rate valuation policy** (Part 3, item H) — whether to build this at all for v1, and if so, how visually distinct from historical figures it must be. **DECISION REQUIRED.**
7. **Base/reporting-currency policy** (Part 3, item I) — per-Plan (proposed) vs. per-user global — Gate 0 proposed per-Plan; not yet approved. **DECISION REQUIRED.**
8. **Forex-card account model** (Part 3, item F) — accept the same-currency-only limitation as a real, disclosed product constraint, or invest in the funding-as-exchange redesign (Part 4). **DECISION REQUIRED.**
9. **Cross-currency transfer policy** — keep `transfer()`'s hard rejection permanently (safe, simple) vs. introduce a new "currency exchange" command type (Part 3/29). **DECISION REQUIRED.**
10. **Credit-card foreign-currency purchase policy** — whether this app should ever support entering a foreign-currency amount on a home-currency card (real-world DCC/foreign-transaction-fee scenario), given it requires the transaction-currency-independent-of-account-currency redesign (Part 1, item B). **DECISION REQUIRED.**

---

## Part 18 — Engineering Decisions (unresolved, explicitly not decided here)

- FX provider architecture and vendor selection (new, real cost/reliability implications).
- Historical rate storage shape (`transaction_fx_snapshots` as proposed, Gate 0 §30, vs. an alternative).
- **Currency precision**: introduce a `CURRENCY_MINOR_UNIT_EXPONENTS` table and a shared `Intl.NumberFormat`-based formatter, replacing every hardcoded `/100` call site found in Part 1/12 — **this is now a confirmed, concrete, scoped engineering task, independent of Plans**, worth its own fix regardless of the Plans timeline.
- Money model: no structural change needed (Part 12) — only the layer above it.
- Transaction currency model: decouple from account currency (Part 1, item B) — a real schema/RPC change, scope TBD by decision #4/#10 above.
- Account currency model: no change needed.
- Cross-currency transfer model: new command type vs. permanent rejection (decision #9).
- FX caching, rate provenance: only relevant if Gate 4 is built.
- Migration strategy: unchanged from Gate 0 §41 (additive-only).
- **`confirm_command` repair**: now a confirmed, scoped, independent task — 12 branches, each with a clear, specific fix (correct column names, correct function name/return-shape for `transfer`, correct type-cast target, correct Gmail-candidate column names and enum-cast logic). Flagged as a standalone follow-up task, unrelated to the Plans timeline.
- MCP confirmation architecture: reuse as-is (Part 8); do not modify the mechanism, only avoid repeating the inline-SQL-without-live-testing pattern for new Plan branches.
- Event architecture: no change needed (Part 14) — additive event types only.
- Plan/transaction association: unchanged from Gate 0 §28 proposal (nullable `plan_id`/`plan_item_id`, `ON DELETE SET NULL`).
- Plan aggregation architecture: unchanged from Gate 0 §31 proposal, explicitly bounded to single-currency per Part 5 until/unless Gate 4 is approved.

---

## Final Output Index (per the 15 items requested)

1. **Gate 0 findings verified:** zero FX infrastructure (Part 1); Thailand scenario partial failure (Part 2, refined); `confirm_command` schema mismatches for the originally-flagged 9 branches (Part 6); commitments/loans model maturity (Part 10/11, unchanged); notification/event architecture reusability (Part 14, unchanged); naming collision with `goal_contribution_plans` (Part 9); RLS pattern soundness (Part 13).
2. **Gate 0 findings disproved:** **`transactions.occurred_at` is `timestamp with time zone`, not a plain `date` as Gate 0 §7 stated** (confirmed live via `information_schema.columns`). This corrects Gate 0 §7's FACT claim and Gate 0's own edge-case-matrix row 26 (which concluded timezone attribution was "likely-unnecessary complexity" on the premise that only a date, no time-of-day, was stored) — **that conclusion no longer holds; a real time-of-day component is stored, and Plan/notification timezone-boundary logic must account for it**, not dismiss it.
3. **New findings:** (a) `confirm_command`'s `transfer` branch calls a nonexistent function (`create_transfer`) with an incompatible return shape — a 10th broken branch beyond Gate 0's list; (b) `acceptGmailCandidate`/`rejectGmailCandidate` branches are also broken (wrong columns, invalid enum cast) — an 11th and 12th; (c) `markOccurrencePaid` silently ignores its own accepted `transactionId`/`paidAmountMinor` input fields; (d) no currency-aware amount formatting exists anywhere (`Intl.NumberFormat` zero matches), with at least one hardcoded `₹`/`en-IN` display call site regardless of actual currency; (e) 8 SECURITY DEFINER functions (including `create_transaction`, `transfer`) are executable by the unauthenticated `anon` role per live Supabase security advisories; (f) `confirm_command` does have a loud fallback (`raise exception 'unsupported_command_type'`) for unrecognized command types, resolving a prior open question.
4. **`confirm_command` verification:** Part 6 (full branch-by-branch table, live-verified).
5. **Multi-currency verification:** Part 1, Part 3.
6. **Money verification:** Part 12.
7. **Naming collision analysis:** Part 9.
8. **Domain boundary analysis:** Part 10.
9. **Financial calculation audit:** Part 11.
10. **Final blocking dependencies:** Part 15 (matrix).
11. **Product decisions required:** Part 17.
12. **Engineering decisions required:** Part 18.
13. **Recommended implementation order:** Part 16.
14. **Revised gate sequence:** Part 16 (Gate 11/MCP now explicitly gated on independent `confirm_command` repair verification, not just Gate 10 completion).
15. **Exact next-prompt recommendation:** Begin **Gate 1 — Domain model + financial invariants**, explicitly scoped to (a) pure domain types and canonical calculation functions only, (b) single-currency-Plans-only formulas with multi-currency left as a documented, tested "not yet implemented" extension point, (c) no schema migrations applied, (d) no MCP work of any kind. In parallel, independently pursue the `confirm_command` repair (Part 6/Part 18) as its own, Plans-unrelated task — it does not block Gate 1 but does block Gate 11. The naming decision (Part 9/17.1) should be made before Gate 2 begins, not before Gate 1.

---

## Final Status Block

```
GATE 0.5 STATUS:
PASS

MULTI-CURRENCY FOUNDATION:
NOT READY

MONEY FOUNDATION:
NOT READY (core arithmetic is sound; currency-minor-unit-exponent/display layer is a confirmed gap — Part 12)

CONFIRM_COMMAND:
DEFECT CONFIRMED (live-verified, broader than Gate 0 reported — 12 of ~35 branches confirmed broken, not 9)

MCP FOUNDATION:
BLOCKED (mechanism is sound and reusable per Part 8; blocked specifically on confirm_command repair, Part 7)

PLAN DOMAIN:
READY FOR GATE 1 (scoped to pure domain model + single-currency financial invariants only, per Part 16)

PRODUCT DECISIONS REQUIRED:
Part 17, items 1-10 (naming; multi-currency v1 scope; FX-foundation timing; transaction/account model redesign scope; historical-FX policy; current-rate-valuation policy; base/reporting-currency policy; forex-card model; cross-currency transfer policy; credit-card foreign-currency purchase policy)

ENGINEERING DECISIONS REQUIRED:
Part 18 (FX provider/vendor; historical-rate storage shape; currency-precision/exponent table + shared formatter; transaction-currency-model decoupling; cross-currency transfer command design; confirm_command repair scope; Plan aggregation architecture bounding)

P0 BLOCKERS:
- confirm_command has 12 confirmed-broken command-type branches live in production today (createGoal, updateGoal, createBudget, createCategory, updateCategory, createBill, updateBill, transfer, acceptGmailCandidate, rejectGmailCandidate, createCommitment, updateCommitment) — blocks Gate 11 (MCP) until independently repaired and verified.
- Zero multi-currency/FX infrastructure exists at any layer (accounting or display) — blocks any claim of "multi-currency Plans" until Part 17 decisions 2-3 are made and, if Option B chosen, Gate 4 is built.

P1 BLOCKERS:
- No currency-aware amount formatting exists anywhere in the app (no Intl.NumberFormat usage found); at least one hardcoded currency-symbol/locale display call site found live — a confirmed, scoped gap independent of Plans.
- 8 SECURITY DEFINER functions are anon-executable per live Supabase security advisories — an existing, Plans-unrelated hardening gap that any new Plan RPC must not repeat.
- Naming collision with the live goal_contribution_plans feature remains unresolved.
- transactions.occurred_at is timestamptz, not date (Gate 0 correction) — Plan/notification timezone-boundary logic must be designed against this corrected fact, not dismissed as unnecessary.

FOUNDATIONAL WORK REQUIRED BEFORE GATE 1:
None — Gate 1, scoped as described in Part 16/Final Output item 15, has no unresolved prerequisite. (Gates 2, 4, and 11 each have named prerequisites per Part 16.)

RECOMMENDED NEXT GATE:
Gate 1 — Domain model + financial invariants, single-currency-scoped, no schema applied, no MCP work. Independently and in parallel: verify-and-repair the 12 confirmed confirm_command branches (Plans-unrelated task).

DO NOT IMPLEMENT YET:
- Any Plan database migration (pending naming decision, Part 9/17.1, before Gate 2)
- Any multi-currency/FX schema or code (pending Part 17 items 2-3)
- Any new confirm_command branch for Plans (pending independent repair of the 12 confirmed-broken existing branches, Part 6/7)
- Any Plan MCP tool (blocked on the same confirm_command repair)
- Any Plan notification signal (fine to design, per Part 14, but do not implement until Gate 9 per the original sequence)
- Any Plan UI

SOURCE FILES MODIFIED:
NO

DATABASE MODIFIED:
NO

PRODUCTION MODIFIED:
NO

DEPLOYED:
NO
```

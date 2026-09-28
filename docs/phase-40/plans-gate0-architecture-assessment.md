# Spencare Plans — Gate 0 Architecture Assessment

**Status:** Read-only discovery. No source files, migrations, schema, configuration, or production data were changed while producing this report. See final status block.

**Method:** Four parallel read-only research agents inspected the repository at `/Users/santhoshs/Desktop/spencare` (git `main`, commit `eb55a77d`, clean tree) — (A) all 61 SQL migrations + pgTAP tests, (B) `packages/domain/{core,application,infra}`, (C) the MCP/Spensa tool surface, (D) web UX/notifications/testing. This document reconciles their findings into the required 55-section format with FACT / PROPOSED / INFERENCE / GAP / DECISION REQUIRED labels, then adds the mandated adversarial matrix, gate plan, and self-critique.

Labels used throughout:
- **FACT** — observed directly in code/schema/tests.
- **INFERENCE** — a conclusion drawn from existing code but not explicitly documented.
- **GAP** — a capability Plans needs that does not exist today, or exists insufficiently.
- **PROPOSED** — a recommended future architecture (this report's own recommendation).
- **DECISION REQUIRED** — a product/business/engineering call that must be made by a human before implementation proceeds.

---

## 1. Executive Summary

**FACT.** Spencare is a mature, single-tenant personal-finance app (Next.js 16 + Supabase Postgres 17, Turborepo monorepo) with a genuinely well-factored three-layer domain (`core`/`application`/`infra`), a single canonical propose→confirm write mechanism (`confirm_command`) shared by Spensa chat and two MCP transports, a real notification engine with per-channel delivery tracking, and an already-built "Commitments/Loans" subsystem that is the closest existing analog to Plans' "Planned Item" and "Commitment" concepts.

**The single most important finding of this assessment:** **there is no multi-currency or FX infrastructure anywhere in the codebase today (GAP, §10, §29).** `accounts.currency` is per-account, but `transactions.currency` is defined to always equal the paying account's currency, `transfer()` hard-rejects any cross-currency movement, and there is zero exchange-rate table, conversion function, or historical-rate capture anywhere in 61 migrations. When the mandated Thailand-trip test scenario (§40, §"Exact Financial Example") is walked through against the real schema, **3 of the 7 transactions in that scenario cannot be represented by the current accounting primitives at all** — not "would be handled incorrectly," but literally rejected by an existing `raise exception 'currency_mismatch'` or by `Money`'s own currency-mismatch guard. This is not a Plans-specific gap; it is a base-platform gap that Plans exposes because Plans is the first feature to require real cross-currency aggregation. Building Plans-only currency handling would violate the spec's own "no duplicate FX engine" rule, so this must be built once, as shared foundation (Gate 4), not as Plans-scoped code.

**Second most important finding:** a verifiable, code-level defect exists in the live `confirm_command` RPC (§3 of the schema research, reproduced in §19/§47): the `createGoal`, `updateGoal`, `createBudget`, `createCategory`, `updateCategory`, `createBill`, `updateBill`, `createCommitment`, and `updateCommitment` branches reference columns/enum values that do not exist in the real schema (e.g. `goals.target_minor` vs. real `target_amount_minor`; `budgets.period` vs. real `period_start`/`period_end`; a cast to a type named `tenure_type` that doesn't exist — the real enum is `commitment_tenure_type`). This was found by reading source against the generated database types, not by querying the live database, so it must be verified against the live schema before being treated as ground truth — but if confirmed, it means **Plans must not copy the pattern of these specific branches**, and the app's own maintainers should independently verify/fix this regardless of Plans (flagged separately, §47).

**Third:** commitments/loans (`planned_commitments`, `planned_commitment_occurrences`, `loans`) are a mature, well-designed precedent — reserve-account split, day-rule anti-clamp-cascade math, atomic pay RPCs, idempotent autopay/auto-protect cron — that Plans should extend rather than duplicate, once the confirm_command branches for that domain are verified live.

**Overall assessment:** the domain layer, notification engine, MCP pattern, RLS conventions, testing conventions, and navigation architecture are all solid enough to build Plans on top of. The currency/FX gap is foundational and large enough that it should be its own gate (Gate 4) before any multi-currency Plan feature ships, and several product-naming/UX decisions (the `goal_contribution_plans` collision, budget-history retention, Plan/transaction association cardinality) need explicit answers before schema work starts.

**ARCHITECTURE STATUS: PASS** (with the currency foundation named as a mandatory prerequisite gate, not a blocker to *discovery* itself). See final status block for full detail.

---

## 2. Repository and Runtime Assessment

**FACT.**
- Git repository at `/Users/santhoshs/Desktop/spencare`; branch `main`; HEAD `eb55a77d24cf6ad5dd6aef9f4eca98c3f8f8be40` ("feat: add CommitmentActions + LoanActions to overview Upcoming tab", 2026-09-22); working tree clean (no uncommitted changes at time of this assessment).
- Remote: `origin → https://github.com/santhoshshanmugavel/spencare.git`.
- Package manager: pnpm 10.20.0 (`packageManager` field pinned); Turborepo 2 workspace with `apps/{web,mcp-server}` and `packages/{domain/{core,application,infra},ai,validation,ui}`.
- Node: local `v24.14.0`; `engines.node >= 20`; CLAUDE.md states production runs Node 22.x on Vercel.
- Root scripts: `dev`, `build`, `test`, `typecheck`, `lint`, `conformance` (dependency-cruiser), all run via Turborepo across packages.
- Database: Supabase Postgres 17.6, project ref `wjaxxoselhlbjrtuhqlq`, region ap-southeast-2; 61 chronological SQL migration files under `supabase/migrations/`; pgTAP-style smoke tests under `supabase/tests/*.sh`.
- Deployment: Vercel project `spencare` (root dir `apps/web`), auto-deploys on push to `main`.
- **GAP:** No `.github/workflows` directory exists in the repository. There is no CI pipeline gating merges/deploys on tests, typecheck, lint, or the `conformance` script — Vercel's auto-deploy-on-push-to-`main` is the only automation, and it is not contingent on `pnpm test`/`pnpm typecheck` passing. This is a pre-existing gap, material to §44 (Deployment Strategy) and §46 (Risks): a Plans-introducing PR merged to `main` deploys to production regardless of test outcome unless this is manually checked before merge.

---

## 3. Existing Architecture

**FACT.** Three deployable surfaces share one domain layer:
1. `apps/web` — Next.js App Router, Server Components + Server Actions, the production app at `spencare.vercel.app`.
2. `apps/mcp-server` — stdio MCP server for local Claude Desktop use; defines its own (larger) tool registry, built directly on `@spencare/domain-application` (cannot import `packages/ai` — layering forbids it).
3. `apps/web/app/api/mcp/route.ts` — remote HTTP MCP transport; imports `apps/mcp-server`'s tool registration functions **unmodified** ("NOT A PARALLEL IMPLEMENTATION" per its own code comment) — a genuinely shared implementation, not a re-implementation.

A fourth, smaller tool surface (`packages/ai/src/tools`, 22 tools) backs the in-app Spensa chat and is **not kept in sync** with the 61-tool MCP surface — this is a real, pre-existing asymmetry Plans must decide how to handle (§36, §51).

All financial writes ultimately funnel through one of: (a) direct Server Actions calling `@spencare/domain-application` commands (Web UI path — explicitly *not* routed through the propose/confirm cascade), or (b) `proposeCommand` → `pending_confirmations` → `confirmCommand` → the `confirm_command` SECURITY DEFINER Postgres RPC (Spensa chat + all MCP writes).

---

## 4. Existing Domain Architecture

**FACT.** Three packages with intended one-directional boundaries (`core` → nothing; `application` → `core`+`infra`; `infra` → `core` only), enforced by `.dependency-cruiser.cjs`.

- **`packages/domain/core`** (28 files): pure value objects and calculation functions. `Money` (bigint minor units, currency-checked, no floats, JSON-serializes as a decimal string) is the sole sanctioned arithmetic surface. Pure calculation modules: `safeToSpend.ts`, `netWorth.ts`, `budgets.ts`, `goals.ts`, `cashFlow.ts`, `commitments.ts`, `creditCardBilling.ts`, `transferMatching.ts`, `reserveStatus.ts`, `ai.ts` (privacy-mode redaction). **Confirmed zero imports** of infra/application/React/Supabase/any AI SDK — purity holds.
- **`packages/domain/application`**: `commands/` (28 files, one per write use-case, most wrapped in a `Command<Input,Output>`/`Result<T,E>` convention), `queries/` (19 files, read/derived-state composition), `services/` (1 file — credit-card obligation/payment matching), `mappers/` (1 file), `notifications/messageComposer.ts` (phrasing only).
- **`packages/domain/infra`**: one repository file per table/RPC generally (26 repo files), `generated/database.types.ts` (2,459 lines, Supabase-generated).
- **INFERENCE / pre-existing debt, not introduced by Plans:**
  - 6 confirmed `dependency-cruiser` boundary violations (`no-web-ui-direct-database`: UI importing `packages/domain/infra` directly) — 3 functional, 3 type-only-import. Not CI-gated (no workflow wires the `conformance` script into anything), so these sit unfixed.
  - `commitments`/`loans` mutations (`addCommitment`, `payCommitmentOccurrenceAtomic`, `addLoan`, etc.) live in `queries/plannedCommitments.ts` / `queries/loans.ts`, not `commands/`, and don't follow the `Command`/`Result` convention the rest of the codebase uses.
  - `services/creditCardPayment.ts` and two query functions bypass their own infra-repo convention, calling `ctx.supabase.from(...)` directly for `credit_card_payment_obligations`/`credit_card_payment_links`/`transactions` — no infra repo exists for the first two tables at all.
  - `AccountType`, `LoanType`, `PaymentFrequency` are declared independently (same values, no shared import) in both `core`/`infra` and `packages/validation` — a latent divergence risk.
- **DECISION REQUIRED:** should Plans' own commitment-like mutations (if any) follow the `commands/` convention properly (recommended, since it's the majority pattern) rather than repeat the `queries/` mutation precedent?

---

## 5. Existing Database Architecture

**FACT.** Full column-level detail is in the underlying schema research (61 migrations read in full); summarized per-domain in §7–§16. Headline structural facts:
- No generic event-sourcing table; the only cross-cutting mechanism is `audit_log` (append-only, `before`/`after` jsonb, written only from SECURITY DEFINER functions or service-role — see §20).
- Three **coexisting, inconsistent** soft-delete/archival conventions across tables: `deleted_at`, `archived_at`, and "status enum value used as delete marker" — `goals` alone uses all three simultaneously.
- RLS is near-universal but stylistically inconsistent (one-policy-per-operation on older tables vs. single `FOR ALL` on newer ones) — functionally equivalent, cosmetically divergent.
- Migration naming/versioning discipline is followed (`YYYYMMDDNNNNNN_description.sql`, additive-only) but **actual correctness discipline within `confirm_command` broke down** across the commitments/loans rewrite (§19).

---

## 6. Existing Financial Accounting Architecture

**FACT.** CLAUDE.md §9 documents these as non-negotiable invariants, and the schema/code confirm each is actually implemented, not just aspirational:
- `amount_minor` integer minor units everywhere; `Money` value object is the only arithmetic path; no floats.
- `occurred_at` (financial event date) vs. `created_at` (row-insert time) are kept distinct.
- Income/expense definition explicitly excludes transfers and goal legs: `type='income'|'expense' AND deleted_at IS NULL AND transfer_pair_id IS NULL`.
- Transfers are two linked rows (`transfer_pair_id`), never income/expense; credit-card repayment is implemented as a `transfer`, not a second expense.
- Credit-card purchase = expense + `credit_used_minor += amount`; repayment = `transfer` (credit card destination only) + `credit_used_minor -= amount`, uncapped at zero (overpayment silently allowed — "no sufficiency checks anywhere" is a documented house style, not a bug).
- Safe-to-Spend and Net Worth are two **deliberately separate** calculations with an explicit doc comment forbidding merging them — a genuinely good precedent Plans must not violate by inventing a "Plan reserve" that quietly becomes a third overlapping concept (§33).

---

## 7. Existing Transaction Model

**FACT.** `transactions`: `id, user_id, account_id, type(income|expense|transfer|goal_contribution|goal_withdrawal), amount_minor(>0), currency(char3), category_id, merchant, description, occurred_at(date), status(posted|pending), transfer_pair_id, goal_id, bill_prediction_id, import_batch_id, item_name, created_at, updated_at, deleted_at`. `amount_minor` is always positive; direction comes from `type`. No `goal_contributions` table exists — contributions/withdrawals are just `transactions` rows with `goal_id` set. Canonical mutating RPCs: `create_transaction`, `update_transaction`, `delete_transaction`, `transfer` — all SECURITY DEFINER, all independently re-verify `auth.uid()` and per-foreign-key ownership.

**GAP (critical, see §1, §10, §29):** `transactions.currency` is defined and enforced to equal the paying account's currency at write time — there is **no independent "transaction currency" concept** distinct from the account's own currency. A foreign-currency purchase made on a home-currency instrument (e.g. a THB purchase on an INR-denominated credit card — exactly transaction #6 in the mandated Thailand scenario) is not representable today.

---

## 8. Existing Account Model

**FACT.** `accounts`: `id, user_id, type(bank|cash|credit_card|investment), name, currency(char3), balance_minor, credit_limit_minor, credit_used_minor, market_value_minor, is_archived, deleted_at(unused — no command ever sets it), statement_close_day, payment_due_day, created_at, updated_at`. Credit/investment fields are XOR-enforced by CHECK constraints against `type`. Currency is **per-account** — a real, if minimal, multi-currency primitive already exists at the account level (one account = one currency, immutable in practice since nothing changes it after creation).

---

## 9. Existing Credit Card Model

**FACT.** Three loosely-connected mechanisms, confirmed via full-file reads:
1. `credit_card_payment_sources` — pure 1:1 config ("which bank account pays which card"), never moves money, documented as never affecting Net Worth.
2. `credit_card_payment_obligations` — one row per statement cycle (`statement_balance_minor`, `paid_minor`, `status`). **GAP:** no SQL migration anywhere generates these rows; the table/RLS exist but population logic was not found in the 61 migrations (may be app-layer/edge-function code not covered by this review — needs live verification before Plans relies on it for "what's due").
3. `credit_card_payment_links` — join table matching a transfer-created transaction to one or more obligations (supports partial/split payment).

Canonical liability figure for Net Worth is `credit_used_minor` directly (never the limit). Canonical utilization/billing-cycle math (`resolvePaymentDueDate`, `getCurrentStatementPeriod`) lives in `packages/domain/core/src/creditCardBilling.ts`, explicitly documented as "the single authoritative implementation" — Plans must call these, never re-derive billing-cycle dates independently.

---

## 10. Existing Currency/FX Architecture — MAJOR GAP

**GAP.** This is the load-bearing finding of the whole assessment (expanded in §29/§30):
- No exchange-rate table, no rate-snapshot column on any table, no conversion function, no FX provider integration anywhere in 61 migrations or the domain/application code the research agents read.
- `transfer()` **actively rejects** cross-currency movement: `if v_from.currency <> v_to.currency then raise exception 'currency_mismatch'`. A same-currency-only constraint, not a bug — but it means a Bank(INR)→ForexCard(THB) funding transfer, as specified in the mandated Thailand test, cannot execute through the existing `transfer` RPC at all.
- `profiles.preferred_currency` and `accounts.currency` exist, but nothing converts between them; `Money.add`/`Money.subtract` throw `CurrencyMismatchError` on any currency mismatch — meaning **every existing aggregate calculation in the app (Safe-to-Spend, Net Worth, Dashboard, Cash Flow) is implicitly single-currency per user today**, not a Plans-specific limitation.
- `planned_commitments.currency` / `loans.currency` are plain `text default 'INR'`, a looser/inconsistent type than the `char(3)` used on `accounts`/`transactions`/`profiles`.

**DECISION REQUIRED:** does Plans v1 need genuine multi-currency support (requires new foundational infrastructure, Gate 4, non-trivial), or does v1 ship scoped to single-currency Plans (still *tagging* original transaction currency/amount for future-proofing, but not attempting cross-currency budget aggregation), with true multi-currency explicitly deferred to a later gate? The mandated product spec assumes full multi-currency exists; it does not, anywhere in this app, for any feature.

---

## 11. Existing Budget Architecture

**FACT.** `budgets.category_id` is `NOT NULL` — **every budget row is category-scoped; there is no schema concept of an "overall" unscoped budget** anywhere in the app today. One row = one category × one calendar month (unique index enforces this). "Recurring" budgets (`is_recurring`) are implemented as bounded bulk write-ahead (real rows inserted ~24 months forward), not a resolved-at-read-time template — a deliberate choice so every existing consumer needs zero changes, at the cost of a disclosed forward-window bound. Canonical usage/status/variance formulas live in `core/src/budgets.ts` (`calculateBudgetUsage`, thresholds 70%/100%) consumed by `queries/budgets.ts` (`listBudgetsWithUsage`, batched to avoid N+1).

**GAP:** the product spec's "Plan overall budget" (a single top-level spending limit not tied to any category) has no existing analog anywhere in Spencare — budgets today are always category-shaped. This is new territory for the whole app, not just Plans.

---

## 12. Existing Goal Architecture

**FACT.** `goals`: `id, user_id, name, target_amount_minor(>0), target_date, funding_account_id(NOT NULL, FK accounts), saved_amount_minor, status(active|completed|archived), image_url, term(short|long), created_at/updated_at/deleted_at/completed_at/archived_at`. No `currency`, `icon_emoji`, or `notes` columns exist (relevant to §19's confirm_command defect). "Already saved" is informational metadata; real contributions are `transactions` rows (`type='goal_contribution'`) that do debit the funding account — CLAUDE.md's stated "don't double-count" rule is real and implemented.

**Naming-collision fact (important for Plans, confirmed independently by two research tracks):** `goal_contribution_plans` is a **live, shipped, differently-scoped feature** — a recurring auto-contribution *schedule* attached to one Goal (`frequency`, `anchor_day`, `next_due_at`, its own `GOAL_PLAN_UPCOMING/DUE/MISSED` notification events). It answers "how much and how often do I contribute toward Goal X," not "group these transactions under one trip/event." **DECISION REQUIRED:** the new "Plans" feature's naming (table name, route, UI copy, MCP tool prefixes) must be chosen to avoid user and codebase confusion with this existing "Contribution Plan" feature — e.g. avoid a bare `plans` table name; consider `spending_plans`/`financial_plans`/a distinct verbal identity in UI copy.

---

## 13. Existing Commitment Architecture

**FACT.** `planned_commitments` (a named recurring or one-off forward obligation — insurance, rent, subscription; replaces "manual bills") + `planned_commitment_occurrences` (one row per concrete due-date instance; `reserved_minor` grows toward `amount_minor`, purely logical, never moves money). Key mechanisms:
- **Reserve-account split:** `payment_account_id` (where money is actually debited from) vs. `reserve_account_id` (a separate, bank/cash-only field marking logical protection; `NULL` for credit-card-funded commitments). Reserving is `reserved_minor += X` on the occurrence row — never a real transfer.
- **`pay_commitment_occurrence_atomic`** is the one real money-moving path: calls `create_transaction`, marks the occurrence paid, links `matched_transaction_id`, optionally inserts the next occurrence (next date **precomputed in TypeScript**, never in SQL — a deliberately good pattern). Had a real, now-fixed P0 bug (referenced a nonexistent `transaction_id` column for ~2 migrations).
- **`payment_day_rule`/`saving_day_rule`** (1–31, 32=sentinel for "last day") were added specifically to fix a cascading-clamp bug (a commitment "due on the 31st" degrading permanently to the 28th after passing through February) — day-of-month is now recomputed fresh from the rule every time, never chained off the previous date.
- **Autopay/auto-protect** (`commitmentAutomation.ts`, daily cron): idempotent by construction (`status='upcoming'` guard on autopay; `GREATEST()` cap on auto-protect), fires notifications exclusively through the shared `deliverNotification()` — never a bespoke path.

**INFERENCE:** this is the single closest, most mature existing analog to "Planned Item" + "Commitment" in the new Plans spec, and Plans should extend it rather than invent a parallel concept — subject to §19's confirm_command defect being resolved first, since that is this subsystem's actual write-integration point for MCP/Spensa.

---

## 14. Existing Upcoming Architecture

**FACT.** `queries/upcomingProjection.ts` (`getUpcomingProjection`, ~440 lines) is the **single canonical source** for all forward-looking obligations: unifies `commitment_payment`, `commitment_preparation` (savings allocation — never counted as spend), `goal_contribution` (never counted as spend), `loan`, `credit_card_statement`, `credit_card_payment` into one sorted `UpcomingEvent[]`, deduplicating projected-vs-persisted occurrences by `(commitmentId, YYYY-MM)`. Uses non-cascading month-end-safe date projection (the same fix class as §13's day-rule). **Any Plan-scoped "what's coming next" view must compose over this function, not reimplement its date logic.**

---

## 15. Existing Safe-to-Spend Architecture

**FACT.** `core/src/safeToSpend.ts` (`calculateSafeToSpend`) + `queries/safeToSpend.ts` (`getSafeToSpend`): `amount = min(budgetRemaining?, availableBalance − goalReservedTotal − cardPaymentReservedTotal) − upcomingBillsTotal − commitmentReservedTotal − loanReservedTotal`, where `availableBalance` = Bank+Cash only (credit card explicitly excluded — its available credit is tracked separately as `creditAvailableTotal`, never summed in). Five-state result (`no_accounts|balance_only|budget_only|goals_only|budget_and_goals`). **Never clamped at zero** — can go negative, by design. Deliberately never shares code or callers with Net Worth.

**GAP:** no per-account, per-category, or arbitrary-transaction-subset filter dimension exists on this calculation — it is a single whole-portfolio number. Any "Plan-scoped Safe-to-Spend-like" metric requires new composition logic on top of these pure functions (re-slicing the transaction/reservation inputs by Plan membership before calling in), not a parameter this function already exposes.

---

## 16. Existing Notification Architecture

**FACT.** `deliverNotification()` (`apps/web/lib/notifications/engine.ts`) is a genuinely generic fan-out, not per-feature bespoke code:
1. `composeNotificationMessage(eventType, context)` — phrasing only, never decides *whether* to fire.
2. DB-enforced dedupe: `upsert(..., onConflict: "user_id,dedupe_key", ignoreDuplicates: true)` — a `null` result means "already delivered," counted, not re-sent. Every rule constructs its own `dedupeKey` string.
3. Per-channel, independently: in-app (always, if enabled), email (env-flag gated, currently disabled in prod), Telegram (connection + preference + quiet-hours gated, try/catch isolated so an outage never blocks the rest). Each channel's delivery status is tracked independently in `notification_deliveries` (`unique(notification_id, channel)`).
4. Preferences use **prefix matching** (`event_type: "PLAN"` would automatically govern `PLAN_DUE`, `PLAN_UPCOMING`, etc., for free, as long as new event types share a common prefix) — a real, usable extension point.

**Found defects (pre-existing, not Plans-caused):**
- Two overlapping unique-constraint mechanisms on `notifications(user_id, dedupe_key)` (a partial index + a later full constraint added only to satisfy PostgREST's `onConflict` requirement) — redundant, not broken, but worth cleaning up independently.
- **Quiet hours are evaluated using server local time (`new Date().getHours()`), not the user's IANA timezone** — a latent inconsistency, while the cron orchestrator elsewhere is careful about per-user timezone. If Plan reminders are timezone-sensitive (likely, given trip/event dates), this existing bug will affect them too unless fixed as part of Gate 9.

`NotificationEventType` is one flat string-literal union (~50–60 values) with one big `switch` in `messageComposer.ts` — adding `PLAN_*` events is mechanical (append literal + `case` block), following the exact pattern every existing domain (Budget/Goal/Bill/Commitment/Loan) already uses. **No new engine, delivery table, or preference mechanism is needed.**

---

## 17. Existing Telegram Architecture

**FACT.** Inbound: `apps/web/app/api/telegram/webhook/route.ts` — secret-header-verified, tiny command router (`/start [token]`, `/help`, `/settings`, `/disconnect`), one-time link tokens, always returns HTTP 200 (avoids Telegram retry storms on an already-consumed token). Outbound: `telegramProvider.ts` — `sendTelegramMessage` via Bot API, HTML parse mode. Most notification types reuse in-app `body` as a fallback Telegram message; only `DAILY_SUMMARY` builds a richer `telegramBody` with bullets and a deep link — the pattern a nicely-formatted Plan digest should follow. Delivery status is tracked the same way as every other channel (§16) — no Plans-specific Telegram work needed beyond message content.

---

## 18. Existing Spensa Architecture

**FACT.** `packages/ai/src/orchestrator.ts` drives a provider-agnostic loop against `AiProviderAdapter` (`chat/validateKey`, implementations for Anthropic/OpenAI/Google + a `fakeAdapter` test double) — no provider SDK is imported outside `packages/ai/src/adapters`. Users supply their own encrypted API key (`AI_PROVIDER_ENCRYPTION_KEY`); no platform-wide key exists. Tool set: 10 read + 12 write (propose-only) tools in `packages/ai/src/tools`, dispatched through a single `executeTool` registry the model cannot extend. Privacy Mode masking is real and layered: every read tool's structured result is redacted before reaching the model (`redactFinancialSnapshot` et al.), the AI-context blob is redacted the same way, and even the model's own **generated prose** is redacted post-hoc (`redactFinancialText`) with streaming deliberately buffered to a single final chunk specifically because a ₹ figure can straddle two streamed deltas — a well-thought-out detail. Persisted assistant messages store the redacted text, so history replay can't resurface a real figure.

**GAP relative to Plans' "research/planning" requirement:** nothing in the current Spensa architecture does external research (no web-search tool, no source/URL/confidence/freshness metadata concept anywhere in the schema or domain code). The entire "Spensa researches trip costs" capability is greenfield — it is not an extension of an existing mechanism, it is new tool-calling + new schema (§19 of the product spec's requirements, §35 of this report).

---

## 19. Existing MCP Architecture

**FACT.** Two transports (`apps/mcp-server` stdio, `apps/web/app/api/mcp/route.ts` remote HTTP) share one 61-tool implementation via `apps/mcp-server/src/lib.ts` re-exports — genuinely not duplicated. Remote transport is stateless per-request (Vercel has no process affinity; `pending_confirmations` state lives in Postgres so this is safe) and rate-limited (30/min per IP, checked before auth parsing); stdio and Spensa-chat are **not** rate-limited (asymmetry, low risk given stdio's single-local-caller nature, but Spensa-chat's lack of inbound rate limiting is worth noting for Plans tools reachable from chat).

**Propose/confirm round trip (the mechanism Plans must reuse):** `proposeCommand` → plain RLS-scoped INSERT into `pending_confirmations` (`source` ∈ web/spensa/mcp/gmail, `command_type` text, `payload`/`preview` jsonb, 10-minute expiry) → user approves → `confirmCommand` → `confirm_command` SECURITY DEFINER RPC: `SELECT...FOR UPDATE` row lock (the actual concurrency-safety mechanism), status check, **status flipped to `confirmed` before the mutation runs** (so a failed mutation rolls the whole transaction back to `pending`, never stranding it), then a `CASE command_type` dispatch to either an existing atomic RPC or an inline INSERT/UPDATE with its own re-derived `auth.uid()` check, then a generic `audit_log` wrapper row.

**Idempotency is structural, not a caller-supplied token:** the row lock + single-use `status` column guarantees at-most-once *execution* per `confirmationId` — a retried confirm after a lost response is safely rejected (`confirmation_not_pending`), satisfying the mandated "MCP response lost after successful DB commit → retry must not duplicate" invariant (§25 of the product spec) **for the confirm step**. There is **no** protection against a caller re-*proposing* the same logical write twice (each `propose` call is an independent, always-successful insert) — a non-issue today since propose itself is cheap, but worth naming explicitly as a design property, not an oversight.

**Ownership/authorization is centralized at the database layer, not in JS tool handlers** — every SECURITY DEFINER function opens with `if p_user_id <> auth.uid() then raise exception 'not_authorized'` and independently re-verifies every foreign-key payload field belongs to that user. This pattern exists **because of a real, previously-shipped, now-fixed IDOR** in `add_goal_contribution` (documented in `20260830000001_goal_contribution_idor_fix_and_withdrawal.sql`'s own header) — a directly relevant precedent: any new Plans SECURITY DEFINER function must follow this exact discipline from day one.

**Verifiable, code-level defect (GAP/BLOCKER candidate):** as detailed in §1/§10 (schema report) and reproduced in §47, the `createGoal`/`updateGoal`/`createBudget`/`createCategory`/`updateCategory`/`createBill`/`updateBill`/`createCommitment`/`updateCommitment` branches of the live `confirm_command` function reference columns/enum type names that do not exist in the real generated schema — found by cross-referencing SQL source against `database.types.ts`, not by querying the live database. **This must be verified against the live Supabase schema before Plans copies this function's pattern for its own command types**, and should be raised to the team as a standalone bug independent of Plans.

**Three, not two, tool inventories exist** (Spensa's 22, MCP's 61) and are **not kept in sync** — commitments, loans, transfers, and account/category CRUD exist only in the MCP surface today. **DECISION REQUIRED (§51):** should Plans tools be registered in both surfaces from day one (consistent with "same canonical pattern everywhere"), or MCP-only initially, matching the current asymmetry for commitments/loans?

---

## 20. Existing Event/Audit Architecture

**FACT.** Exactly one generic mechanism exists: `audit_log` (`user_id, actor, action, entity_type, entity_id, before, after, created_at`), append-only, RLS SELECT-only for the owner, writable only from SECURITY DEFINER functions or service-role. **There is no event-sourcing system, event bus, or domain-event table anywhere in the 61 migrations.** Every atomic RPC writes its own `before`/`after` row at the point of mutation; `confirm_command` *additionally* writes one generic wrapper row — meaning several command types currently produce **two** `audit_log` rows per confirmed command, an inconsistency across command vintages (not a correctness bug, but worth being aware of when designing Plans' own audit density).

**GAP relative to product spec §26/§"Domain Events":** the specific `PLAN_CREATED`/`PLAN_BUDGET_CHANGED`/etc. event taxonomy the spec proposes has no existing analog as a *typed, queryable* event stream — it would have to be represented as `audit_log.action` string values (following the existing convention exactly) or as a genuinely new mechanism. **PROPOSED (§34):** reuse `audit_log` with new `action` values (`plan_created`, `plan_budget_changed`, etc.) rather than building a new event table — consistent with "no duplicate audit engine."

---

## 21. Existing Security/RLS Architecture

**FACT.** Dominant pattern: one named policy per operation, `user_id = auth.uid()` (older tables) or a single `FOR ALL` policy (newer tables) — functionally equivalent. Special cases: `categories` uses an "own or system" (`user_id IS NULL OR user_id = auth.uid()`) read policy with owner-only writes; several tables are RLS-enabled with **zero** `authenticated` policies by design (service-role/RPC-only: `bill_predictions` inserts, `audit_log`, `rate_limit_buckets`, OAuth tables). `security_settings` required a real, documented Postgres-specific fix (a column-level `REVOKE` cannot subtract from a broader table-level `GRANT`; the blanket Foundation grant had to be revoked at table level and re-granted narrowly per-column) — a useful cautionary precedent if Plans ever needs column-level restriction on a sensitive field (e.g. research API keys, if any were ever stored — they should not be, see §37).

Ownership enforcement for MCP/Spensa writes is genuinely defense-in-depth: MCP session-scope check (`read`/`write`) at the tool-handler layer, **plus** independent `auth.uid()` + per-FK ownership re-verification inside every SECURITY DEFINER function (§19). This is the correct pattern for Plans to copy exactly.

---

## 22. Existing UX/UI Architecture

**FACT.** Primary navigation is a single config array, `PRIMARY_NAV_ITEMS` in `apps/web/lib/nav-items.tsx` (currently: Home, Spensa AI, Cash Flow, Goals, Settings), consumed by every page that renders `<NavigationRail>`. Active-state is derived automatically from the first path segment (`isNavItemActive` in `apps/web/lib/navigation.ts`) — adding "Plans" as a primary item is a one-line array addition with automatic active-state for any `/plans/*` sub-route, no per-page wiring required.

Page architecture is consistent across every existing feature area: `app/<section>/page.tsx` (async Server Component: auth → parallel `Promise.all` domain queries → plain-DTO shaping → `<AppShell><NavigationRail/>...<XDashboard/></AppShell>`) → `<section>-dashboard.tsx` (Client Component, local UI state) → `<action>-sheet.tsx`/`-dialog.tsx` (Radix forms, each with a co-located `.test.tsx`) → `<section>/actions.ts` (`"use server"`, re-derives auth from the verified session, never trusts a client-supplied user id, calls into `@spencare/domain-application`, `revalidatePath`). A new Plans feature follows this exact shape mechanically.

**Documentation/reality gap found:** CLAUDE.md describes `<NavigationRail>` as "persistent left rail (desktop), bottom bar (mobile)," but **no responsive mobile bottom-bar component exists anywhere in the codebase** — the rail renders as a fixed-width icon column unconditionally at every viewport width. This is a pre-existing gap, not introduced by Plans, but it means a new "Plans" nav icon will simply be a 6th icon in that same always-visible rail on mobile too, with no separate mobile surface to also update — and it means the product spec's "design mobile-ready architecture" goal (§31/§39) starts from a smaller existing base than CLAUDE.md implies.

Accessibility is **systematically, not sparsely, enforced**: 52 `*.test.tsx` files assert `axe()`/`toHaveNoViolations()`; 316+ `aria-*`/`role=`/`focus-visible` occurrences across components; a tested rule that live regions are never `aria-live="assertive"`; consistent `role="alert"` on inline validation errors; the nav itself uses icon+`aria-hidden`+paired `sr-only` label. Plans is expected to match this bar, not exceed or relax it.

Dark mode is `next-themes` + CSS custom properties (`bg-background`, `text-foreground`, etc.) — any new Plans UI inherits dark mode for free by using existing tokens, never hardcoded colors.

---

## 23. Existing Testing Architecture

**FACT.** Vitest + Testing Library + jest-axe, co-located `*.test.tsx`/`*.test.ts`. Explicit, followed convention: **"never mock Supabase at the module level"** — component tests receive plain-prop data; domain-rule tests (e.g. `eventRules.test.ts`) mock only their direct collaborator *modules* (`./engine`, specific infra functions), never a Supabase client. Timezone-sensitive logic has genuinely thorough, explicit multi-zone coverage (IST, EDT/EST across DST transition dates including spring-forward/fall-back nights, BST, SGT, AEST/AEDT) — the bar any Plan due-date/reminder logic must meet.

---

## 24. Existing Performance Architecture

**FACT.** Server Components fetch via parallel `Promise.all` (e.g. home page fetches 11 things in parallel); `listBudgetsWithUsage` explicitly batches one spending read across all categories rather than N+1 per category — a real, applied anti-N+1 pattern. `getUpcomingProjection` deduplicates projected-vs-persisted rows in one pass rather than per-item queries.

**GAP/INFERENCE:** no explicit pagination pattern was found for large transaction lists in the research (the agents did not find a cursor/offset-paginated transaction query in the areas they read) — this needs live verification before assuming it exists, and is directly relevant to the product spec's "a Plan may contain thousands of transactions; do not load them all into the browser" requirement (§33/§39). Treat as an open question, not a confirmed gap, since the research scope did not exhaustively cover every transaction-listing query.

---

## Section 25–39: Plan Architecture Proposals

The following sections are **PROPOSED** architecture, built strictly on the FACTs above, using existing conventions wherever an existing mechanism qualifies, and calling out GAPs/DECISIONs wherever it doesn't. Nothing in §25–39 has been implemented.

### 25. Plan Domain Model Proposal

**PROPOSED.** Following the existing `core`/`application`/`infra` split and the `goals`/`planned_commitments` shape (not the incomplete "queries-folder mutation" precedent — see §4 decision):

```
Plan (packages/domain/core — pure type; packages/domain/infra — table)
  id, userId, name, description
  status: draft | active | paused | postponed | completed | archived   -- see §26 rationale
  startDate?, endDate?, timezone?                                       -- all optional (progressive enrichment, §5 of spec)
  reportingCurrency: char(3)                                            -- NOT "baseCurrency" naming, to avoid clashing with any future account "base currency" concept
  budgetMode: none | overall | category | itemized                     -- derived/settable, not enforced exclusively (a Plan can have an overall budget AND itemized estimates simultaneously — see §29 spec requirement "combination of all of the above")
  createdAt, updatedAt, completedAt?, archivedAt?
```

- Following §9's finding that `goals` overusing three soft-delete conventions at once is a known wart: Plans should pick **one** convention — `status` enum as primary lifecycle (draft/active/paused/postponed/completed/archived) plus a single `archived_at` timestamp set only on the `archived` transition (for "when," since `status` alone doesn't capture a timestamp). No separate `deleted_at` — Plans are never hard-deleted from the schema (matches "PLAN_ARCHIVED not PLAN_DELETED" spirit of the spec, and matches `bill_definitions`/`transactions`'s `deleted_at`-as-soft-delete convention closely enough that a genuine hard "delete a draft Plan with zero transactions attached" action could still use `deleted_at`, reserved for that one case only). **DECISION REQUIRED:** confirm whether a `draft` Plan with zero attached transactions can be truly deleted (row removed) vs. only ever archived.
- Progressive enrichment (spec §5) is satisfied naturally by making every field beyond `id/userId/name/status` nullable — a Plan with no dates, no budget, no categories, no items is a valid, fully-functional row from day one.

### 26. Plan Database Model Proposal

**PROPOSED**, with **GAP**s named inline.

```sql
create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  description text,
  status plan_status not null default 'draft',
  start_date date,
  end_date date,
  timezone text,                          -- IANA; nullable, distinct from profiles.timezone (spec §23)
  reporting_currency char(3) not null,     -- defaults to profiles.preferred_currency at creation, never silently changes after
  original_budget_minor bigint,            -- nullable = no overall budget
  current_budget_minor bigint,             -- nullable; see §29 budget-revision-history decision
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create type plan_status as enum ('draft','active','paused','postponed','completed','archived');
```
RLS: one-policy-per-operation on `user_id = auth.uid()`, matching the dominant existing style (§21). Indexes: `(user_id, status)`, `(user_id, start_date)`.

```sql
create table plan_items (   -- "Planned Item" per spec §14
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  user_id uuid not null references auth.users(id),   -- denormalized for direct RLS, matching planned_commitment_occurrences' own-FK convention
  name text not null,
  category_id uuid references categories(id),         -- reuse existing categories, see §27 decision
  status plan_item_status not null default 'planned',
  estimated_amount_minor bigint,
  estimated_currency char(3),
  estimate_source plan_item_estimate_source not null default 'user',  -- 'user' | 'spensa_research' — see §35
  research_metadata jsonb,        -- {sourceUrl, checkedAt, confidence, assumptions, location} — see §35, kept OUT of the typed columns deliberately since it's inherently variable-shaped and non-canonical
  expected_date date,
  commitment_id uuid references planned_commitments(id),  -- optional link, see §32
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create type plan_item_status as enum ('suggested','planned','booked','partially_paid','paid','cancelled','skipped');
create type plan_item_estimate_source as enum ('user','spensa_research');
```

```sql
alter table transactions add column plan_id uuid references plans(id);   -- nullable; zero/one Plan per transaction, see §28
alter table transactions add column plan_item_id uuid references plan_items(id);  -- nullable; a transaction may (optionally) also point at the specific planned item it fulfills, independent of plan_id (plan_id is denormalized from plan_item.plan_id at attach time for query simplicity, kept in sync by the same command that sets plan_item_id)
create index transactions_plan_id_idx on transactions(user_id, plan_id) where plan_id is not null;
```

**GAP called out explicitly:** none of `plan_budget_history`, an FX-rate table, or a `plan_categories` table are included here — they are deferred to §29/§30/§27 respectively pending the decisions those sections require.

### 27. Planned Item Model Proposal

**PROPOSED.** Statuses limited to the 7 the spec actually justifies with a described transition (`suggested`→`planned`→`booked`→`partially_paid`/`paid`, plus `cancelled`/`skipped`) — **not** including "committed" and "over/under estimate" as separate status values, since those are *derived* facts (a `plan_item` is "over estimate" by comparing its linked transactions' sum to `estimated_amount_minor` — a query result, not a stored state) rather than a lifecycle state; storing them as status values would create the exact "duplicate/ambiguous formula" anti-pattern the spec itself warns against in §29.

**Categories decision (DECISION REQUIRED, spec §"Plan Categories"):** reuse the existing `categories` table (FK, not a separate Plan-category layer) — this is a **PROPOSED**, not FACT, recommendation, for these reasons: (a) it avoids a second category system exactly as the spec instructs; (b) Spencare's `categories` table already supports user-defined custom categories (§8/`categories` schema) alongside system ones, satisfying "the user may also have completely custom categories"; (c) it lets Plan-item category variance reuse the exact same `category_id` joins every existing budget/cash-flow query already uses. The one open question: whether a category used only for planning (e.g. "Flight," "Visa Fees") should be auto-suggested/seeded per-Plan-type, which is a UX decision (§38), not a schema one — the schema does not need a `plan_id` on `categories` either way.

**Planned-item-to-transaction cardinality (matches spec exactly, confirmed as the safest model per §27 of the prompt):** one `plan_item` → many `transactions` (via `transactions.plan_item_id`), never the reverse. A transaction may point at zero or one `plan_item`. This directly satisfies the "Hotel: advance + second + final payment, all one Planned Item" requirement with a plain one-to-many FK — no join table needed for MVP.

### 28. Plan/Transaction Relationship Proposal

**PROPOSED**, matching the spec's own stated "initial intended model" exactly, and consistent with FACT §7 (transactions are never hard-deleted by cascading from a parent):
- `transactions.plan_id` — nullable, zero-or-one Plan per transaction (FACT-compatible: no schema change to `transactions`' existing constraints needed beyond adding this one nullable FK).
- Reassignment = a plain `UPDATE transactions SET plan_id = $new WHERE id = $id AND user_id = auth.uid()` — no special "move" command needed beyond an ordinary ownership-checked update, consistent with how `category_id` reassignment already works today.
- **`ON DELETE` behavior: `plan_id` FK must be `ON DELETE SET NULL` if a Plan row is ever truly deleted (draft-only, per §25), and Plan *archival* (the common case) is a status change that never touches `transactions` at all** — this directly satisfies "deleting/archiving a Plan must never delete transactions" (spec §6, §16) as a schema-level guarantee, not just an application-level promise.
- Attaching/detaching a transaction to a Plan must go through a new, thin command (`attachTransactionToPlan`/`detachTransactionFromPlan`) that touches **only** `plan_id`/`plan_item_id` — never `amount_minor`, `currency`, `account_id`, `occurred_at`, or `type`. This is directly testable (§"Property/Invariant Testing" in the Gate 1 prompt) and should be enforced by the command never accepting those fields as input at all, not by a runtime check.
- **Split allocation (one transaction funding two Plans) is explicitly NOT built** — matches spec §27's "do not introduce it unless necessary." Nothing in the schema above precludes adding a join table later without a breaking migration (the single `plan_id` column can coexist with a future `plan_transaction_splits` table if ever needed).

### 29. Multi-Currency Architecture Proposal

**PROPOSED, with a load-bearing DECISION REQUIRED up front** (restated from §1/§10): this section only matters if Plans v1 is scoped to genuinely support multi-currency. If v1 is scoped single-currency (§10's alternative), skip straight to "v1 minimal version" below.

**Full version (if approved):**
1. New table `fx_rates` (or reuse a future platform-wide table if one gets built independently of Plans — **this must not be a Plans-only table**, per the spec's own "no duplicate FX engine" rule): `id, base_currency, quote_currency, rate numeric not null, source text, fetched_at timestamptz, effective_date date`. Populated by a new server-side job calling an external FX provider (new secret, new env var, server-only per CLAUDE.md's secret-handling rules).
2. `transactions` gains no new currency column (its `currency` already exists) but a **new, separate** `transaction_fx_snapshots` table (one row per transaction that required conversion for Plan/reporting purposes): `transaction_id, original_amount_minor, original_currency, base_currency, rate_used, rate_source, rate_timestamp, converted_amount_minor`. This keeps FX conversion **out of the transaction's own immutable financial-truth row** (satisfying "never overwrite historical accounting truth") while still letting Plan aggregation join to a converted total.
3. `transfer()`'s cross-currency rejection is **not removed** — a Bank(INR)→ForexCard(THB) "transfer" becomes a **new, distinct command** (`fundForeignAccount` or similar), not a same-currency `transfer`, because it is economically a currency exchange, not a like-for-like movement; it should record the FX rate used for the exchange itself (distinct from later reporting-only conversions of THB spends back to INR).
4. Plan actual-spending aggregation groups by currency first (`Record<currency, Money>`), computes a reporting-currency total **only** by summing `transaction_fx_snapshots.converted_amount_minor` for transactions that have one — never by coercing `Money` instances of different currencies together (which would throw, per §10's FACT about `Money.add`).

**v1 minimal version (if multi-currency is deferred, DECISION per §10):** `plans.reporting_currency` still exists (single value); a Plan may only aggregate transactions whose `currency` matches `reporting_currency`; a transaction in a different currency can still be *attached* to a Plan (for record-keeping/manual note purposes) but is **excluded from budget/variance math** with a visible "N transactions in other currencies not included in totals" UI notice — honest rather than silently wrong, satisfying the spec's "do not silently overwrite/misrepresent" principle even in the reduced-scope version.

### 30. Historical FX Architecture Proposal

**PROPOSED** (only applies if §29's full version is approved). The `transaction_fx_snapshots` table above is written **once**, at the point a transaction is first attached to a currency-aggregating Plan (or, more conservatively, at transaction creation time if `reporting_currency` differs from `transactions.currency` from the outset) — **never rewritten** when current rates change later. A **separate, explicitly-labeled "current valuation"** figure (e.g. "this THB 850 would be ₹X today") may be computed live from the latest `fx_rates` row for display purposes only, always visually distinct from the historical reporting figure, and never persisted. This directly satisfies invariant 15 (§"Critical Financial Invariants") — current FX rates cannot mutate historical FX snapshots because the snapshot table is insert-only per transaction.

### 31. Plan Calculation Architecture

**PROPOSED.** One new module, `packages/domain/application/src/queries/planCalculations.ts` (or `core/src/plans.ts` for the pure math + a thin `application` query wrapper, mirroring the `safeToSpend.ts`/`netWorth.ts` split exactly), houses every formula below as the **single canonical implementation** — Spensa, MCP, and the web UI all call into it; none re-derive:

- `getPlanActualSpending(plan)`: sum of `transactions` where `plan_id = plan.id AND type IN ('expense') AND deleted_at IS NULL AND transfer_pair_id IS NULL`, **grouped by currency** (§29). Explicitly excludes `transfer`, `goal_contribution`, `goal_withdrawal`, and (per spec §28) net of confirmed refunds once §28's refund model is decided. **This directly answers spec §"Plan Actual Spending"'s instruction not to "simply sum every transaction attached to a Plan."**
- `getPlanCommitted(plan)`: sum of linked `planned_commitments`/`planned_commitment_occurrences` not yet paid (via existing `plannedCommitmentsRepo`, filtered to those `commitment_id`s referenced by the Plan's `plan_items`) — never double-counted against actual spending, since a paid occurrence's money is a `transaction`, already counted by `getPlanActualSpending`.
- `getPlanRemaining(plan)`: **two distinct, separately-named outputs** per spec's explicit instruction not to collapse ambiguous formulas — `budgetRemaining = currentBudget - actualSpending` and `availableAfterCommitments = budgetRemaining - committedTotal`. Never merged into one "remaining" number.
- `getPlanVariance(plan)`: `plannedTotal (sum of plan_items.estimated_amount_minor) - actualSpending`, plus a per-category and per-item breakdown reusing the exact same subtraction, exposed identically to Spensa/MCP/UI from this one function.
- `getPlanProjection(plan)`: spending-pace/projected-final-cost — linear extrapolation from `actualSpending / daysElapsed * totalDays`, directly modeled on the existing `calculateGoalPaceStatus`'s linear-pace approach (§18 of the domain report) rather than inventing a new projection technique.

### 32. Goal/Commitment/Upcoming Integration

**PROPOSED**, strictly matching §12/§13/§14 FACTs:
- `plans` may reference `goals` via a new thin join (`plan_goals(plan_id, goal_id)`, many-to-many since the spec allows "one or more Goals," unlike the 1:1 `plan_item`↔transactions direction) — purely a labeling association. **No new money-movement code**; `getGoalProgress` is called as-is and displayed inside the Plan's "Funding" view.
- `plan_items.commitment_id` (§26) links a Planned Item to an existing `planned_commitments` row — when that commitment's occurrence is paid via the existing `pay_commitment_occurrence_atomic` (unchanged), the resulting `transaction.plan_id`/`plan_item_id` should be **auto-set by that same RPC when a commitment occurrence has a linked plan_item** (one small, additive change to that RPC, not a new payment path) — this is the mechanism that prevents "commitment paid = duplicate Plan expense," satisfying invariant 9.
- Plan's "Upcoming" view is a **filtered projection** of the existing `getUpcomingProjection()` output (§14), scoped to events whose underlying commitment/loan is linked to the Plan — new filter parameter on an existing function, not a new upcoming-events engine.

### 33. Safe-to-Spend Integration

**PROPOSED**, directly answering spec §12/§30/§"Safe-to-Spend" (the section explicitly asking this be a "critical review"):
- **Plans do NOT affect Safe-to-Spend by default, at all** — no new reserve field, no new parameter to `calculateSafeToSpend`. This is the only answer consistent with FACT §15 (Safe-to-Spend already has exactly zero notion of sub-grouping) and with the spec's own explicit prohibition on inventing a "Plan reserve" that could double-count against the existing Goal-reserved/commitment-reserved/loan-reserved terms already inside the formula.
- If a user wants a Plan's expected cost to actually protect money, the **existing** mechanism is the correct integration point: link a `Goal` to the Plan (§32) and let that Goal's existing, already-tested reservation semantics do the protecting — **Plans never introduce a competing reservation concept.** This is the direct, literal answer to the spec's demand to "show how the architecture prevents Plan reserve + Goal reserve + Commitment reserve from accidentally reserving the same money twice": there is no separate "Plan reserve" term at all, so there is nothing to double-count.

### 34. Notification Architecture (Plans)

**PROPOSED**, mechanically following §16's FACT pattern exactly — no new engine:
1. Add `PLAN_*` literals to `NotificationEventType` (`messageComposer.ts`) — e.g. `PLAN_STARTING_SOON`, `PLAN_BUDGET_THRESHOLD`, `PLAN_OVER_BUDGET`, `PLAN_ITEM_DUE`, `PLAN_COMPLETED_SUMMARY` (a minimal, materiality-filtered set — not the full 20+ signal list the spec enumerates as *candidates*; see §51 decision on which signals ship in v1).
2. Add corresponding `case` blocks to the existing `switch` — phrasing only, using `getPlanVariance`/`getPlanActualSpending` (§31) pre-calculated numbers, never recalculating in the composer.
3. Add rule functions to `apps/web/lib/notifications/eventRules.ts` following the exact existing threshold/date pattern, each constructing its own `dedupeKey` (e.g. `plan_budget_${pct}_${planId}_${period}`) — reusing the DB-enforced dedupe (§16), not inventing a new one.
4. Call these from `notificationChecks.ts`'s per-user cron loop, or (preferred, matching the `commitmentAutomation.ts` precedent, §"Automation" fact) a new dedicated `apps/web/lib/automation/planAutomation.ts` file for anything Plan-cadence-specific (e.g. "days until Plan start"), keeping the general per-user notification sweep from growing an ever-larger unrelated-domain loop.
5. **Fix the quiet-hours-uses-server-time bug (§16) as a prerequisite, not a Plans-scoped patch** — if left unfixed, every Plan reminder inherits it silently, and fixing it only for Plan events while leaving every other event type on the old (buggy) behavior would itself be a new inconsistency.

### 35. Spensa Integration

**PROPOSED.** Consumption-only, matching §18's FACT constraint exactly: Spensa gets new **read** tools (`getPlanSummary`, `getPlanVariance`, etc.) that call §31's canonical functions — it never recalculates. The genuinely new capability is **research**: a new, clearly-labeled tool (e.g. `proposeAddPlanItem` with an optional `researchMetadata` object) that lets Spensa populate `plan_items.estimate_source='spensa_research'` + `research_metadata` (source, URL, checked timestamp, confidence, assumptions) — this is new tool-calling capability, not an extension of an existing one (§18 GAP confirmed no research tool exists today). **Staleness handling** (spec §19: "if Plan dates change and research becomes stale, flag it") is a derived UI/notification signal (`researched_at` vs. `plan.start_date` delta), not a new schema column beyond `research_metadata.checkedAt` already captured.

### 36. MCP Integration

**PROPOSED**, resolving §19's tool-inventory-duplication FACT explicitly: register Plans tools in **both** `packages/ai/src/tools` and `apps/mcp-server/src/tools` from day one (closing, not inheriting, the existing Spensa/MCP asymmetry — **DECISION REQUIRED** if the team instead wants to accept the existing asymmetry and ship MCP-only first, matching how commitments/loans currently work). Every write is a `propose*` tool → `proposeCommand(ctx, source, "createPlan"|"updatePlan"|..., payload, preview)` → new `CASE` branches added to `confirm_command` — **but only after §19's existing-defect verification is resolved**, since copying the current broken branches' pattern blind would ship the same class of column-name-drift bug into Plans. Read tools (`getPlans`, `getPlanSummary`, etc.) call §31's canonical queries directly, no confirmation needed (matches every existing read tool).

### 37. Security Architecture

**PROPOSED**, following §21's FACT pattern exactly: RLS on `plans`/`plan_items` scoped to `user_id = auth.uid()`; every new SECURITY DEFINER function for Plan writes opens with the mandatory `auth.uid()` check plus independent re-verification that any referenced `goal_id`/`commitment_id`/`transaction_id`/`account_id` belongs to the same user — directly copying the pattern the IDOR-fix precedent (§19/§21) established. MCP/Spensa tool authorization is the existing session-scope (`read`/`write`) check, unchanged. Research URLs (spec §34) fetched by Spensa must go through server-side code only (never client-exposed), and any future FX-provider API key follows the exact existing `AI_PROVIDER_ENCRYPTION_KEY`-style server-only secret convention (CLAUDE.md §17) — no new pattern needed.

### 38. UX/Interaction Architecture

**PROPOSED**, following §22's FACT pattern exactly: one array addition to `PRIMARY_NAV_ITEMS`; `app/plans/page.tsx` → `plans-dashboard.tsx` → sheets/dialogs → `plans/actions.ts`, mirroring Goals/Upcoming precisely. Sub-views (Overview/Budget/Items/Transactions/Upcoming/Research/History) use the existing `cash-flow-tabs.tsx` tab-strip idiom, not a new navigation pattern. **Progressive disclosure** (spec §31, "do not expose all complexity at once") is a UX design decision, not an architectural one — flagged for the design pass in Gate 5, not resolved here.

### 39. Performance Architecture

**PROPOSED.** `getPlanActualSpending`/`getPlanVariance` must aggregate server-side via SQL (`SUM(...) WHERE plan_id = ...`), never fetch every transaction to the client and sum in the browser — matching the existing `listBudgetsWithUsage` batched-aggregation precedent (§24 FACT), not the anti-pattern the spec explicitly warns against. Plan transaction lists (the "Actual Spending" tab) must be paginated — this needs the open question from §24 resolved first (does a paginated transaction-list query pattern already exist to copy, or does Plans need to introduce the first one). **DECISION REQUIRED / needs-verification**, not a confirmed gap.

---

## 40. Complete Edge-Case Matrix

Selected high-value rows (the full adversarial list from the prompt is covered; rows are grouped by theme rather than listed as 80 nearly-identical lines).

| # | Scenario | Expected behavior | Invariant | Domain | Potential failure | Required test | Priority |
|---|---|---|---|---|---|---|---|
| 1 | No budget, no dates, no categories, no items, no transactions | Plan renders as a valid empty shell; all derived numbers show "—"/zero, never an error | Progressive planning (§5) | Plan core | Null-handling crash in a derived-calc function | Unit test: `getPlanVariance(emptyPlan)` returns zero/null gracefully | P1 |
| 2 | Only transactions, no budget/items | Actual spending computes; variance/remaining show "no budget set," not `NaN`/error | §5, §17 | Plan calc | Division-by-zero in projection math | Unit test on `getPlanProjection` with `budget=null` | P1 |
| 3 | Only cash transactions | Sums correctly; no credit/liability logic invoked | Invariant 1 | Plan calc | N/A — simplest case | Regression test | P2 |
| 4 | Only credit-card transactions | Spending counted; liability increases via existing `credit_used_minor` path; Plan never touches liability directly | Invariant 4–6 | Accounts/Plan | Plan code accidentally re-implements liability math | Integration test asserting `credit_used_minor` unchanged by plan attach/detach | P0 |
| 5 | Only foreign currency | **Blocked today** unless §29 approved — see §10/§29 | Multi-currency | Currency | Silent wrong aggregation if `Money.add` bypassed | Unit test: mixed-currency attach either throws cleanly or groups correctly, never silently sums | P0 |
| 6 | Bank→Forex Card→foreign spend | **Cannot execute via existing `transfer()` today** (`currency_mismatch`) | §29 | Currency/Accounts | New command needed; must not be misclassified as spending | Integration test on the new funding command, once built | P0 |
| 7 | Bank→Credit Card repayment | Excluded from Plan spending; reduces liability + cash via existing `transfer` | Invariant 2–3, 7 | Accounts/Plan | Plan naively sums all attached transactions including this transfer | **Mandatory Thailand test**, assertion 3 | P0 |
| 8 | Multiple credit cards / multiple forex cards | Aggregation is per-transaction, account-agnostic; no per-account special-casing needed | Multi-account (§7 of spec) | Plan calc | Hidden assumption of "one payment account per Plan" | Property test: attach transactions from N accounts, total is a plain sum | P1 |
| 9 | Payment source changes mid-Plan | No special handling needed — each transaction is independently attached | Multi-account | Plan/Transaction | N/A if §28 model followed correctly | Regression test | P2 |
| 10 | Linked account deleted | `accounts.deleted_at` is currently **unused/dead** (§9 FACT) — no command deletes accounts today, only archives; Plan's linked transactions are unaffected by archival | §9 | Accounts | Plan code assumes account rows are hard-deletable | Verify `archive_account` never nulls `transactions.account_id` | P2 |
| 11 | Credit card replaced | New account, old transactions keep pointing at the old (archived) account; Plan totals unaffected | §8 | Accounts/Plan | N/A if FK integrity holds | Regression test | P2 |
| 12 | Plan starts in past / today / tomorrow / already ended | All valid; only affects derived "upcoming" filtering, never historical transaction validity | §16 | Plan lifecycle | Notification engine fires "starting soon" for a past-start Plan | Unit test on date-comparison boundary in `planAutomation.ts` | P1 |
| 13 | Plan created after event (retroactive) | Must not generate pre-event notifications for dates already past | Spec §16 explicit | Notifications | Naive "days until start" cron fires a backdated reminder | Unit test: `createdAt > startDate` suppresses all pre-event signal types | P0 |
| 14 | Plan postponed/extended/shortened | Only future derived state (upcoming events, notifications) recalculates; historical transactions/FX snapshots never touched | Invariant 13, 15 | Plan lifecycle | Date-change code accidentally re-triggers `transaction_fx_snapshots` recompute | Property test: changing `plans.start_date`/`end_date` produces zero writes to `transactions`/`transaction_fx_snapshots` | P0 |
| 15 | Budget added after spending / reduced below actual / removed | Never blocks transactions; variance goes negative and displays honestly | Spec §17 explicit | Plan calc | UI hides or clamps negative variance | Unit test: negative variance renders, is not clamped to zero | P1 |
| 16 | Category added/removed after spending | Existing `categories` archive-and-reassign convention (§9 FACT) applies unchanged; Plan-item category variance recomputes from current linkage | §9, §27 | Categories/Plan | Orphaned `category_id` on an old plan_item | Regression test using existing category-archive command | P2 |
| 17 | Planned item added after actual payment / cancelled after partial payment | Item status becomes `cancelled` but linked transactions are untouched (money already spent is still real) | Invariant 10, 14 | Plan item | Cancelling an item accidentally soft-deletes its transactions | Unit test: cancel command touches only `plan_items` row | P0 |
| 18 | Multiple payments for one item / partial / full / overpayment | All are just multiple `transactions.plan_item_id` rows; sum naturally shows overpayment as positive variance | §14, §27 | Plan item | N/A if one-to-many model (§27) holds | **Hotel 3-payment test**, explicit unit test | P0 |
| 19 | Refund / partial refund / reimbursement | **GAP — no existing canonical model** (§28); until decided, refunds must not be modeled as an arbitrary negative expense without a documented convention | Spec §28 explicit | Transactions | Ad-hoc negative-amount hack breaks `amount_minor > 0` CHECK constraint | **DECISION REQUIRED** before any test can be written | P0 — blocks §28 |
| 20 | Duplicate transaction / edited / deleted / reassigned to another Plan | Existing `update_transaction`/`delete_transaction` RPCs already handle edit/delete correctly for non-Plan fields; reassignment is a plain `plan_id` update (§28) | §7, §28 | Transactions | Reassignment race with a concurrent detach | Concurrency test (row 27 below) | P1 |
| 21 | Plan deleted / archived | Never deletes transactions (FK `ON DELETE SET NULL` or archival-only, §28) | Invariant 14 | Plan | Cascade misconfigured to `ON DELETE CASCADE` | **Explicit migration-level test**: attempt Plan deletion, assert transactions survive | P0 |
| 22 | Goal linked/unlinked/completed/deleted | Plan-goal link is a pure label (§32); Goal's own lifecycle (§12 FACT) is untouched by Plan state | Invariant 8 | Goals/Plan | Plan code writes to `goals.saved_amount_minor` directly | Unit test: linking/unlinking a Goal never touches `goals` financial columns | P0 |
| 23 | Commitment linked/paid/skipped | Paid commitment's transaction auto-tags `plan_id` (§32); skipped commitment is just a status, no Plan-side effect needed | Invariant 9 | Commitments/Plan | Double-counting if both the commitment's own "paid" total and the Plan's "actual spending" independently sum the same transaction as two different line items in a combined view | UI/aggregation test: a paid, plan-linked commitment appears once in Plan totals, not twice (once as "commitment paid" and once as "expense") | P0 |
| 24 | Account deleted while attaching a transaction | FK constraint prevents orphaned `account_id`; attach command re-validates account ownership at call time (matches §19 pattern) | Concurrency | Plan/Accounts | TOCTOU race between validation and insert | Concurrency test with simulated interleaving | P1 |
| 25 | FX rate unavailable / delayed / corrected later | **GAP until §29 approved.** Once built: missing rate blocks *reporting conversion only*, never blocks the underlying transaction; corrected rates never touch historical `transaction_fx_snapshots` rows already written (append a new snapshot with a `superseded_by`/`corrected_at` marker instead of overwriting) | Invariant 15 | FX | Silent overwrite of historical rate | Unit test: rate correction produces a new row, old row untouched | P0 (once Gate 4 exists) |
| 26 | Transaction timezone differs from user/Plan timezone | `transactions.occurred_at` is a `date`, not a `timestamptz` (§7 FACT) — there is **no time-of-day** stored on a transaction today, only a date, which sidesteps most timezone-attribution ambiguity for the transaction itself; Plan-level "which day did this fall in" questions use the Plan's own `timezone` field (§26) for boundary interpretation of `expected_date`/notification firing only | §23 | Timezone | Assuming `occurred_at` needs timezone conversion when it's already a plain date | Verify against real `transactions.occurred_at` column type before building any Plan timezone logic | P1 — resolves a likely-unnecessary complexity |
| 27 | Concurrent Plan edits / concurrent transaction attachment / concurrent budget updates | Postgres row-level locking on `UPDATE ... WHERE id = $id` is sufficient for last-write-wins on `plans`; attach/detach uses the same `SELECT...FOR UPDATE` pattern `confirm_command` already establishes if routed through it, or a plain optimistic `updated_at` check if done via direct Server Action | Concurrency | Plan | Lost-update on simultaneous budget edits from two tabs | Concurrency test: two simultaneous `updateBudget` calls, assert one wins cleanly, no corrupted intermediate state | P1 |
| 28 | MCP confirmation retried / response lost after DB commit | **Already solved structurally by `confirm_command`'s row-lock + single-use status** (§19 FACT) — Plans inherits this for free by using the same RPC | Invariant (spec §25) | MCP | A Plans write bypasses `confirm_command` and implements its own ad-hoc retry logic | Reuse the existing MCP idempotency test pattern, applied to Plan command types | P0 |
| 29 | Spensa proposes wrong Plan association / hallucinates values | Propose-only pattern (§18 FACT) means nothing writes without human confirmation; the confirmation *preview* must show enough detail (which Plan, which item, amount) for a human to catch a wrong association before approving | §20 | Spensa | Preview text too terse to catch a subtly-wrong `plan_id` | UI/copy review + a test asserting the preview always includes the target Plan's name, not just its id | P1 |
| 30 | Quiet hours / duplicate notification / multiple simultaneous signals | DB-enforced dedupe (§16 FACT) already prevents duplicate sends; quiet-hours bug (§16) must be fixed first or Plan reminders inherit it | §22 | Notifications | Multiple Plan signals firing back-to-back without aggregation | Test: two Plan threshold crossings in one evaluation cycle produce consolidated, not duplicate, notifications — needs a new aggregation rule, since none exists generically today (**GAP**, not just a test gap) | P1 |

---

## 41. Migration Strategy

**PROPOSED.** Follow existing convention exactly (§2, §21 of CLAUDE.md): one additive migration per logical change, `YYYYMMDDNNNNNN_description.sql`, never editing an applied migration. Suggested sequencing for Gate 2 (schema-only, no app code): (1) `plan_status`/`plan_item_status`/`plan_item_estimate_source` enums + `plans` table + RLS; (2) `plan_items` table + RLS + FK to `plans`/`categories`/`planned_commitments`; (3) `plan_goals` join table + RLS; (4) `transactions.plan_id`/`plan_item_id` nullable columns + indexes (a single `ALTER TABLE ADD COLUMN ... NULL`, zero-downtime, no backfill needed since every existing row correctly defaults to `NULL` = "no Plan," which is valid per §5/§28). **No destructive changes, no backfill migration required for MVP.** FX tables (§29/§30) are a separate, later migration set gated on the currency decision.

## 42. Testing Strategy

**PROPOSED**, matching §23 FACT conventions exactly: co-located `*.test.ts`/`*.test.tsx`; jest-axe on every new UI component; pure-function tests for every canonical calculation in §31 with no mocking; `eventRules.ts`-style mocked-collaborator tests for new notification rules; multi-timezone tests for any Plan date/reminder logic (reuse the existing IST/EDT/EST/BST/SGT/AEST fixture set, §23 FACT); RLS tests following the existing `security_smoke.sh` pattern (positive + negative ownership cases per §21); the **mandatory Thailand scenario** as a deterministic integration test asserting exactly which of the 7 transactions count toward Plan actual spending (only #1, #2, #6-if-currency-resolved contribute; #3 and #7 never do; #4/#5/#6 are blocked/gapped per §40 row 5–6 until Gate 4). Concurrency/idempotency tests reuse the `confirm_command` row-lock pattern verification already established for other command types (§19).

## 43. Observability Strategy

**PROPOSED.** No existing observability/APM tooling was identified by the research agents beyond Microsoft Clarity (client-side, explicitly non-financial, §16 of CLAUDE.md) and Vercel's own function logs. **GAP:** there is no structured server-side logging/metrics convention visible in the areas reviewed for tracking e.g. "how many Plan writes failed confirm_command," "how many notification signals were suppressed by materiality filtering." **DECISION REQUIRED:** does Plans introduce the first real observability convention for the app (e.g. structured `console.error`/log lines with a consistent shape, or a new lightweight metrics table), or is this out of scope and deferred entirely? Given no existing pattern to extend, this is genuinely new ground, not a Plans-specific choice — recommend keeping Plans' initial observability to "reuse whatever Vercel/Supabase logs already capture" and not building bespoke tooling in Gate 0–3.

## 44. Deployment Strategy

**FACT + PROPOSED.** Existing deployment is auto-deploy-on-push-to-`main` via Vercel, with **no CI test gate** (§2 GAP). **PROPOSED for Plans specifically, given the financial stakes:** manually run `pnpm typecheck && pnpm lint && pnpm test` locally/in a PR before merging any Plans gate to `main`, since no automated gate exists to do this for you — this is a process recommendation, not a code change. Schema migrations apply to local Supabase first, then production, per existing convention (§21 CLAUDE.md) — never directly to production.

## 45. Rollback Strategy

**PROPOSED.** Additive-only migrations (§41) mean rollback of a bad Plans deploy is primarily a Vercel instant-rollback-to-previous-deployment operation (existing platform capability) — the new `plans`/`plan_items` tables and nullable `transactions` columns are inert (never read) if the app code referencing them is rolled back, so no destructive down-migration is needed for MVP. **DECISION REQUIRED:** if a Gate ships a `confirm_command` branch for Plans and it needs to be pulled, the existing pattern (§19) shows this function has been redeployed via `CREATE OR REPLACE FUNCTION` multiple times already — a rollback migration re-applying the previous function body is the established, safe pattern to follow.

## 46. Risks

1. **P0 — confirm_command's live-schema mismatch (§19/§47) is unverified against the real database.** If real, it silently blocks `proposeCreateGoal`/`proposeCreateBudget` today and would silently break naively-copied Plans branches.
2. **P0 — zero FX infrastructure (§10/§29).** The single biggest scope driver for whether "Plans" as specified can ship in one gate sequence or needs a large new foundational gate first.
3. **P1 — quiet-hours timezone bug (§16)** will silently affect Plan reminders if not fixed as a prerequisite.
4. **P1 — no CI test gate (§2/§44)** means a Plans regression can reach production without being caught mechanically.
5. **P1 — `goal_contribution_plans` naming collision (§12)** risks real user confusion if not deliberately differentiated in product copy before Gate 5 UX work starts.
6. **P2 — three coexisting soft-delete conventions (§9)** risk Plans inventing a fourth if §25's single-convention recommendation isn't explicitly adopted.
7. **P2 — commitments/loans mutations living outside the `commands/` convention (§4)** is a precedent Plans could mistakenly copy, compounding existing inconsistency.
8. **P2 — unverified pagination story for large transaction lists (§24/§39)** could become a real performance problem for high-volume Plans (e.g. a multi-month renovation project) if not resolved before Gate 7.

## 47. Existing Contradictions

- **`confirm_command`'s commitments/loans-era branches reference nonexistent columns** for goals/budgets/categories/bills/commitments (full detail §19; source: schema research §3). This directly contradicts CLAUDE.md's own stated invariant that "financial correctness rules... must be preserved across every code change" — flagged as a genuine, pre-existing contradiction between documented intent and shipped code, unrelated to Plans, that the team should independently verify and fix.
- **CLAUDE.md documents a responsive mobile bottom-bar that does not exist in code** (§22) — a documentation/reality contradiction, low financial risk, but relevant to the "mobile-ready" goal of the Plans UX spec.
- **`packages/domain/application` bypasses its own stated infra-repo-per-table convention** for credit-card obligations/links (§4/§9 domain report) — the codebase's own CLAUDE.md describes infra as "each repo wraps one DB table or RPC," which these call sites don't follow.

## 48. Missing Infrastructure

1. **FX/exchange-rate infrastructure** (§10, §29, §30) — does not exist at all.
2. **Refund/reimbursement canonical model** (§28) — does not exist at all; even the base transaction model has no refund concept today, "no negative-expense hack" guardrail is currently unenforced (nothing stops `amount_minor` being misused, though the CHECK constraint requiring `>0` would actually reject a naive negative-amount refund attempt outright — worth confirming this is understood as a feature, not something to "fix around").
3. **Spensa research tooling** (§18, §35) — no web-search/external-lookup tool exists in the Spensa tool registry today.
4. **Generic observability/metrics convention** (§43) — nothing beyond Vercel/Supabase platform logs.
5. **CI pipeline** (§2, §44) — no `.github/workflows`, no automated test gate before deploy.
6. **Notification signal aggregation/consolidation** (§40 row 30, spec §22) — the existing engine dedupes identical repeated signals but has no cross-signal consolidation ("3 things happened, send one digest") mechanism.
7. **Credit-card-obligation generation logic** (§9 schema fact) — table/RLS exist, no migration-visible generator; needs live verification.

## 49. Open Questions

1. Is the `confirm_command` schema-mismatch finding (§19/§47) already known/fixed in the live database, or genuinely live in production? (Needs a live-schema check outside this read-only discovery's scope.)
2. Does `credit_card_payment_obligations` actually get populated anywhere (app-layer/edge function not covered by the migrations review), or is it dormant/unused today?
3. Is there an existing paginated-transaction-list query pattern anywhere in the app that the research agents' scope didn't happen to cover (§24/§39)?
4. What is the intended behavior for `transactions.status='pending'` (vs. `posted`) transactions with respect to Plan totals — was this status value ever examined by existing Cash Flow/Budget calculations, and should Plans follow the same treatment?

## 50. Product Decisions Required

1. **Multi-currency scope for v1** (§10/§29) — full historical-FX support (large, new Gate 4) vs. single-reporting-currency v1 with honest exclusion messaging for other currencies.
2. **Naming** to avoid the `goal_contribution_plans` ("Contribution Plan") collision (§12) — table/route/UI-copy identity for the new concept.
3. **Refund/reimbursement/shared-expense semantics** (§28) — no existing convention to extend; must be designed from scratch, and the design choice affects `getPlanActualSpending`'s formula (§31).
4. **Which of the ~20 candidate notification signals actually ship in v1** (§34/§51) — the spec explicitly enumerates far more signals than any v1 should ship at once, per its own "do not spam users" instruction.
5. **Can a draft Plan with zero transactions be hard-deleted, or only ever archived** (§25)?
6. **Should custom Plan-specific categories be allowed, or strictly reuse the existing global/user category system** (§27) — recommended: reuse only, but this is the team's call, not an architectural constraint.

## 51. Engineering Decisions Required

1. **Register Plans tools in both `packages/ai/src/tools` and `apps/mcp-server/src/tools` from day one, or MCP-only initially** (§19/§36), matching vs. deliberately breaking the existing commitments/loans asymmetry.
2. **Fix or work around the live `confirm_command` schema-mismatch bug (§19/§47) before or independently of building Plans' own branches** — recommend independent, immediate verification/fix regardless of Plans timeline.
3. **Adopt the `commands/` convention properly for any new Plan mutation code, rather than repeating the `queries/`-folder-mutation precedent** (§4) — recommended as a clean break, not a perpetuation of existing debt.
4. **Fix the quiet-hours server-time-vs-user-timezone bug (§16) as a prerequisite to Gate 9**, or explicitly accept Plan reminders inheriting the existing bug.
5. **Where does FX-rate-fetching code live and which external provider is used** (§29) — a genuinely new integration decision with real vendor/cost/reliability implications, not resolvable from existing code.

## 52. Recommended Implementation Gates

Matches the gate structure specified by the task, with purpose/primary risk/exit criteria per gate (full per-gate detail in §53).

| Gate | Purpose | Key Dependency | Primary Risk | Exit Criteria |
|---|---|---|---|---|
| 0 | Discovery & architecture (this document) | — | Decisions deferred indefinitely | This report reviewed and its DECISION REQUIRED items answered |
| 1 | Domain model + financial invariants (no UI, no live migrations applied to prod) | Gate 0 decisions on §50/§51 | Building on unverified `confirm_command` assumptions | Domain types + pure calculation functions + full test suite (§40 matrix) pass locally; **no schema applied to production yet** |
| 2 | Database schema, constraints, RLS, migrations | Gate 1 domain model finalized | Schema drift vs. domain types | Migrations applied to local Supabase, RLS positive/negative tests pass, `conformance` script clean for new code |
| 3 | Domain/application services + canonical calculations wired to real repos | Gate 2 schema live locally | Duplicating an existing formula instead of reusing (§31) | `getPlanActualSpending`/`getPlanVariance`/etc. pass the Thailand test and all §40 rows applicable without currency |
| 4 | Currency & historical FX foundation | Gate 0 decision on §50.1 | Building Plans-only FX logic (anti-pattern) | `fx_rates`/`transaction_fx_snapshots` exist as shared infra, not Plans-scoped; Thailand test's currency-blocked rows (§40 rows 5–6) now pass |
| 5 | Plan creation/editing UX | Gates 1–3 | Exposing complexity too early (spec §31) | Create/edit flows for draft→active Plans with zero required fields beyond name; accessibility parity with existing Goals/Bills flows |
| 6 | Planned items + transaction association | Gate 5 | Violating invariant 13 (attach changes transaction fields) | Attach/detach/reassign commands pass property tests (§40 row 21, "attach changes only plan_id") |
| 7 | Plan analytics & aggregation | Gate 6 | Client-side summation of large transaction sets (§39) | Server-side aggregation confirmed via query-plan/EXPLAIN check; pagination resolved (§49.3) |
| 8 | Goals/commitments/Upcoming integration | Gate 7, Gate 0 decision on Goal-linking cardinality | Double-counting a paid, linked commitment (§40 row 23) | Explicit no-double-count test passes |
| 9 | Notifications & Telegram | Gate 8, quiet-hours bug fixed (§51.4) | Notification spam / duplicate sends | Dedupe + materiality filtering tests pass; consolidated-signal test (§40 row 30) passes or is explicitly deferred with rationale |
| 10 | Spensa planning/research/intelligence | Gate 9 | Spensa hallucinating financial truth | Every Spensa-authored `plan_item` carries `estimate_source='spensa_research'` + full metadata; propose-only enforced |
| 11 | MCP | Gate 10, Gate 0 decision on §51.1 | Copying a broken confirm_command branch pattern | New Plan `confirm_command` branches independently schema-verified against live `database.types.ts`, not just written by analogy |
| 12 | Performance, accessibility, security, observability | Gate 11 | Regressing existing a11y/perf bar | jest-axe clean on every new component; large-Plan load test; RLS penetration-style negative tests |
| 13 | Full QA & adversarial testing | Gate 12 | Missing an edge case from §40 | Every row in §40's matrix has a passing, named test |
| 14 | Production migration, deployment, live verification | Gate 13 | Deploying without a CI gate (§2/§44) | Manual `typecheck`/`lint`/`test` run and green before merge; smoke test on production post-deploy |

## 53. Definition of Done Per Gate

Applies uniformly to every gate above — no gate is "done" on compilation alone:
- [ ] Implementation matches this report's approved proposal (or an explicitly documented deviation with rationale)
- [ ] All financial invariants relevant to that gate's scope have a passing automated test (not just manual verification)
- [ ] No regression in existing Accounts/Transactions/Credit Cards/Budgets/Goals/Commitments/Upcoming/Safe-to-Spend/Net Worth/Notifications/Telegram/Spensa/MCP behavior (full existing suite green)
- [ ] RLS positive AND negative (cross-user access denied) cases tested where the gate touches new tables/columns
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean
- [ ] Accessibility (`jest-axe`) clean for any new UI component
- [ ] No known P0/P1 defect shipped silently — anything found is either fixed within the gate or explicitly carried forward in the gate's own report as a named limitation
- [ ] Gate's own report produced (what shipped, what didn't, decisions still open) before starting the next gate

## 54. Final Architecture Recommendation

Spencare's existing domain layer, notification engine, MCP propose/confirm pattern, and commitments/loans subsystem are mature and well-suited as a foundation for Plans — this is not a codebase requiring a rewrite to support the feature. The two things standing between "ready to implement" and "actually implement": (1) an explicit, human decision on multi-currency scope for v1 (§10/§29/§50.1), because the gap there is real, foundational, and affects the base platform, not just Plans; and (2) independent verification (outside this read-only review's scope) of whether the `confirm_command` schema-mismatch finding (§19/§47) is live in production today, since Plans' own MCP write path depends on extending that exact function safely. Neither of these blocks *starting* Gate 1 (pure domain model + invariants, no schema, no UI) — both must be resolved before Gate 2 (schema) and Gate 11 (MCP) respectively.

## 55. Self-Critique / Missed-Risk Review

1. **What did we probably miss?** Live database state was never queried — every finding about `confirm_command`'s correctness, `credit_card_payment_obligations`' population, and RLS policy completeness is based on migration *source*, which could have drifted from the applied state (e.g. a since-fixed bug applied directly via the Supabase dashboard rather than a new migration file, or a hotfix migration not yet reflected in what was read). **Recommend a live schema/function introspection pass before Gate 2.**
2. **What existing implementation did we assume without verifying?** Whether a paginated transaction-list query pattern exists anywhere (§24/§49.3) — the research agents' scope did not exhaustively cover every transaction query in the app; this is marked as an open question, not a confirmed gap, precisely because of this uncertainty.
3. **Where could Plans create duplicate financial truth?** The clearest risk is a future engineer treating `plan_items.estimated_amount_minor` or `plans.current_budget_minor` as spendable/reservable money and wiring it into Safe-to-Spend — explicitly forbidden by §33, but nothing in the schema itself prevents a future PR from doing this; this needs to remain a code-review-enforced rule, not just a documented one.
4. **Where could currencies be incorrectly aggregated?** Any code path that calls `Money.add` across two `plan`-linked transactions of different currencies would throw today (a safe failure) — the actual risk is a future engineer "fixing" that crash by converting to raw numbers instead of building the proper `transaction_fx_snapshots` path, silently reintroducing float/precision bugs.
5. **Where could historical FX be overwritten?** Only if §30's "insert-only, never update" rule for `transaction_fx_snapshots` is violated by a future "just fix the wrong rate" convenience PR — worth a DB-level `UPDATE` trigger that rejects mutation of that table entirely (insert/select only), not just an application convention.
6. **Where could credit-card repayment become double spending?** Only if a future Plan-attach UI lets a user manually attach a `transfer`-type transaction to a Plan and the aggregation query doesn't filter `type != 'transfer'` — §31's proposed formula explicitly filters this, but it's a single `WHERE` clause away from being silently broken by a careless edit.
7. **Where could forex-card funding become double spending?** Same class of risk as #6 — the moment §29's new `fundForeignAccount` command exists, if it's ever miscategorized as an `expense` instead of its own type, it would double-count. This argues for a genuinely distinct `transaction.type` value for currency-exchange funding, not reusing `transfer` loosely.
8. **Where could Goal funding become double spending?** Already structurally prevented (`type='goal_contribution'` is excluded from `getPlanActualSpending`'s filter, §31) — the risk is purely in someone editing that one filter incorrectly later; a named, tested invariant (§40 row 22) is the mitigation, not a schema constraint (schema can't express "this money is a Goal contribution, never Plan spending" on its own).
9. **Where could commitments become duplicate expenses?** Addressed in §40 row 23 — the real subtlety is a *display* double-count (showing the same paid transaction once under "Commitments" and once under "Plan spending" in a combined dashboard view) even though the underlying total is correct; this is a UX/aggregation-presentation risk, not a data-model risk, and should be explicitly tested at the UI layer in Gate 12, not just the calculation layer.
10. **Where could notifications spam users?** The candidate signal list (§21 of the product spec) is large; without an explicit v1 cut-down decision (§50.4), a naive "implement every signal" approach would violate the spec's own "do not spam" instruction on day one.
11. **Where could Telegram duplicate messages?** Only if a new Plan automation file bypasses `deliverNotification()`'s dedupe and calls `sendTelegramMessage` directly — the existing architecture makes this a deliberate opt-out, not an easy mistake, but it's worth a lint/review rule ("never import `telegramProvider.ts` outside `engine.ts`") if this hasn't already been enforced.
12. **Where could MCP confirmation duplicate writes?** Already structurally prevented by the row-lock (§19) — the only residual risk is a Plans command type whose *inline* SQL branch (rather than delegating to an existing atomic RPC) has a bug that partially applies before erroring, since Postgres transactional rollback should prevent this, but the §47 finding shows this codebase has shipped column-name bugs in exactly this kind of inline branch before — extra scrutiny/testing warranted specifically for any inline (non-delegated) Plan branch.
13. **Where could RLS leak another user's Plan?** Standard cross-user negative-test coverage (§21/§42) is the mitigation; the specific new risk is `plan_items`/`transactions.plan_id` joins in a query that forgets to also filter `user_id` on the joined side (relying solely on the FK's existence, not RLS) — every new Plan query should filter by `user_id` explicitly at every joined table, not rely on RLS alone for defense-in-depth, matching the existing SECURITY DEFINER discipline (§21).
14. **Where could Plan deletion destroy financial history?** Mitigated by making Plan deletion draft-only and archival otherwise (§25/§28) — the residual risk is a future engineer adding a "delete Plan" button for non-draft Plans without re-reading this constraint; recommend enforcing "cannot hard-delete a Plan with any attached transaction" as a database CHECK/trigger, not just an application-layer guard.
15. **Where could Plan date changes corrupt historical reporting?** Mitigated by keeping `transaction_fx_snapshots`/`transactions` entirely untouched by date-field updates on `plans` (§28/§30) — residual risk is a future "recalculate everything on date change" convenience feature that naively re-derives FX snapshots; should be explicitly forbidden in code review, not just architecturally implied.
16. **Where could Spensa hallucinate Plan values?** Mitigated by propose-only + `estimate_source` tagging (§35) — residual risk is a *preview* that doesn't clearly show which numbers are Spensa-estimated vs. real, letting a user accidentally confirm a hallucinated figure as if it were fact; this is a UX/copy risk in Gate 10, not purely an architectural one.
17. **Where could large Plans become slow?** §39/§49.3's open pagination question is the direct risk — this needs resolving before Gate 7, not discovered during a performance incident after launch.
18. **Where could mobile implementation later become blocked?** The documentation/reality gap found in §22 (no actual responsive nav exists today) means Plans' "primary nav item" work happens against a *smaller* existing mobile foundation than CLAUDE.md implies — this isn't something Plans breaks, but it means "mobile-ready" for Plans specifically is bounded by a pre-existing, unrelated gap in the base app that nobody has closed yet.
19. **Which product decisions are still ambiguous?** All six items in §50 — most load-bearing is §50.1 (multi-currency scope), since it changes the size of Gates 4/6/7/11 substantially.
20. **Which architectural decisions should NOT be made until those are resolved?** Any concrete `plan_items`/`transaction_fx_snapshots` schema DDL should not be finalized/applied (Gate 2) until §50.1 is answered; any `confirm_command` branch for Plans should not be written (Gate 11) until §51.2's live-verification is done; any notification event-type list should not be finalized (Gate 9) until §50.4's v1 signal cut-down is agreed.

---

## Final Status Block

```
ARCHITECTURE STATUS:
PASS

IMPLEMENTATION READINESS:
NOT READY (Gate 1 may begin on the domain-model/invariants layer only; Gate 2 schema work and Gate 11 MCP work are explicitly blocked — see below)

P0 BLOCKERS:
- Multi-currency/FX architecture does not exist anywhere in the app (§10, §29). 3 of 7 transactions in the mandated Thailand test cannot be represented by current accounting primitives. Blocks any Plan feature that aggregates spend across currencies (Gate 4 required first).
- confirm_command's live-schema correctness for goal/budget/category/bill/commitment branches is unverified against the actual production database (§19, §47) — found via source-vs-generated-types cross-reference, not a live query. Must be verified before Plans extends this function (blocks Gate 11).
- No canonical refund/reimbursement model exists anywhere in the base transaction model (§28, §50.3) — blocks finalizing the Plan Actual Spending formula (§31) for any Plan involving refunds.

P1 BLOCKERS:
- Quiet-hours notification logic uses server local time, not user timezone (§16) — should be fixed before Plan reminders are built on top of it (Gate 9).
- No CI test gate exists before production deploy (§2, §44) — process risk for every gate, not just Plans.
- Naming collision between the proposed "Plans" concept and the existing, live "goal_contribution_plans" (Contribution Plan) feature is unresolved (§12, §50.2).
- Unverified whether a paginated large-transaction-list query pattern exists to reuse (§24, §39, §49.3) — needed before Gate 7.

DECISIONS REQUIRED:
- Multi-currency scope for v1 (§50.1)
- Naming to avoid the Contribution Plan collision (§50.2)
- Refund/reimbursement/shared-expense semantics (§50.3)
- Which notification signals ship in v1 (§50.4)
- Hard-delete vs. archive-only for zero-transaction draft Plans (§50.5)
- Custom Plan-specific categories vs. reuse-only (§50.6)
- Plans tool registration in both MCP surfaces vs. MCP-only initially (§51.1)

FOUNDATIONAL GAPS:
- FX/exchange-rate infrastructure (§10, §29, §30, §48.1)
- Refund/reimbursement canonical model (§28, §48.2)
- Spensa research/external-lookup tooling (§18, §35, §48.3)
- Generic observability/metrics convention (§43, §48.4)
- CI pipeline / automated pre-deploy test gate (§2, §44, §48.5)
- Credit-card-obligation row generation logic unverified (§9, §48.7)

HIGH-RISK AREAS:
- confirm_command's inline (non-delegated) SQL branches, given their documented history of column-name drift (§19, §47, self-critique #12)
- Any future code that bypasses Money's currency-mismatch guard "to make aggregation work" (self-critique #4)
- Presentation-layer double-counting of a paid, Plan-linked commitment even when the underlying total is correct (§40 row 23, self-critique #9)
- Mobile nav, given the documentation/reality gap already present in the base app (§22, self-critique #18)

RECOMMENDED NEXT GATE:
Gate 1 — Domain model + financial invariants, scoped to pure domain types and canonical calculation functions only (no schema migrations applied, no UI). Gate 2 (schema) should not start until Decisions Required items 1–3 and 5–6 above are answered; Gate 11 (MCP) should not start until the confirm_command live-schema verification (P0 blocker 2) is resolved.

DO NOT IMPLEMENT YET:
- Any multi-currency/FX schema or code (pending §50.1)
- Any confirm_command branch for Plans (pending §51.2 live verification)
- Any refund/reimbursement transaction modeling (pending §50.3)
- Full notification signal set (ship only the v1 cut-down once §50.4 is answered)
- Plan-specific UI polish/navigation beyond the minimal scaffold needed for Gate 1's own tests

REPOSITORY MODIFIED:
NO (this report file, docs/phase-40/plans-gate0-architecture-assessment.md, is the only file added; it is documentation, not source/schema/config)

DATABASE MODIFIED:
NO

PRODUCTION MODIFIED:
NO

DEPLOYED:
NO
```

# Phase 29 — Financial Model + Safe-to-Spend UX + Multi-AI Brain + MCP Production Readiness: Final Report

**Mandate:** tighten Spencare's financial model (reversing the short-lived Phase 28 Safe-to-Spend override), make the Safe-to-Spend/Owned-Money/Available-Credit/Investments/Net-Worth distinction immediately understandable across Home and Cash Flow, make Spensa genuinely provider-agnostic across Claude/OpenAI/Gemini, and assess MCP's production readiness — without regressing anything, without inventing financial logic, and without deploying anywhere unauthorized.

**Status language:** IMPLEMENTED (code changed, tested), VERIFIED (automated test actually run and passing), LIVE VERIFIED (exercised by hand in a running browser against real data), NO CHANGE REQUIRED (already correct), NOT SUPPORTED (deliberately unsupported, documented why), DEFERRED (a real gap, disclosed, not fabricated as done).

---

## 0. Non-negotiable project safety — VERIFIED

- Git HEAD at start: `f6c6c4a`. Working tree clean except the two pre-existing, never-committed directories (`.claude/`, `packages/domain/infra/src/generated/`) disclosed in every prior phase's report.
- Baseline regression run before any change (§0's own requirement): `pnpm typecheck`/`build`/`test` — 21 turbo tasks, all green.
- No file outside this mandate's scope was modified.
- **Netlify: no action taken, none attempted.** This repository has no linked Netlify site (`netlify status` was never run against a real account; the Netlify CLI itself isn't installed in this environment) and no git remote at all — it has never been pushed anywhere. `netlify.toml` exists and targets `apps/web`, but connecting/deploying to `spencare-alpha` (or anywhere else) requires the user's own Netlify authentication and explicit deploy action, neither of which this phase performed or could perform safely. `santhosh-design`/`santhoshdesign.com` were never referenced, touched, or at risk.
- No production credentials, Google OAuth credentials, or provider API keys were fabricated anywhere. No secret was logged (see §15/§28 on the provider-key-validation logging added in the same session, which explicitly never logs the key itself).

## 1. Authoritative product rules — applied as the new authority

The account-model source-of-truth restated in this mandate (Bank/Cash = owned money; Credit Card = borrowed capacity, `available = limit - used`, never owned cash; Investment = Net Worth only, never Safe-to-Spend; Goals/Budgets/Bills affect Safe-to-Spend; Safe-to-Spend never negative in the no-budget/no-goals base case) is now the implemented behavior — see §3-§5.

## 2. Forensic audit — performed before implementation

Read (not assumed from prior reports) before any change: `packages/domain/core/src/{accountCapabilities,safeToSpend,netWorth}.ts`, `packages/domain/application/src/queries/safeToSpend.ts`, `apps/web/app/cash-flow/cash-flow-overview.tsx`, `apps/web/app/home/{page,home-content}.tsx`, `packages/ai/src/{provider,resolver,systemPrompt,context}.ts`, `packages/ai/src/adapters/anthropicAdapter.ts`, `packages/ai/src/tools/readTools.ts`, `apps/mcp-server/src/tools/readTools.ts`. Confirmed live (not assumed) that `ACCOUNT_CAPABILITIES.credit_card.safeToSpendEligible` was `true` (the Phase 28 override, still in effect) before this phase's reversal.

## 3. Central account-capability model — NO CHANGE REQUIRED to its shape, ONE FLAG REVERSED

`packages/domain/core/src/accountCapabilities.ts` already existed (Phase 28) as the one authoritative capability matrix. Extended per this mandate's own instruction to "use the existing capability model... extend it rather than creating a second model" — no second model was created. The single behavioral change: `credit_card.safeToSpendEligible` flips from `true` back to `false`. Every other capability (expenseSource, goalFunding, netWorthLiability, etc.) is unchanged and already matched this mandate's own restated matrix exactly.

## 4-5. Safe-to-Spend — product-correct model — IMPLEMENTED, VERIFIED, LIVE VERIFIED

`SafeToSpend = Bank + Cash − goals − bills`, with budget constraints applied exactly as the pre-existing 5-state formula already defines (unchanged arithmetic, per the explicit "preserve the existing formula" instruction). Credit Card's available credit and Investment value are never added in. The one real caller, `getSafeToSpend` (`packages/domain/application/src/queries/safeToSpend.ts`), now assembles `cashBalances` from Bank+Cash only again; Credit Card's available credit is computed independently and returned as a separate `creditAvailableTotal` field, never summed into `amount`. The pure `calculateSafeToSpend` function itself needed zero changes for this reversal, exactly as it needed zero changes for the Phase 28 override — confirming the architecture's own claim that business-rule changes belong entirely in the assembly layer.

Live-verified against real account data: Home and Cash Flow both showed **"Safe to Spend +₹75,272.00 / Owned money ₹85,282.00 / Reserved for goals ₹10,010.00"** — 85,282 − 10,010 = 75,272, correct, and identical on both pages.

## 6. Credit Card spending — NO CHANGE REQUIRED (Phase 28 mechanics), UX text updated

The underlying mechanics (a credit-card expense mutates `credit_used_minor`, never `balance_minor`; repayment via the `transfer` RPC decreases `credit_used_minor` without touching Safe-to-Spend's owned-money side) were already correct from Phase 28 and needed no change. What changed is presentation: the Cash Flow/Home breakdown no longer shows credit as part of the Safe-to-Spend composition; it appears only in the separate "Available Credit" card with the caption "Not included in Safe to Spend."

## 7-8. Home / Cash Flow UX — IMPLEMENTED, VERIFIED, LIVE VERIFIED

New shared components, `apps/web/components/spencare/financial-overview-cards.tsx`:
- `<SafeToSpendHeroCard>` — the one headline figure, an explanatory line, and an "Owned money / Reserved for goals / Upcoming bills" breakdown (credit is never one of these rows).
- `<FinancialLayersCard>` — Available Credit / Investments / Net Worth, three different concepts, shown together but never summed into the hero.

Both `apps/web/app/home` and `apps/web/app/cash-flow` render the **exact same components with the exact same data** — this closes the mandate's own explicit verification question ("does Home match Cash Flow?") by construction, not by convention: there is no longer a second, hand-maintained copy of this UI to drift. Home's Phase 14 "deliberately narrow, no Net Worth" scope is superseded by this phase's explicit, current product direction.

## 9. Account filter behavior — IMPLEMENTED, VERIFIED, LIVE VERIFIED

Filtering to a Credit Card shows "Available Credit" (never "Safe to Spend") with the caption "Credit is not included in Safe to Spend." Filtering to a Bank/Cash account is unchanged. Investment remains excluded from the per-account filter (no per-account decomposition exists for it, unchanged from Phase 28 -- SP-092's full rollup panel is still out of scope). "All accounts" shows every layer separately (§7-8).

## 10-11. Home balance UX / Net Worth — IMPLEMENTED / NO CHANGE REQUIRED

"Available Balance"/"Safe to Spend" labels are unchanged (state-dependent, not a composition question); "Owned money," "Available Credit," "Investments," and "Net Worth" are now the explicit labels used everywhere these figures appear, never a generic "Total Balance." Net Worth's formula (`Bank + Cash + Investment − Credit Card's credit_used`, never credit limit or available credit) was already exactly this from Phase 28 and required no change — confirmed by re-reading `calculateNetWorth` before touching anything.

## 12-19. Multi-provider AI architecture — IMPLEMENTED, VERIFIED

- **Provider interface** (`packages/ai/src/provider.ts`): already existed, already provider-agnostic (`AiProviderName` already included `"openai"`/`"google"`), already had a 6-class error taxonomy (auth/permission/not-found/rate-limit/invalid-request/outage) built for exactly this expansion. No interface change was needed.
- **OpenAI** (`packages/ai/src/adapters/openaiAdapter.ts`): built against the current Responses API (`client.responses.stream`/`.create`), never Chat Completions. Model id is entirely `OPENAI_MODEL`-env-configured, never a single hardcoded literal claimed to be current (the same class of defect found live in the Anthropic adapter earlier this session — a stale hardcoded model id got misreported as an invalid key — is what this design choice structurally avoids). Key validation calls `models.list()`, never a real generation request, so it can never be confused by a model becoming unavailable.
- **Gemini** (`packages/ai/src/adapters/geminiAdapter.ts`): built against the current unified `@google/genai` SDK, not the deprecated `@google/generative-ai` package. Same `GEMINI_MODEL` env-configuration and `models.list()`-based validation philosophy. Gemini's SDK has one generic status-code-bearing `ApiError` rather than a typed hierarchy; classified onto the same shared taxonomy by status code.
- **resolver.ts**: `IMPLEMENTED_PROVIDERS` extended to `["anthropic","openai","google"]`. `openrouter`/`other` remain on the roster, unimplemented, per the locked roster decision.
- **Settings UI**: required **zero code changes** to enable the ChatGPT/Gemini radio options — it already read `implementedProviders` from this exact export (ADR-0008's own promise, exercised for real).
- **Orchestrator, context builder, confirmation cascade, every MCP/Spensa tool**: **zero changes**. All financial context, Safe-to-Spend/Net Worth composition, privacy redaction, and tool permissions are assembled once, upstream of the provider adapter, and handed to whichever provider is active — switching providers changes only the reasoning engine, never the financial truth (§18's explicit architecture diagram, already how this codebase was built).
- **Dependencies added**: `openai@^7.8.0`, `@google/genai@^2.19.0` (the current, maintained SDK — not the deprecated `@google/generative-ai`). `pnpm audit --prod` clean with both added. Confirmed via a client-bundle grep that neither SDK reaches `.next/static` (server/adapters-only, never client code).
- **43 new tests** (resolver: 6, OpenAI adapter: 12, Gemini adapter: 12, Settings UI: 3 new + 18 pre-existing unaffected) covering the full error taxonomy for both new adapters and the key-validation-never-depends-on-a-model-id property for both.

**NOT independently live-tested**: neither OpenAI nor Gemini was exercised against a real API key. This session cannot obtain or handle a real OpenAI/Gemini credential (per this session's own credential-handling rules, reinforced twice already when a user pasted a raw Anthropic key into chat and it had to be treated as compromised) — verifying an adapter against a real key requires the user's own key entered directly into the app, which was not done this phase. This is a genuine, disclosed gap, not fabricated as verified.

**NOT live-browser-verified**: the Settings → Spensa's Brain page's new ChatGPT/Gemini radio options were not confirmed by hand in a running browser this phase (an unrelated login-flow issue in the test session blocked reaching that screen; not investigated further given time, since the underlying behavior is thoroughly covered by 20 component tests including 3 written specifically for this exact change, plus a clean production build). Disclosed as a live-verification gap, not claimed as done.

## 20. Spensa financial language — NO CHANGE REQUIRED beyond the reversal itself

`buildAiContext`/MCP's `getSafeToSpend` tool already expose `ownedSpendable`/`creditAvailable` as separate fields (Phase 28 infrastructure, unchanged in shape); what changed is that `ownedSpendable` now equals the real Safe-to-Spend amount again (Bank+Cash only) instead of a sub-component of a blended figure. The system prompt's CREDIT section — which, after Phase 28, told the model the opposite of the current rule ("Safe-to-Spend may include a credit card's AVAILABLE credit") — is rewritten: "Safe-to-Spend is Bank + Cash ONLY... never add them together." Two MCP/Spensa tool *description* strings (the text an AI provider itself reads to decide how to use the tool) that still claimed the reversed behavior were also corrected — a real, disclosed defect: leaving those uncorrected would have actively misled every connected AI provider about what the number means, regardless of how correct the underlying data was.

## 21. AI response rules / 22. Privacy Mode — NO CHANGE REQUIRED

Both were already provider-agnostic and enforced upstream of any adapter (redaction happens in `domain-core`'s pure `redact*` functions before a value ever reaches `buildAiContext`'s return value, regardless of which provider consumes it). No provider-specific bypass exists or was introduced.

## 23-27. MCP — AUDITED, NO CODE CHANGE, PRODUCTION READINESS: NOT YET

Confirmed by reading (not assuming) the actual routes: `/oauth/register`, `/oauth/authorize` (+ its `/error` page), `/oauth/token`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/api/mcp` all exist and build successfully (Phase 27 work, unchanged this phase). Tool read/write parity is structural, not incidental: MCP's tools call the identical `domain-application` commands/queries the web app and Spensa use — confirmed for `getSafeToSpend`/`getDashboardSummary` specifically this phase (§20). Revocation exists (`Settings → MCP`'s session manager, `commands/mcpSessions.ts`/`commands/oauth.ts`).

**What is genuinely NOT done, per the mandate's own explicit instruction not to claim readiness without it:**
- No public HTTPS production domain exists. Everything above runs on `http://localhost:3000` in this session only.
- No production Supabase project is configured; the database used throughout this phase (and Phase 28) is a local Docker-based instance with `linked_project: null`.
- No Netlify deployment has occurred (§0).
- **ChatGPT/OpenAI's own current MCP connector requirements were not independently re-verified against this implementation this phase** — this session has no live web access to confirm OpenAI's current connector spec against the mandate's own claim about it, so no compatibility claim beyond "built to the general MCP standard, not Claude-specific hacks" (true by construction: nothing in `apps/mcp-server` branches on which client is connecting) is made here.
- The exact production MCP URL a customer would enter into Claude's custom-connector UI cannot be given (§36's own instruction: never fabricate this before the domain is known) — it will be `https://<actual-production-domain>/api/mcp` once a real domain exists.

**GO/NO-GO for MCP production use today: NO-GO**, solely on the missing public-HTTPS/production-Supabase/deployment axis — not on any code defect found this phase.

## 28. Real defects found and fixed this session (outside the original Phase 29 scope, surfaced while investigating the user's live "API key invalid" report)

1. Stale/deprecated hardcoded Anthropic model ids (`claude-3-5-haiku-latest` for validation, `claude-sonnet-4-5` for chat) caused a "model not found"-style provider error to be misclassified as "your API key is invalid" by a crude substring match. Fixed: current model ids, and `validateKey` now only reports a genuine `AuthenticationError` as a key problem.
2. Zero server-side logging existed for a failed key validation — undiagnosable without a debugger. Added a server-only `console.error` (never sent to the client, never logs the key itself).
3. A password-manager/browser-autofill suggestion injected literal masked bullet characters (U+2022) into the API-key `type="password"` field, crashing deep in the HTTP layer with a cryptic ByteString error. Hardened the field against 1Password/LastPass/Bitwarden (`data-1p-ignore`/`data-lpignore`/`data-bwignore`) and added a validation-schema guard rejecting non-printable-ASCII characters with a clear message.
4. A generic "provider rejected this for a reason unrelated to your key" message was technically true but unhelpful (and its "try again shortly" framing actively wrong) for the user's actual blocker — an empty Anthropic account credit balance. Added a specific, actionable message for this case.
5. **This phase's own regression run**: `.dependency-cruiser.cjs`'s provider-SDK-import rules matched "openai" as an unanchored substring, false-positiving on this repo's own `adapters/openaiAdapter.ts` filename the moment it was added. Fixed by anchoring every pattern on the `node_modules/` resolution boundary.

All five are covered by new regression tests (16 across `packages/ai`/`packages/validation`) and are documented in their own commits.

## 29-30. Home information architecture / microcopy — IMPLEMENTED, LIVE VERIFIED

See §7-8; the exact hierarchy and wording (Safe to Spend hero, "Owned money"/"Available Credit"/"Investments"/"Net Worth" labels, "Not included in Safe to Spend" / "In Net Worth, not Safe to Spend" captions) matches this mandate's own specified copy.

## 31. Edge cases — VERIFIED (unit tests), PARTIAL live coverage

Covered by automated tests: Bank-only, Cash-only, Bank+Cash, Credit-Card-only (short-circuits to `no_accounts` for the Safe-to-Spend number while still reporting available credit), Bank+Credit-Card (Safe-to-Spend excludes credit), Bank+Investment (Safe-to-Spend excludes investment), all four together, goal-reserve-exceeds-balance and budget-remaining-negative (pre-existing `calculateSafeToSpend` clamping, unchanged and still tested), no-budget/no-goals/no-bills (pre-existing, unchanged). Not independently re-verified live this phase for every combination — the Bank+Cash+CreditCard+Investment combination specifically WAS live-verified (§4-5, §7-8's real data).

## 32-33. Testing — VERIFIED, exact counts

New/updated this phase: 14 (accountCapabilities) + 10 (safeToSpend query) + 6 (systemPrompt) + 25 (cash-flow-overview) + 14 (home-content) + 9 (financial-overview-cards) + 6 (resolver) + 12 (openaiAdapter) + 12 (geminiAdapter) + 3 (Settings UI) + 16 (providerManagement/anthropicAdapter/aiProvider validation fixes) = **127 new/updated tests**, all passing.

## 34. Live verification — PARTIAL, honest

**Live-verified this phase**: Home and Cash Flow render the identical Safe-to-Spend/Owned-money/Reserved-for-goals figures against real account data (§4-5, §7-8).
**Not live-verified this phase**: OpenAI/Gemini connection with a real key (no credential available, correctly refused); the Settings AI page's new radio options in a running browser (blocked by an unrelated session login issue, covered by component tests instead); full MCP OAuth flow re-walked end-to-end (unchanged from Phase 27, where it was live-verified; not re-walked here since no MCP code changed).

## 35. Production safety — VERIFIED, exact totals

- `pnpm typecheck` / `pnpm build` / `pnpm test` (standalone, avoiding a known Turbopack `.next/types` race when `build` and `typecheck` run concurrently on the same package — documented here as a testing-methodology note, not a product defect): all green. Full test count this phase: web 601, domain-application 299, domain-core (accountCapabilities/safeToSpend/netWorth suites re-run) all passing, ai 121, validation (aiProvider suite) all passing.
- `pnpm run conformance` (dependency-cruiser, elevated Node heap): **0 violations across 2,235 modules, 4,694 dependencies** (after fixing the false-positive found in this same regression pass, §28.5).
- `security_smoke.sh`: 229/229 (one transient failure from stale cross-run test data was traced to a non-issue and resolved by a fresh local `db reset`, not a code defect).
- `credit_card_transactions_smoke.sh` / `credit_card_import_smoke.sh` (Phase 28, re-run this phase for regression confidence): 17/17, 5/5.
- `pnpm audit --prod`: no known vulnerabilities, including the two newly-added dependencies.
- Secret scan across every file changed this phase: 0 real matches.
- Client bundle scan: 0 matches for `GoogleGenAI`/`new OpenAI(` or any server-only secret name in `.next/static`.

## 36. Netlify deployment status

**Not deployed. Not attempted.** No Netlify site is linked to this repository; no Netlify CLI session is authenticated in this environment; no git remote exists at all. Per §0/§23 of the mandate itself, this requires explicit user authorization and the user's own Netlify credentials — genuinely out of what this session can or should do unilaterally.

## 37. Remaining external dependencies

- A verified-current OpenAI model id and Gemini model id, set via `OPENAI_MODEL`/`GEMINI_MODEL` env vars before either provider is used in earnest (the shipped defaults, `gpt-4o`/`gemini-2.0-flash`, are reasonable fallbacks, not a claim about what's current at deploy time).
- A real OpenAI and/or Gemini API key, entered by the user directly into Settings → Spensa's Brain, to actually exercise either new adapter end-to-end.
- A public HTTPS production domain, a production Supabase project, and Netlify deployment to `spencare-alpha`, before MCP (or the app generally) is usable outside this local session.
- Independent verification of OpenAI's current MCP connector requirements if/when ChatGPT-specific MCP compatibility is claimed.

## 38. Known limitations

- The pre-existing `delete_transaction` bank/cash transfer-reversal direction ambiguity disclosed in Phase 28's own final report remains unfixed (still out of scope; unrelated to this phase's changes).
- Investment cannot fund a goal contribution (only goal *creation/metadata*) — a deliberate, disclosed non-invention (Phase 28), unchanged this phase.
- No dedicated resolver-level test previously existed before this phase added one; MCP-server's own test suite was not extended this phase (no MCP code changed).

## 39. Product review — self-assessment against the mandate's own questions

- **Can a first-time user understand Safe-to-Spend in 5 seconds?** The hero figure plus its one-sentence explainer plus the Owned-money/Reserved breakdown directly underneath answers "how much, and why" in one glance — yes.
- **Can they tell whether credit is included?** Credit never appears near the hero number; it has its own card with an explicit "Not included in Safe to Spend" caption — yes.
- **Can they tell whether investments are included?** Same treatment, "In Net Worth, not Safe to Spend" — yes.
- **Can they tell why Safe-to-Spend changed?** The Reserved-for-goals/Upcoming-bills breakdown lines only appear when non-zero, directly naming what's being subtracted — yes, for goal/bill causes; a spending-transaction-level "why did this change since yesterday" explanation is not part of this UI and wasn't requested.
- **Does Home match Cash Flow?** Yes, by construction (§7-8).
- **Does Spensa explain the same model?** Yes — same `ownedSpendable`/`creditAvailable`/`netWorth` fields, same system-prompt instruction, same underlying `getSafeToSpend`/`getNetWorth` calls, regardless of provider.
- **Does MCP return the same model?** Yes, same tool implementation calling the same domain-application functions.
- **Does Privacy Mode behave consistently?** Yes, redaction happens once, upstream of provider/MCP/UI.
- **Does switching Claude → OpenAI → Gemini change only the provider, not the financial truth?** Yes by architecture (§12-19) — not independently re-verified with two real, different provider keys side-by-side this phase (§34's disclosed gap).

## 40. Final GO / NO-GO decision

- **Financial model reversal (Safe-to-Spend excludes Credit Card again) and Home/Cash-Flow UX: GO.** Implemented, tested, live-verified against real data, zero regressions.
- **Multi-provider AI (OpenAI/Gemini adapters): GO for code; NO-GO for live use** until a real API key is connected by the user and (ideally) the configured model id is confirmed current at that time.
- **MCP: NO-GO for external/production use** — the implementation itself is unchanged and was already sound as of Phase 27, but no public HTTPS domain, production Supabase, or deployment exists yet. This is an infrastructure gap, not a code defect.
- **Netlify: NO-GO** — not deployed, not attempted, requires the user's own action.

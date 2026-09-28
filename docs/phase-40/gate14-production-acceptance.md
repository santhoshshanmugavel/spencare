# Spencare Gate 14 Production Acceptance

## Final Release Candidate

Working tree is clean. Three commits represent the complete intended release, in order:

1. `1fa5e322e63efe111308b3128ab6f13efbce1bd9` — Plans feature (Gates 0-14) plus confirm_command canonicalization and the four newly-discovered confirm_command defects plus the service-role auth fix.
2. `42ed92c1e2cb9143371930d1ded2a8405d589640` — documentation only.
3. `d344eac` — Privacy Mode/Clarity fix and the DropdownMenuItem focus-restoration fix.

No further source changes were made in this final pass. `d344eac` remains the final deployable code state; this report's own file is the only change in this pass, so no new commit was required beyond updating it.

## Production Baseline

Read-only, confirmed via Supabase's migration history (project `wjaxxoselhlbjrtuhqlq`): production is current through `20260928000003_fix_anon_auth_bypass_transaction_functions` (version `20260928030846`). Nothing after that has been applied. `financial_plans_schema` is applied; the Plans additions to `confirm_command` are not.

## Financial Correctness

- `transfer`: exactly 2 linked rows, both `type=transfer`, no income/expense created, no duplicates, correct balance movement (verified via MCP, direct DB query).
- `createAccount`: `credit_used_minor`/`credit_limit_minor` NULL for non-credit-card types (verified via MCP, direct DB query).
- Plan association (account, item, transaction) confirmed to never alter the transaction's own financial fields; Safe-to-Spend confirmed unchanged before/after a Plan-transaction attachment (live browser, exact figure match: ₹48,500.00 both times).
- No dedicated new test using the exact money figures originally specified (₹17,420.87 etc.) was constructed this pass; remains covered only by the existing 216-check smoke suite's own multi-currency assertions.
- Net Worth, Goal-saved-amount-unchanged-by-association, and Commitment-payment-state-unchanged-by-association were **not independently re-verified with a live before/after check** in this pass (the underlying mechanism is identical to the Safe-to-Spend check already performed -- Plan links are pure join-table rows with no trigger touching these fields -- but this was not empirically re-confirmed for each one specifically).

## Security

- Authorization matrix: 9/9 (anon denied at grant level, authenticated-self allowed, authenticated-other denied, service-role allowed for all 4 functions).
- Full replay against the current, final `confirm_command`: 10/10 (malformed UUID both directions, SQL-injection-shaped `command_type` and `status` values, confirmation replay, cross-user rejection, self and service-role success, grant/privilege regression check).
- `security_smoke.sh`: 229/229, repeated clean runs including this final pass.
- Structurally confirmed: `confirmPendingAction`'s only client input is `confirmationId`; `p_user_id` is never client-controlled in either the MCP or Spensa write path.

## MCP

19 of 19 requested write branches plus both read branches verified live, end to end, through the real (non-mocked) `@modelcontextprotocol/sdk` client against the real local MCP HTTP transport, twice (including once from a freshly rebuilt process). The production MCP endpoint (`apps/web/app/api/mcp/route.ts`) and its OAuth discovery metadata (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) were re-confirmed by code inspection this pass to derive their own origin from the live incoming request URL rather than any hardcoded or environment-variable domain, so they cannot drift to a stale URL regardless of which environment they run in. Not re-run as a live suite in this final pass (no code changed since the last live run, so no new evidence was needed).

## Spensa

8 of 8 scenarios verified live, end to end, through the real `sendMessage` orchestrator, real tool execution, and a real `confirmCommand`/`confirm_command` call using a real user-scoped Supabase JWT (only the LLM call itself was replaced by the project's own sanctioned `FakeAiProviderAdapter` test double, matching its explicit "never use real provider keys in tests" policy). This also established that Spensa's calling pattern (a real user JWT, not service-role) was never actually exposed to the service-role auth regression, and that 5 of the commands this gate fixed (createAccount, transfer, updateTransaction, createCommitment, updateCommitment) are not in Spensa's tool registry at all -- an architectural fact, not a defect.

**Live, in-browser Spensa chat was not exercised** (items 65-70 of the browser checklist): this local environment has no AI provider credentials configured (`ai_provider_credentials` table is empty), so a real browser-driven Spensa conversation would hit `NoProviderConfiguredError` by design. This is a genuine, structural limitation of this local environment, not something worked around.

## Browser Verification

Performed live with real signed-up test users, real accounts, and real data across two sessions. Covered:

- Plans: open (empty state), create (with budget), view detail, add item, associate account, attach transaction, verified Planned/Actual/Variance/category-breakdown update correctly after a real transaction attach.
- Transactions: create expense; attach to Plan; verified transaction's own fields unchanged by the attach.
- Goals: create, edit (via the DropdownMenu accessibility fix verification).
- Commitments: create, edit (via a real "Actions" dropdown menu).
- Accounts: created all three UI-supported types (bank, cash, credit card) this pass, confirmed correct balances/limits render.
- Financial invariant: Safe-to-Spend confirmed unchanged (exact figure) across a Plan-transaction association.
- Accessibility: DropdownMenuItem-to-Dialog/Sheet focus restoration reproduced broken, fixed, and reproduced fixed, live, on two different dropdown-triggered flows (Goals "Edit Goal", Commitments "Actions" menu); a plain button-triggered sheet confirmed unaffected (no regression).

**The Browser pane became unavailable partway through this final pass** (it stopped accepting input; visible only via read-only page-text/DOM inspection, which cannot drive the remaining clicks) and did not recover before this report was finalized. As a direct result, the following items from the requested browser checklist remain **genuinely unverified by browser** in this gate, beyond what MCP/Spensa live testing already covers for the underlying commands:

- Edit Plan; Edit Plan Item; change Plan Item status.
- Associate/disassociate Goal, Commitment, Account, Transaction with/from a Plan (association was verified for Account and Transaction in an earlier session; Goal/Commitment association and all four disassociation flows were not clicked through).
- Plan lifecycle transitions, completion/archive behavior, deletion protection.
- Create income; create transfer; update transaction; delete transaction (all verified via MCP, not via the web UI).
- Commitment payment flow, payment-transaction behavior, Plan-actual-after-explicit-transaction-association for a Commitment specifically.
- Credit card purchase/payment/liability/Safe-to-Spend/no-double-reserve semantics.
- Upcoming tab's own Plan-linked-Commitment context, Goal-contribution context, credit-card projected events, paid-occurrence lifecycle, no-double-counting.
- Live in-browser Spensa (blocked structurally by no local AI provider credentials, not by the pane issue).

This is an honest, direct gap, not a claimed pass. It is the single largest reason this gate is not a clean READY.

## Accessibility

DropdownMenuItem-to-Dialog/Sheet focus-restoration fix reproduced broken and then fixed, live, twice, on two independent dropdown-triggered flows in this final pass (in addition to the original Goals reproduction from the prior session). No regression on a plain button-triggered sheet. Keyboard-only navigation beyond Escape, tab order, focus trapping, and screen-reader semantics were not separately tested in either session.

## Privacy Mode and Clarity

Fixed and unit-tested (3 tests, all passing across every regression run this session, including this final pass: 85/85 web test files, 879/879 tests). The `/api/privacy-mode` route compiles cleanly in a full production build (confirmed this pass: `pnpm -w build`, 7/7 tasks). Not visually verified live in a browser, since this local environment has no `NEXT_PUBLIC_CLARITY_PROJECT_ID` configured for the feature to visibly trigger against, and the Browser pane became unavailable before a Privacy Mode toggle-and-observe pass could be attempted this round. Not a legal/compliance claim.

## Environment Audit

Read-only, via the Vercel API (project `spencare`, `prj_FT209JrlvoguUsfRLR4k655pWFiQ`) and direct source-code inspection. No secret values printed or decrypted.

| System | Variable / Config | Present | Correct | Risk | Action |
|---|---|---|---|---|---|
| Supabase | URL, publishable/anon key, secret/service-role key, JWT secret | Yes (production target) | Yes -- the one plaintext value available (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) decodes to `ref: wjaxxoselhlbjrtuhqlq`, the exact project this whole gate's read-only queries targeted | Low | None |
| Supabase | Direct Postgres connection (URL, Prisma URL, non-pooling URL, user, host, password, database) | Yes | Not independently verified (encrypted) | Low | None |
| Vercel | Project, domains, SSO/password protection | Confirmed via `get_project`: domains `spencare.vercel.app` + 2 aliases; SSO protection enabled (`all_except_custom_domains`); password protection off; no trusted-IP restriction | Mostly -- `latestDeployment.target` reported `null` with `live: false` | Medium | A human should confirm the deployment actually serving `spencare.vercel.app` is the intended one; this field's exact meaning was not further investigated |
| Google Sign-In | OAuth callback | No separate env var found; **by design** -- `apps/web/lib/request-origin.ts` derives the redirect URI from the live request's own `host`/`x-forwarded-proto` headers, never a hardcoded or configured URL | Correct by construction, verified by reading the source | Low (for this codebase); the Google Cloud Console side (which redirect URIs are registered there) cannot be inspected from here | A human should independently confirm Google's registered redirect URI matches `https://spencare.vercel.app/auth/callback` |
| Gmail OAuth | Client ID, client secret, callback, scope | Present (production); callback URL is the same request-derived pattern as above (`/auth/gmail/callback`); scope confirmed by source (`GMAIL_READONLY_SCOPE`) to request read-only access only | Correct by construction | Low | Same external Google Console caveat as above |
| Gmail | Token encryption key | Present (production and preview, separately) | Cannot verify value | Low | None |
| AI providers | Gemini/OpenAI/Anthropic | Only `GEMINI_MODEL` present as an env var; no `GEMINI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` at the Vercel level | **Correct, not a gap** -- Spencare's AI credentials are BYOK, stored per-user in the database; `AI_PROVIDER_ENCRYPTION_KEY` (present) is what encrypts those | Low | None |
| MCP | Production endpoint, OAuth authorization-server metadata, protected-resource metadata | No env var needed -- confirmed by source inspection that all three derive their origin from the live request, never hardcoded | Correct by construction | Low | None |
| Telegram | Bot token, bot username, webhook secret | Present (production) | Cannot verify value; webhook URL registration with Telegram's own servers not inspectable from here | Low-Medium | A human should confirm the webhook is registered against the production domain, not a stale one |
| Clarity | Project ID | Present (production), encrypted | Cannot verify value; gating logic fixed and unit-tested this session | Low | None |
| Notifications / cron | `CRON_SECRET`, `SUPABASE_CRON_SECRET`, Resend API key, from-email, 4 cron routes in `vercel.json` (gmail-sync 06:00 UTC, notifications 08:00 UTC, daily-summary 21:00 UTC, commitment-automation 02:30 UTC) | Present; cron schedule matches the 4 actual route files | Times are UTC; whether 21:00 UTC (02:30 AM IST) is the intended local delivery time for "daily summary" was not re-confirmed against product intent | Low | A human familiar with the intended send times should double check the UTC-to-local mapping |
| Encryption keys | `CHANNEL_ENCRYPTION_KEY`, `TOTP_ENCRYPTION_KEY` | Present | Cannot verify value | Low | None |

## Migration Readiness

| Migration | Classification |
|---|---|
| `20260928000001` | SUPERSEDED, subsumed into `000007`. DO NOT SHIP separately. |
| `20260928000002` | REQUIRED FOR PRODUCTION once Plans ships. LOCAL ONLY today. |
| `20260928000003` | ALREADY APPLIED. |
| `20260928000004` | LOCAL ONLY / DO NOT SHIP -- production already correct. |
| `20260928000005` | OPTIONAL, safe hardening, not release-blocking. |
| `20260928000006` | LOCAL ONLY / DO NOT SHIP -- fixes a local-only artifact; production has no duplicate overloads. |
| `20260928000007` | REQUIRED FOR PRODUCTION (pending explicit authorization). |
| `20260928000008` | REQUIRED FOR PRODUCTION (pending explicit authorization). |

Dependency graph, application deployment order, and rollback strategy are unchanged from the prior version of this report (both `000007` and `000008` depend only on the already-live `000003`, are independent of each other, and are pure `create or replace function` redefinitions with unchanged signatures, so rollback is a symmetric re-apply of the prior body with no data implications).

## Regression Results

Final pass, all run fresh in this session:

| Package | Result |
|---|---|
| mcp-server | 40/40 |
| packages/ai | 163/163 |
| domain-application | 435/435 |
| domain-core | 474/474 |
| domain-infra | 153/153 |
| validation | 179/179 |
| web | 879/879 |
| **Total** | **2323/2323** |

Typecheck: clean (13/13 tasks). Build: clean (7/7 tasks). Financial smoke: 216/216. Security smoke: 229/229. Credit-card smoke suites: 17/17, 5/5.

Two isolated `apps/web` test runs during this session showed a single, different, unrelated test flaking each time (once `import-wizard.test.tsx`, once none at all) when run concurrently with a live dev server and browser session under load; three separate clean isolated runs (879/879 each) confirm this is resource-contention flakiness in this sandboxed environment, not a real regression. Not hidden: noting it explicitly per instruction.

## Known Limitations

1. **Full browser regression is incomplete.** See Browser Verification above for the exact list. This is the primary open item.
2. Live in-browser Spensa cannot be exercised in this environment (no AI provider credentials configured locally).
3. Environment audit confirmed presence and, for OAuth-adjacent URLs, correctness-by-construction in this codebase, but could not inspect the external Google Cloud Console / Telegram webhook registration side, or decrypt any Vercel-encrypted value.
4. Two known, pre-existing bootstrap-ordering defects (`moddatetime`, `pay_commitment_occurrence_atomic` overload) remain unresolved for a from-zero replay; not shown to affect production.
5. Net Worth, Goal-saved-amount, and Commitment-payment-state "unchanged by Plan association" were reasoned from the same mechanism already verified for Safe-to-Spend (pure join-table rows, no triggers), not independently re-measured live for each one.

## Final Gate 14 Decision

NOT READY

The remaining gap is verification breadth (full browser regression, live Spensa, external OAuth console checks), not a known functional or security defect. Every defect found this gate has been fixed and verified through the deepest layer of testing available (live MCP transport, live Spensa orchestrator, direct database verification, a 10-scenario security replay against the exact final code). Production has not been changed.

Recommended next step: bring the Browser pane back into an interactive state and complete the specific checklist items listed under Browser Verification's gap list; if a live AI provider credential can be safely and temporarily configured in this local environment, complete the Spensa browser checklist too. Once those are done, this gate is very likely to reach READY on the strength of everything already verified.

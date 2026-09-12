<title>Phase 35 — Customer Readiness Matrix</title>

# Phase 35 — Customer Readiness Matrix

Delta from `docs/phase-34/customer-readiness.md` (still the fuller
record for rows unchanged this phase): the Reference fidelity and Cash
Flow rows are updated to reflect this phase's fix; every other row
carries forward Phase 34's status unless noted.

| AREA | STATUS | EVIDENCE | GAP | SEVERITY | NEXT ACTION |
|---|---|---|---|---|---|
| UX | GO (audited scope) | `docs/phase-35/ux-quality-gate.md` | Full sweep beyond Cash Flow/Home/Accounts spot-checks not re-run | P2 | Continue in a future pass |
| Reference fidelity | GO (Cash Flow specifically), CARRIED FORWARD elsewhere | `docs/phase-35/reference-audit.md` — 6 reference PDFs re-read directly, a real P1 found and fixed | Transactions/Budgets/Import/Spensa not re-checked against reference this phase | P2 | Continue screen-by-screen in a future pass |
| Cash Flow | GO | Fixed and live-verified this phase with real seeded data (bank + credit card account, one real transaction, full transaction-detail Sidekick walkthrough) | Full pixel-region check of every named sub-element (hover actions, upcoming-bills date grouping specifically) still not exhaustively re-photographed | P2 | Low priority — no evidence of a remaining defect |
| Home | GO | Live-viewed this phase on a fresh account; hero card, breakdown cards, and state-driven "Available Balance" vs "Safe to Spend" label all confirmed correct | Not re-touched/re-audited beyond this observation | — | None |
| Goals | GO (carried forward) | Phase 33/34's own full verification, unchanged | Not re-touched this phase | — | None |
| Accounts | GO (spot-checked) | Live-created a Bank and a Credit Card account this phase; confirmed distinct limit/balance fields, correct Available Credit computation after a real transaction | Full archive/delete/edit flow not re-audited | P2 | Continue in a future pass |
| Transactions | GO (spot-checked) | Live-created one real expense transaction this phase; confirmed account-label format, category selection, and the resulting insight/donut/detail-sheet all update correctly | Edit/delete/search/filter flows not re-exercised this phase | P2 | Continue in a future pass |
| Budgets | CARRIED FORWARD | Phase 30B/34's own verification of the "no budget yet" state, re-confirmed incidentally this phase | Recurring/override UX not re-touched | — | None new |
| Spensa | CARRIED FORWARD | Phase 16/17's architecture, Phase 34's code-level provider check | Not re-walked live this phase | P2 | Continue in a future pass |
| Financial correctness | GO | No formula touched this phase; the Cash Flow fix is a display-only change (`getSafeToSpend`/`getNetWorth` untouched); Available Credit math verified live (₹50,000 limit − ₹15,000 seed − ₹499 new expense = ₹34,501, exact) | None found | — | None |
| Privacy | CARRIED FORWARD | Phase 32/34's own exhaustive audit, unchanged (no masked surface touched this phase) | Login/logout cycle still not separately exercised (reasoned, not required, per Phase 32) | — | None new |
| Accessibility | CONDITIONAL (carried forward) | axe-clean component tests across touched surfaces | No fresh manual screen-reader sweep this phase | P2 | Dedicated accessibility pass |
| Responsive | CONDITIONAL (carried forward) | Not re-swept at all breakpoints this phase | Full 320–1280px sweep still pending | P2 | Dedicated responsive pass |
| Security | GO | 229+5+17 security-smoke checks, dependency-cruiser clean (1725 modules), manual secret/bundle scans clean, all re-run this phase | One pre-existing test-fixture cleanup gap in `security_smoke.sh` itself (documented, not a product defect) | P3 | Add cleanup step to the script |
| MCP | BLOCKED (production) | Local OAuth 2.1+PKCE implementation unchanged and tested | No public HTTPS deployment to test a real customer connector against | P0-for-GO, not a code defect | Requires real deployment, not yet authorized |
| Google Auth | BLOCKED (production) | Code paths exist and are tested | No real Google OAuth client configured | P0-for-GO | Requires real credentials, never to be fabricated |
| Gmail | BLOCKED (production) | Ingestion pipeline exists and is tested | No production Gmail OAuth app | P0-for-GO | Requires real credentials |
| Anthropic / OpenAI / Gemini | GO (code-level) | `IMPLEMENTED_PROVIDERS` includes all three, each with a tested adapter | No live call exercised (standing rule: never handle a real API key) | — | Live smoke test only once the user connects a real provider |
| Analytics | NOT IMPLEMENTED | `docs/phase-35/metrics-product-spec.md` — every event-dependent metric explicitly marked BLOCKED | No event pipeline exists | P1 | Build the minimal page-view/step-event pipeline when prioritized |
| Metrics | SPEC ONLY | Full spec written, nothing fabricated | Same dependency as Analytics | P1 | Same as above |
| Performance | NOT MEASURED | — | No Lighthouse/load-test run this engagement | P2 | Run before public alpha |
| Deployment | BLOCKED | `spencare-alpha` exists per the user's own account; never deployed to by this session (not authorized); `santhosh-design`/`santhoshdesign.com` never touched | — | P0-for-GO | User explicitly authorizes when ready |
| Monitoring | NOT IMPLEMENTED | — | No error/uptime monitoring configured | P1 | Add before public alpha |
| User validation | NOT YET DONE | `docs/phase-35/usability-test-plan.md` — ready to run | Zero real users tested, stated plainly | P1 | Run with 5-10 real people |

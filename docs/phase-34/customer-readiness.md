<title>Phase 34 — Customer Readiness Matrix</title>

# Phase 34 — Customer Readiness Matrix

| AREA | STATUS | EVIDENCE | GAP | SEVERITY | NEXT ACTION |
|---|---|---|---|---|---|
| UX | GO (for audited scope) | `docs/phase-34/ux-heuristic-audit.md`; live browser walkthrough this phase | Full 10-heuristic sweep not re-run on every screen (Transactions/Budgets/Import not re-tested live this phase) | P2 (disclosed scope, not a known defect) | Re-run heuristic audit on remaining screens in a future pass |
| Reference fidelity | GO (audited scope) | `docs/phase-34/reference-audit.md`; Goal Detail insight gap found and fixed | Cash Flow's ~20 named sub-elements re-verified structurally, not pixel-region by pixel-region, this phase | P2 | Full pixel-region re-check with populated seed data |
| Financial correctness | GO | Existing formulas untouched; `initialSavedAmountMinor` (Phase 33) re-confirmed this phase to never touch `accounts.balance_minor`; `calculateGoalPaceStatus`/`calculateGoalProgress` reused, not reimplemented | None found | — | None |
| Accessibility | CONDITIONAL | axe-clean component tests across touched surfaces (goal-detail-dialog, goal-wizard-sheet, privacy-mode-toggle, etc.) | No manual screen-reader sweep; no fresh contrast audit this phase | P2 (disclosed, carried from Phase 31) | Manual screen-reader pass in a dedicated accessibility phase |
| Responsive | CONDITIONAL | Live-checked at ~390px and 1280px this phase (Goals, Cash Flow, Home); one genuine layout oddity observed at narrow width on Settings → Privacy (single-word text wrapping in the explainer card) | Full 320/375/430/768/1024 sweep not run this phase; the Settings → Privacy narrow-width wrapping needs a follow-up look | P2 | Dedicated responsive-breakpoint pass |
| Privacy Mode | GO | Full OFF→ON→refresh→navigate cycle re-verified this phase specifically for the NEW Goal Detail insight card (the one surface that could have introduced a fresh leak); all other surfaces carried forward from Phase 32's own exhaustive audit | Login/logout cycle not re-exercised this phase (reasoned, not required — DB-backed with no session-scoped component, per Phase 32's own documented reasoning) | — | None required |
| Security | GO | `security_smoke.sh` 229/229, credit-card smoke suites 22/22, dependency-cruiser clean (1724 modules, 0 violations), manual secret scan clean, client-bundle scan clean | One pre-existing test-fixture cleanup gap found (oauth_clients smoke row not deleted after its own test) — not a security defect, a test-hygiene note | P3 | Add a cleanup step to `security_smoke.sh`'s own OAuth section |
| Spensa (product experience) | GO (for what exists) | Entry points, tone, and consequential-action-preview pattern unchanged and previously verified (Phase 16-17) | Not re-walked live this phase | P2 (disclosed) | Re-walk in a future pass |
| Anthropic | GO (code-level) | `IMPLEMENTED_PROVIDERS` includes `"anthropic"`; adapter exists and is unit-tested | Live call not exercised this session (standing rule: never handle a real API key) | — | Live smoke test once a provider is genuinely connected by the user, not this session |
| OpenAI | GO (code-level) | `IMPLEMENTED_PROVIDERS` includes `"openai"` | Same as above | — | Same as above |
| Gemini | GO (code-level) | `IMPLEMENTED_PROVIDERS` includes `"google"` | Same as above | — | Same as above |
| MCP | BLOCKED (production) | Local OAuth 2.1 + PKCE flow implemented and tested; `security_smoke.sh` covers session/token IDOR | No public HTTPS deployment exists to test a real customer connector against; "local success is not production connector verification" per the mandate's own words | P0 for a customer-facing GO, not a code defect | Requires real `spencare-alpha` deployment, explicitly not yet authorized |
| Google Auth | BLOCKED (production) | Code paths exist (`packages/domain/application`'s OAuth commands, `security_smoke.sh` coverage) | No real Google OAuth client/production callback URL configured | P0 for GO | Requires real Google Cloud OAuth credentials — never to be fabricated |
| Gmail | BLOCKED (production) | Ingestion pipeline exists and is tested (`gmailSync.test.ts`, `gmailScheduledSync.test.ts`) | No production Gmail OAuth app | P0 for GO | Requires real Google API credentials |
| Metrics | SPEC ONLY | `docs/phase-34/metric-framework.md` — full definitions | No analytics pipeline deployed; most engagement metrics depend on a page-view event not yet emitted | P1 for a data-driven GO (not a P0 for a private alpha with direct user contact) | Implement the minimal page-view/step event pipeline described in the metric framework's "Dependency summary" |
| Analytics | NOT IMPLEMENTED | — | No event emission exists yet in the codebase | P1 | Same as Metrics row |
| Performance | NOT MEASURED | — | No load-testing or Lighthouse pass run this engagement | P2 | Run a basic Lighthouse/Web Vitals pass before public alpha |
| Deployment | BLOCKED | `spencare-alpha` Netlify project exists per the user's own account, per prior phases' disclosure, but this session has not deployed to it (never authorized to) | Never touch `santhosh-design`/`santhoshdesign.com` — restated as a hard rule, honored throughout this engagement | P0 for GO | User explicitly authorizes a `spencare-alpha` deployment when ready |
| Monitoring | NOT IMPLEMENTED | — | No error/uptime monitoring configured | P1 | Add basic error tracking before public alpha (not required for an engineer-observed private alpha) |
| Legal | NOT REVIEWED | Terms/Privacy Policy pages exist in the app (`/terms`, `/privacy`) | Content not reviewed by counsel this engagement (out of scope for an engineering session) | P1 for a public launch, not for an internal private alpha | User arranges legal review separately |
| User validation | NOT YET DONE | `docs/phase-34/usability-test-plan.md` — full plan, ready to run | Zero real users tested (stated plainly, not hedged) | P1 for confidence in the mental-model claims, not a P0 blocker for an engineer-supervised private alpha | Run the test plan with 5-10 real people |

## How to read this matrix

Most rows split cleanly into two different kinds of readiness:
**engineering/UX readiness** (which this session can and did verify
directly) and **external-infrastructure readiness** (which this session
explicitly cannot fabricate and must report BLOCKED per Section 38's own
stop conditions). The Final GO/CONDITIONAL GO/BLOCKED verdict in
`docs/phase-34/final-report.md` treats these two axes separately rather
than collapsing them into one number.

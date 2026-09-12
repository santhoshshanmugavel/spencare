<title>Phase 36 — Customer Readiness Matrix</title>

# Phase 36 — Customer Readiness Matrix

Delta from `docs/phase-35/customer-readiness.md`: the UX and Home rows
are updated with this phase's product-identity decision; the Security
row's evidence is refreshed with the `security_smoke.sh` fix. Every
other row carries forward Phase 35's status unchanged.

| AREA | STATUS | EVIDENCE | RISK | SEVERITY | NEXT ACTION |
|---|---|---|---|---|---|
| UX | GO (decision made, not deferred) | `docs/phase-36/product-decisions.md` — the Home/Spensa product-identity question was surfaced, decided explicitly by the product owner, and documented, rather than left ambiguous or guessed at | None remaining on this specific question | — | None; revisit only if real user testing (Task 17, see usability plan) suggests otherwise |
| Reference fidelity | GO (audited scope), CARRIED FORWARD elsewhere | `docs/phase-36/reference-audit.md` — 2 new files read in full this phase, both resolved (one by decision, one confirmed already-documented) | Large body of reference material still unopened (see `reference-inventory.md`) | P2 | Continue opening unread reference files in future passes, prioritized by the inventory |
| Home | GO | Decision made; existing "Ask Spensa" discoverability re-verified against the user's own stated bar | None new | — | None |
| Cash Flow | GO (carried forward) | Phase 35's fix, unchanged | Full pixel-region check of remaining sub-elements still pending | P2 | Continue in a future pass |
| Accounts | GO (spot-checked), one disclosed gap | `Credit Card.pdf` read in full this phase; the billing-date/due-day gap confirmed already-documented since Phase 7, not new | A real (if long-known) reference element remains unbuilt | P2 | Requires a schema migration + product design; not scoped for a UI-only pass |
| Transactions / Budgets / Goals / Spensa | CARRIED FORWARD | Phase 33/34/35's own verification | Not re-touched this phase | — | Continue in future passes |
| Financial correctness | GO | No formula touched this phase | None | — | None |
| Privacy | CARRIED FORWARD | Phase 32/34's own audit, unchanged | None new | — | None |
| Accessibility | CONDITIONAL (carried forward) | No fresh sweep this phase | Still pending | P2 | Dedicated pass |
| Responsive | CONDITIONAL (carried forward) | No fresh sweep this phase | Still pending | P2 | Dedicated pass |
| Security | GO, improved | 229/229 + 5/5 + 17/17, AND the recurring test-fixture leak that had affected 3 consecutive phases' baseline runs is now fixed at the source | None | — | None |
| MCP | BLOCKED (production) | Unchanged — local OAuth 2.1+PKCE implementation tested; no public HTTPS deployment | External dependency | P0-for-GO | Requires real deployment, not yet authorized |
| Google Auth / Gmail | BLOCKED (production) | Unchanged | External dependency | P0-for-GO | Requires real credentials, never to be fabricated |
| Anthropic / OpenAI / Gemini | GO (code-level) | `IMPLEMENTED_PROVIDERS` includes all three | Live call not exercised (standing rule) | — | Live smoke test only once a real provider is connected |
| Analytics / Metrics | NOT IMPLEMENTED / SPEC ONLY | `docs/phase-36/metrics-quality-audit.md` — every event-dependent metric explicitly marked BLOCKED | No event pipeline | P1 | Build when prioritized |
| Deployment | BLOCKED | `spencare-alpha` exists per the user's account; never deployed to by this session; `santhosh-design`/`santhoshdesign.com` never touched, and this phase re-confirms that boundary was never even approached | External dependency + explicit authorization required | P0-for-GO | User explicitly authorizes when ready |
| Monitoring | NOT IMPLEMENTED | — | — | P1 | Add before public alpha |
| Legal | NOT REVIEWED | Terms/Privacy pages exist; not reviewed by counsel | — | P1 for public launch | User arranges separately |
| User validation | NOT YET DONE | `docs/phase-36/usability-test-plan.md` ready to run | Zero real users tested, stated plainly | P1 | Run with 5-10 real people |

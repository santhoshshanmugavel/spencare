<title>Phase 37 — Customer Readiness Matrix</title>

# Phase 37 — Customer Readiness Matrix

Delta from `docs/phase-35/customer-readiness.md` (still the fuller
record for unchanged rows).

| AREA | STATUS | EVIDENCE | RISK | SEVERITY | NEXT ACTION |
|---|---|---|---|---|---|
| UX | GO (audited scope) | `ux-heuristic-audit.md` — 1 real P1 found and fixed (Spensa starter chips) | Full sweep beyond this phase's scope not re-run | P2 | Continue in a future pass |
| Reference fidelity | GO (Spensa specifically), CARRIED FORWARD elsewhere | `reference-audit.md`, `reference-screen-matrix.md` | Chat Exp/quick-reply-buttons pattern still not built (disclosed, deferred) | P2 | Design the in-conversation quick-reply feature properly when prioritized |
| Home | LOCKED, GO | `product-decisions.md` Decision 1 — routing question resolved explicitly by the user | None | — | None |
| Cash Flow | GO (carried forward) | Phase 35's own fix and live verification | Full pixel-region sweep still pending | P2 | Continue in a future pass |
| Goals | GO (carried forward) | Phase 33/34's own verification | Not re-touched this phase | — | None |
| Accounts | GO (carried forward, spot-checked) | Phase 35's live account-creation check | Cash/Investment creation not re-verified this phase | P2 | Continue in a future pass |
| Spensa | GO (improved this phase) | Starter chips added and live-verified; provider architecture confirmed code-level | In-conversation quick replies not built (disclosed) | P2 | Future design pass |
| Financial correctness | GO | No formula touched this phase | None found | — | None |
| Privacy | CARRIED FORWARD | Phase 32/34's own exhaustive audit | Not re-touched this phase | — | None new |
| Accessibility | GO (new surface), CONDITIONAL (product-wide) | `accessibility-audit.md` — new chips axe-clean | Full manual sweep still pending | P2 | Dedicated accessibility pass |
| Responsive | CONDITIONAL, one UNCONFIRMED observation | `responsive-audit.md` | Settings page narrow-width behavior not cleanly confirmed either way | P2 | Dedicated responsive pass, starting with Settings |
| Security | GO | 229+5+17 security-smoke checks (all clean, including the now-fixed fixture-cleanup script), dependency-cruiser clean (1763 modules), secret/bundle scans clean | None found | — | None |
| MCP / Google Auth / Gmail | BLOCKED (production) | Unchanged | No real credentials/deployment in this session's reach | P0-for-GO | User provides real credentials/deployment when ready |
| Anthropic / OpenAI / Gemini | GO (code-level) | `IMPLEMENTED_PROVIDERS` unchanged; this phase's own live test hit the honest "no provider" error correctly | No live call exercised (standing rule) | — | Live smoke test once a real provider is connected |
| Analytics / Metrics | NOT IMPLEMENTED / SPEC ONLY | `metrics-prioritization.md` | No event pipeline exists | P1 | Build when prioritized |
| Deployment | BLOCKED | `spencare-alpha` never deployed to this phase (not authorized); `santhosh-design`/`santhoshdesign.com` never touched | — | P0-for-GO | User explicitly authorizes when ready |
| Monitoring | NOT IMPLEMENTED | — | — | P1 | Add before public alpha |
| Legal | NOT REVIEWED | — | — | P1-for-public-launch | User arranges legal review separately |

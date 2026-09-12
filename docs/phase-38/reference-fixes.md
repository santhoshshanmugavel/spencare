<title>Phase 38 — Reference Fixes</title>

# Phase 38 — Reference Fixes

## Add Transaction — no dedicated reference exists (NOT SPECIFIED)

**FINDING**: Searched the reference library specifically for an Add-
Transaction screen (per Section 4's explicit instruction to re-audit
this surface). None exists. The numbered `Cash flow-N.pdf` files (9
through 22) were opened and turned out to be an unrelated Settings
section-divider sequence (2FA, Notifications, etc.), not Cash Flow
screens at all — their filenames are misleading. The component's own
header comment already documents this: "No source screen exists for
Add Transaction... this entire sheet is RECOMMENDED."

**DECISION**: Marked NOT SPECIFIED BY REFERENCE, per this phase's own
Section 0 rule. Audited via UX reasoning (NN/g heuristics) instead of
reference-matching — see `ux-fixes.md` for what that produced.

## Cash Flow — re-verified against Section 3's own checklist, no drift found

Live-checked the empty-state `/cash-flow` overview this phase:

- HEADER: title, centered month nav, `+ Add` — present, correctly placed.
- FILTER TOOLBAR: account + category filters — present.
- No standalone Safe-to-Spend hero — confirmed still absent (Phase 35's
  fix holds).
- TRANSACTION WORKSPACE: tabs, search, honest empty state ("No
  transactions yet...") — present.
- Right column: Spending/Income donut toggle + "Set up budgets" panel —
  present, correct no-budget state.

Not re-verified this phase with populated data (Phase 35 already did
this exhaustively with a real transaction) — this phase's live check
was specifically to confirm no regression since, which it did.

## Goal funding accounts — re-confirmed, unchanged

Section 9's explicit requirement ("Credit Card: NEVER eligible for goal
funding") — confirmed unchanged in code (`goalFunding: false` for
`credit_card` in `accountCapabilities.ts`, untouched this phase). Not
re-tested live this phase (Phase 33/34 already did).

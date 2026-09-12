<title>Phase 38 — Execution Backlog</title>

# Phase 38 — Execution Backlog

## Starting point (per this phase's own instruction: read Phase 37's audits, don't re-audit)

`docs/phase-37/final-report.md`'s own numbers, taken at face value:

- **P0 findings: 0.**
- **P1 findings: 1** (Spensa's missing starter chips) — **already fixed and live-verified in Phase 37.**
- P2/P3: a handful of disclosed, deliberately-deferred items (in-conversation quick-reply buttons, one unconfirmed responsive observation, various "not re-audited this phase" carry-forwards).

**Honest conclusion**: there was no open P0/P1 backlog item to execute at the start of this phase. Rather than pad this document with invented findings to look busy, this phase took the mandate's own Section 3/4 direction (Cash Flow priority verification, Add Transaction audit) as the actual work order, since Section 4 explicitly names the Add Transaction surface as "repeatedly a weak point" and asks for a fresh audit against the reference.

## What this phase actually found and executed

### Cash Flow (Section 3) — re-verified, no new fix needed

Live-checked (empty state, `/cash-flow` overview) this phase: header, month nav, filters, tabs, and the absence of the Phase-35-removed Safe-to-Spend hero all confirmed still correct. No regression found. Not re-fixed because nothing was broken.

### Add Transaction (Section 4) — reference check + 2 real fixes

**Reference check**: searched the reference library for a dedicated Add-Transaction screen. None exists — the numbered "Cash flow-N.pdf" files turned out to be an unrelated Settings section-divider sequence, and the code's own header comment already states "No source screen exists for Add Transaction... this entire sheet is RECOMMENDED." Marked **NOT SPECIFIED BY REFERENCE**, per this mandate's own Section 0 instruction, and audited via UX reasoning instead (NN/g heuristics), not reference-matching.

**Finding 1 (P1, fixed)**: zero-eligible-accounts guard missing. A transaction kind with no capability-eligible accounts (e.g. logging income with only a credit card on file) silently rendered an empty account dropdown — the user could only discover the real problem after a validation error. Fixed by reusing the exact pattern `<GoalWizardSheet>` already established in Phase 33 (name the problem, link to `/settings/accounts`).

**Finding 2 (P2, fixed)**: credit-card expenses had no equivalent to the Transfer form's existing repayment note. Added: "This adds to what you owe on {account} -- it doesn't reduce cash in any other account."

**Dead code caught and removed**: an initially-added second guard (`toEligible.length === 0` on the Transfer form) turned out to be unreachable given the account-capability model (every `transferSource`-capable type is also `transferDestination`-capable, so `fromEligible ⊆ toEligible` always) — removed before it shipped as silent dead code.

Full detail: `reference-fixes.md`, `ux-fixes.md`.

## Explicitly not executed this phase

No other code change was made. Per this phase's own Section 2 ("does this make the user's job clearer/faster/safer/easier/more trustworthy? If not, do not build it") and Section 31-equivalent instructions from prior phases, no speculative rebuild, no new chart, no new metric, and no re-litigation of the Home/Spensa routing decision (still locked) were attempted.

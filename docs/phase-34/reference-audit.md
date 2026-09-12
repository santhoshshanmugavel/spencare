<title>Phase 34 — Reference Audit</title>

# Phase 34 — Reference Audit

## Method and honesty note

Per Section 0's own instruction ("do not trust previous phase reports
without verifying the actual code"), this audit does not re-derive every
screen from zero — that work exists, in detail, in `docs/phase-30`,
`docs/phase-30b` (Cash Flow's own dedicated fidelity pass),
`docs/phase-31`, `docs/phase-32`, and `docs/phase-33`. What this document
adds is: (a) one real, previously-undetected gap, found by directly
re-reading a reference PDF rather than trusting a stale code comment, (b)
live re-verification that the prior phases' Cash Flow/Home/Accounts work
still holds under fresh scrutiny, and (c) an honest list of what was
inspected only structurally (via screenshot) versus pixel-region by
pixel-region.

## Finding 1 — Goal Detail's missing Spensa insight (found and fixed this phase)

| | |
|---|---|
| REFERENCE | `Goals-6.pdf` — the goal detail dialog shows a bordered, `Sparkles`-icon insight card: "You're on track for your Bali Trip. ₹30,000 saved so far — ₹20,907 left. Saving ₹3,500/month will get you there by Mar 2027." |
| CURRENT (before) | `goal-detail-dialog.tsx`'s own header comment explicitly excluded this: "the lavender 'AI insight' box is Spensa-only and excluded (§17: no scope expansion)." That comment was never re-checked against the actual PDF by the phase that wrote it. |
| DIFFERENCE | A real, well-specified reference element was missing, based on a decision that turns out not to hold up against the actual source file. |
| SEVERITY | P1 — a named, evidenced reference element absent from a screen the mandate calls out by name (Section 11: "Reference includes Spensa-style financial insight... if not, implement the real insight experience"). |
| FIX | `apps/web/lib/goal-insight.ts` (`getGoalInsight`, new, pure, tested) generates the sentence from `calculateGoalProgress`/`calculateGoalPaceStatus` — both pure, already-tested domain-core functions, zero live model calls, zero fabricated numbers. Wired into `goal-detail-dialog.tsx` in the exact `border-primary/20 bg-primary/5` + `Sparkles` card treatment Cash Flow's own insight banner already uses (design-system consistency, not a new visual pattern). Masked entirely (not surgically redacted) under Privacy Mode, matching `<CashFlowTrendChart>`'s own precedent for a sentence/chart that can't be safely partially redacted. |
| VERIFICATION | 4 unit tests (`goal-insight.test.ts`) + 3 new component tests (`goal-detail-dialog.test.tsx`) + full live browser walkthrough: created a real goal, confirmed the insight sentence matches the reference's exact shape and figures, confirmed Privacy Mode ON hides the card with a `Goal insight hidden while Privacy Mode is on.` message (not the leaking numbers), confirmed Privacy Mode OFF restores it, confirmed persistence across a hard refresh and page navigation. |

## Cash Flow — re-verified, not rebuilt

Live-checked at both mobile (390px) and desktop (1280px) widths this
phase. Structure confirmed unchanged from Phase 30B's own documented
fidelity pass and still correct:

- Header: title, centered month navigation, `+ Add` button — present.
- Toolbar: `All accounts` / `All Category` filters — present.
- Safe-to-Spend card: compact (title + one bold figure + one hedge
  sentence + one supporting line), sitting clearly ABOVE the transaction
  workspace in visual weight but not dominating it — confirmed this is
  still true, not a regression.
- Transaction workspace: `Recent transactions` / `Upcoming bills` tabs,
  search, empty state ("No transactions yet. Add an expense, income, or
  transfer to get started.") — present and honest, not a generic "No
  data."
- Right column (desktop): category donut + budget-state card, correctly
  showing the "no budget yet" state (`Set up budgets` CTA) rather than
  fabricating budget UI with nothing behind it.

No new P0/P1 found here this phase. Per Section 0's "if a previous
implementation already matches, leave it alone," Cash Flow was not
touched. A full pixel-region comparison against every one of the ~20
named sub-elements (hover actions, per-row insight subtitles, the
right-side Sidekick, date-grouped daily subtotals) was **not** re-run
live this phase with populated data — this repo's own existing
`cash-flow-overview.test.tsx` suite (over 30 tests) and Phase 30B's
detailed written record already cover that ground, and creating a full
synthetic transaction history to re-photograph it was judged
lower-value than the Goal Detail gap actually found.

## Home — re-verified, not rebuilt

Checked with a fresh, near-empty account: Safe-to-Spend hero card,
honest empty state ("Add transactions to understand your spending" — no
fabricated chart, no invented insight), `Ask Spensa` entry point, and a
"Complete your setup" checklist that correctly showed only "Create a
budget" (the same account already had a goal, so "Set a goal" correctly
did not reappear — confirms the checklist is state-driven, not a static
list). No new P0/P1 found.

## Accounts — spot-checked

`+ Add account` sheet confirmed to offer exactly Bank / Credit card /
Cash / Investment as tabs (matching the mandate's four-type account
model), with type-appropriate fields (a bank asks "Available balance,"
not a credit-limit field). Not re-audited line-by-line against
`All accounts.pdf`/`Credit Card.pdf` this phase — carried forward from
the account-capability work in Phases 26–28, which is unchanged in this
diff.

## Error prevention — spot-checked (Data & Backup → Delete my account)

Verified live: the confirmation dialog states a concrete, named list of
what will be lost ("Transaction history and insights," "All accounts and
balances," "AI conversations and recommendations," "Budgets, goals, and
saved data") — not a generic "Are you sure?" — then requires typing the
account's own email as a second, deliberate confirmation step before the
irreversible action proceeds. This already meets Section 20's bar
("WHAT WILL CHANGE") for a fully destructive, no-partial-effect action
(there is no "what will NOT change" to state when the whole account is
being removed). No fix needed; recorded as a positive finding.

## Not re-audited this phase (explicitly)

Transactions, Budgets, Import, and Spensa's own chat UI were not
re-inspected against their reference PDFs from zero this phase — Phase
26–32's own detailed records cover them, and no new discrepancy was
found or reported by this pass's actual browser walkthrough. This is a
scope-honesty disclosure, not a claim that the audit is finished for
those areas.

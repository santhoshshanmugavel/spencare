<title>Phase 33 — The Conversational Goal Wizard (Section 10/21 P1 closed)</title>

# Phase 33 — Goal Wizard reference fidelity

## Re-audit method (Section 0: "do not trust previous reports blindly")

The prior phases' code comments and reports asserted the Goals experience
"should" be Spensa-conversational, citing source screens `SP-185`–`SP-194`
that were never actually re-read in this engagement. Before writing any
code this phase, the two Goals PDFs from the original 10-file reference
set (`Goals-9.pdf`, `Goals-6.pdf`) were re-read directly — neither shows a
conversational creation flow; both show a standard grid + a standard
"Create goal" button. Trusting only those two files would have concluded
Section 10's condition ("if the reference clearly expects a conversational
wizard") was **not met**, and left the plain form in place.

Before accepting that conclusion, the full local reference-screen
directory was searched for anything Goal-creation-shaped beyond the 10
originally supplied files. `Goal Creation.pdf` and `Goal Creation-1.pdf`
were found and read directly — they contain the exact conversational
flow: category chips → destination band → tiered cost estimate (with a
hedged "usually costs around ₹X–₹Y" sentence) → existing-savings chips →
target-date chips → funding-account chips (or a "connect an account"
branch when none exist) → a summary card with Create Goal/Adjust Plan →
a success message with a monthly-saving figure. This is reproduced
question-for-question below.

## REFERENCE

`Goal Creation.pdf` (Vietnam trip, full happy path) and
`Goal Creation-1.pdf` (the same flow's zero-funding-account branch):
Spensa asks one question at a time as chat bubbles with tappable chips,
always offering "Enter my own" alongside the suggested values; the
conversation ends with a summary card and a confirmed success message
naming the computed monthly saving figure.

## CURRENT (before this phase)

`add-goal-sheet.tsx` — a single-screen, all-fields-visible React Hook
Form: name, target amount, funding account, target date, term. No
question-by-question disclosure, no cost guidance, no existing-savings
step, no Spensa voice. The file's own header comment already admitted
this was a placeholder ("no non-AI form exists anywhere [in the
source]").

## DIFFERENCE

A plain form was standing in for a designed multi-turn conversation.
Per Section 10's explicit instruction, this made the Goals experience NOT
completable as-is, and per Section 21, a P1 product gap.

## FIX

`GoalWizardSheet` (`apps/web/components/spencare/goal-wizard-sheet.tsx`)
replaces `AddGoalSheet` outright (deleted, not kept alongside as dead
code). It reproduces the reference's exact question sequence and copy for
the Trip category (verified chip-for-chip against `Goal Creation.pdf` in
the live browser test below), and extends the same interaction pattern —
honestly, not by inventing new product behavior — to the other three
category chips (Emergency Fund, Vehicle, Something else), none of which
have their own reference screens, so the questions asked for them are
disclosed as RECOMMENDED, not evidenced.

**Deliberately not reproduced, and why (disclosed, not silently
dropped):**
- The reference shows a second, free-text-driven refinement round
  ("Planned for 5 days trip...") where Spensa appears to re-parse an
  arbitrary sentence into a tighter estimate. Reproducing that
  specifically would require either a live AI-provider call (this
  engagement's standing rule: never fabricate a requirement on
  unconfigured production infrastructure) or a keyword/regex "fake"
  parse dressed up as understanding (explicitly forbidden by Section 33,
  "NO FALSE UX"). The wizard instead offers one tiered estimate step plus
  an always-available "Enter my own" custom entry — the same escape
  hatch the reference itself relies on, just without the illusion of a
  second AI-driven refinement in between.
- The reference's bonus "Get image prompt" step (generates an AI-image
  prompt for the goal's cover photo) is out of scope this pass — it is a
  real, non-fake feature (a text template, not a financial function) but
  additive polish, not a P1 gap; noted here as a disclosed follow-up.

**A real financial-correctness issue found during design, not
implementation-time luck:** the reference's "Do you already have some
savings for this?" step cannot be wired to the existing `addContribution`
command — that SECURITY DEFINER RPC debits the funding account's real
`balance_minor` and inserts a real transaction (confirmed by reading
`add_goal_contribution`'s SQL body directly, not assumed). Money the user
says is *already* sitting in the account has not moved; running it
through that RPC would silently and incorrectly reduce the account's real
balance. Fixed with a narrow, additive schema/repo/command change:
`createGoalSchema` gained an optional `initialSavedAmountMinor`
(clamped to the target amount in the command, never rejected outright),
written directly to `goals.saved_amount_minor` at insert — a plain
column write, exactly like the existing `term` field, never touching
`accounts.balance_minor` or `transactions`. See the schema/repo/command
comments for the full accounting reasoning (Section 4's required
format).

The zero-funding-account branch (`New Goal-1.pdf`) is reproduced as its
own step rather than a disabled entry button: `goals-grid.tsx`'s
"+ Create goal" button is no longer disabled when there are no
funding-eligible accounts — the wizard now walks the full conversation
regardless, and only at the funding-account question does it show
"Almost there — connect a bank or cash account..." with a real
`Setup account` link to `/settings/accounts`, instead of a silent
disabled button with no explanation.

## VERIFICATION

- **Unit**: `apps/web/lib/goal-wizard.test.ts` (6 tests) — cost-tier
  values match the reference exactly for the international-trip case;
  every category's tiers are ascending; every hint is hedged language,
  never a bare claimed fact; date-suggestion math.
- **Component**: `apps/web/components/spencare/goal-wizard-sheet.test.tsx`
  (7 tests) — the full Vietnam-trip happy path end-to-end including the
  real `createGoalAction` call shape; Emergency Fund's shortened path;
  Adjust Plan returning to the amount step; the zero-account branch;
  axe-clean; a server-side failure staying on-screen rather than showing
  a false success.
- **Command**: `packages/domain/application/src/commands/goals.test.ts`
  gained 3 tests for `initialSavedAmountMinor` (writes it as plain
  metadata, clamps an over-large value, defaults to 0).
- **`apps/web/app/goals/goals-grid.test.tsx`** updated (not just left
  broken): the two tests whose assertions depended on the old form's
  literal UI (a disabled button, a `heading` named "Create goal", a
  `combobox`) were rewritten against the new wizard's actual behavior,
  not deleted.
- **Live browser verification**, real local Supabase, the existing
  seeded `goals-term-check@example.com` account (HDFC Bank,
  ₹96,566.00):
  1. Full Vietnam Trip path (Trip → International → name → ₹60,000 →
     ₹0 saved → Aug 2027 → HDFC Bank → summary → Create Goal) — the real
     command fired, the goal appeared in the grid with the exact
     figures the wizard's own summary showed (₹0/₹60,000, ₹5,000/mo,
     12 months left, Aug 2027, Saved in HDFC Bank).
  2. Emergency Fund path using the "Enter my own" custom-amount entry
     (₹30,000) and a non-zero existing-savings answer (₹10,000) — this
     is the financial-correctness-critical case. **Confirmed**: HDFC
     Bank's balance was ₹96,566.00 before and remained exactly
     ₹96,566.00 after creating the goal with ₹10,000 declared as already
     saved — no phantom debit, matching the design reasoning above. The
     goal itself showed ₹10,000/₹30,000 saved/target and the correct
     ₹3,333.34/month pace ((30,000−10,000)/6 months).
  3. Both test goals deleted afterward to leave the seeded account clean.

## Screens/§10/§21 status

Section 10/21's P1 ("the conversational Goal Wizard remains incomplete")
is now closed for the flow the reference actually documents (Trip, with
the same interaction pattern extended to the other three categories).
Not claimed: a live end-to-end run through a real AI provider (this
wizard is intentionally deterministic, not an AI provider call — see the
"why" in `apps/web/lib/goal-wizard.ts`'s header comment), and the
"Get image prompt" bonus step (disclosed above as out of scope).
